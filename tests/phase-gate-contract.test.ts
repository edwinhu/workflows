import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluatePhaseGate } from "../hooks/lib/phase-gate.ts";

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "phase-gate-contract-"));
  roots.push(root);
  return root;
}

const config = {
  artifactPath: ".planning/REVIEW_STATE.md",
  requiredStatus: "APPROVED",
  requiredFields: "verdict:APPROVED",
  gateDescription: "Review",
  gateRemedy: "Run review",
  blockedTools: ["Write", "Edit"],
  alwaysAllowedDirectories: [".planning", ".claude"],
};

describe("reusable hardened phase-gate evaluator", () => {
  test("denies ambiguous and malformed artifacts", () => {
    for (const artifact of [
      "---\nstatus: APPROVED\nstatus: REJECTED\nverdict: APPROVED\n---\n",
      "---\nbroken: [\nstatus: APPROVED\nverdict: APPROVED\n---\n",
    ]) {
      const root = project();
      writeFileSync(join(root, ".planning-placeholder"), "");
      Bun.spawnSync(["mkdir", "-p", join(root, ".planning")]);
      writeFileSync(join(root, ".planning/REVIEW_STATE.md"), artifact);
      const decision = evaluatePhaseGate(root, config, {
        tool_name: "Write",
        tool_input: { file_path: join(root, "src/app.ts") },
      });
      expect(decision.kind).toBe("deny");
    }
  });

  test("denies lexical state-path escapes but allows canonical state writes", () => {
    const root = project();
    Bun.spawnSync(["mkdir", "-p", join(root, ".planning"), join(root, "src")]);

    const escaped = evaluatePhaseGate(root, config, {
      tool_name: "Write",
      tool_input: { file_path: join(root, ".planning", "..", "src", "app.ts") },
    });
    expect(escaped.kind).toBe("deny");
    expect(escaped.reason).toContain("artifact missing");

    const stateWrite = evaluatePhaseGate(root, config, {
      tool_name: "Write",
      tool_input: { file_path: join(root, ".planning", "progress.md") },
    });
    expect(stateWrite).toEqual({ kind: "allow" });
  });

  test("denies state-directory symlink escapes", () => {
    const root = project();
    const outside = project();
    Bun.spawnSync(["mkdir", "-p", join(root, ".planning")]);
    symlinkSync(outside, join(root, ".planning", "outside"));

    const decision = evaluatePhaseGate(root, config, {
      tool_name: "Write",
      tool_input: { file_path: join(root, ".planning", "outside", "escaped.ts") },
    });
    expect(decision.kind).toBe("deny");
    expect(decision.reason).toContain("artifact missing");
  });

  test("rejects absolute artifact paths even when they point inside or outside the project", () => {
    const root = project();
    const outside = project();
    Bun.spawnSync(["mkdir", "-p", join(root, ".planning")]);
    writeFileSync(join(root, ".planning/REVIEW_STATE.md"), "---\nstatus: APPROVED\nverdict: APPROVED\n---\n");
    writeFileSync(join(outside, "REVIEW_STATE.md"), "---\nstatus: APPROVED\nverdict: APPROVED\n---\n");

    for (const artifactPath of [join(root, ".planning/REVIEW_STATE.md"), join(outside, "REVIEW_STATE.md")]) {
      const decision = evaluatePhaseGate(root, { ...config, artifactPath }, {
        tool_name: "Write",
        tool_input: { file_path: join(root, "src/app.ts") },
      });
      expect(decision.kind).toBe("deny");
      expect(decision.reason).toContain("artifact path");
    }
  });

  test("rejects artifact symlink escapes and sibling-worktree paths", () => {
    const root = project();
    const sibling = project();
    Bun.spawnSync(["mkdir", "-p", join(root, ".planning")]);
    writeFileSync(join(sibling, "REVIEW_STATE.md"), "---\nstatus: APPROVED\nverdict: APPROVED\n---\n");
    symlinkSync(join(sibling, "REVIEW_STATE.md"), join(root, ".planning/LINK.md"));
    for (const artifactPath of [".planning/LINK.md", "../sibling/REVIEW_STATE.md"]) {
      const decision = evaluatePhaseGate(root, { ...config, artifactPath }, {
        tool_name: "Write",
        tool_input: { file_path: join(root, "src/app.ts") },
      });
      expect(decision.kind).toBe("deny");
    }
  });

  test("denies when the validated artifact is swapped to an external symlink before open", () => {
    const root = project();
    const outside = project();
    Bun.spawnSync(["mkdir", "-p", join(root, ".planning"), join(root, "src")]);
    const artifact = join(root, ".planning/REVIEW_STATE.md");
    writeFileSync(artifact, "---\nstatus: APPROVED\nverdict: APPROVED\n---\n");
    const external = join(outside, "APPROVED.md");
    writeFileSync(external, "---\nstatus: APPROVED\nverdict: APPROVED\n---\n");

    const decision = evaluatePhaseGate(root, {
      ...config,
      beforeArtifactOpen: () => {
        rmSync(artifact);
        symlinkSync(external, artifact);
      },
    }, {
      tool_name: "Write",
      tool_input: { file_path: join(root, "src/app.ts") },
    });
    expect(decision.kind).toBe("deny");
    expect(decision.reason).toContain("artifact missing");
  });

  test("derives status and required fields from one immutable artifact snapshot", () => {
    const root = project();
    Bun.spawnSync(["mkdir", "-p", join(root, ".planning"), join(root, "src")]);
    writeFileSync(join(root, ".planning/REVIEW_STATE.md"), "placeholder");
    let reads = 0;
    const decision = evaluatePhaseGate(root, {
      ...config,
      readArtifactSnapshot: () => {
        reads += 1;
        return reads === 1
          ? "---\nstatus: APPROVED\nverdict: APPROVED\n---\n"
          : "---\nstatus: REJECTED\n---\n";
      },
    }, {
      tool_name: "Write",
      tool_input: { file_path: join(root, "src/app.ts") },
    });

    expect(decision).toEqual({ kind: "allow" });
    expect(reads).toBe(1);
  });

  test("returns deterministic allow and deny decisions from structured inputs", () => {
    const root = project();
    Bun.spawnSync(["mkdir", "-p", join(root, ".planning"), join(root, "src")]);
    writeFileSync(
      join(root, ".planning/REVIEW_STATE.md"),
      "---\nstatus: APPROVED\nverdict: APPROVED\n---\n",
    );

    expect(
      evaluatePhaseGate(root, config, {
        tool_name: "Write",
        tool_input: { file_path: join(root, "src/app.ts") },
      }),
    ).toEqual({ kind: "allow" });

    writeFileSync(join(root, ".planning/REVIEW_STATE.md"), "---\nstatus: REJECTED\n---\n");
    const denied = evaluatePhaseGate(root, config, {
      tool_name: "Write",
      tool_input: { file_path: join(root, "src/app.ts") },
    });
    expect(denied.kind).toBe("deny");
    expect(denied.reason).toContain("wrong status");
  });
});
