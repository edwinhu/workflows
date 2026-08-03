import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function canonicalProject(status = "APPROVED") {
  const root = mkdtempSync(join(tmpdir(), "writing-canonical-hook-"));
  roots.push(root);
  mkdirSync(join(root, ".planning", ".state"), { recursive: true });
  mkdirSync(join(root, "drafts"));
  const plan = [
    "## Writing Intent", "", "- Domain: legal", "", "## Source Plan", "", "- Bibliography: references/sources.bib", "- Notebook: none",
  ].join("\n") + "\n";
  const planFile = "writing-native.md";
  writeFileSync(join(root, ".planning", planFile), plan);
  writeFileSync(join(root, ".planning", ".state", "review.json"), JSON.stringify({
    workflow: "writing", plan_file: planFile, plan_hash: createHash("sha256").update(plan).digest("hex"),
    approved_session_id: "approval", approved_at: "2026-01-01T00:00:00.000Z", status,
    reviewer_session_id: status === "PENDING" ? "" : "review", reviewed_at: status === "PENDING" ? "" : "2026-01-01T00:00:01.000Z",
  }));
  return root;
}

function hook(name, cwd, filePath) {
  return spawnSync("bun", [join(ROOT, "hooks", name)], {
    cwd,
    input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath } }),
    encoding: "utf8",
  });
}

describe("canonical writing hooks", () => {
  test("cite linter checks an approved canonical project without ACTIVE_WORKFLOW", () => {
    const root = canonicalProject();
    const draft = join(root, "drafts", "section.md");
    writeFileSync(draft, "Claim.[^1]\n\n[^1]: 123 Harvard L. Rev. 456 (1999).\n");
    const result = hook("cite-fidelity-lint.ts", root, draft);
    expect(result.stdout).toContain("hand-typed-cite");
    expect(existsSync(join(root, ".planning", "ACTIVE_WORKFLOW.md"))).toBe(false);
  });

  test("prose check derives legal style from the approved generated plan", () => {
    const root = canonicalProject();
    const draft = join(root, "drafts", "legal.md");
    writeFileSync(draft, "The trustee acted pursuant to the agreement and gave notice thereof.\n");
    const result = hook("writing-prose-check.ts", root, draft);
    expect(result.stdout).toContain("Volokh: 'pursuant to'");
    expect(existsSync(join(root, ".planning", "ACTIVE_WORKFLOW.md"))).toBe(false);
  });

  test("verify nudge persists only plan-hash-bound hidden state", () => {
    const root = canonicalProject();
    const draft = join(root, "drafts", "section.md");
    writeFileSync(draft, "Draft.\n");
    const result = hook("writing-suggest-verify.ts", root, draft);
    expect(result.stdout).toBe("");
    // The counter moved out of the retired per-workflow `writing.json` and into the shared
    // `episode.json`. Both halves are asserted: the new location carries the count, and the old one
    // is not recreated alongside it — a migration that writes both files is not a consolidation.
    const state = JSON.parse(readFileSync(join(root, ".planning", ".state", "episode.json"), "utf8"));
    expect(state.editsSinceVerify).toBe(1);
    expect(state.planHash).toHaveLength(64);
    expect(state.workflow).toBe("writing");
    expect(existsSync(join(root, ".planning", ".state", "writing.json"))).toBe(false);
    expect(existsSync(join(root, ".planning", "ACTIVE_WORKFLOW.md"))).toBe(false);
  });

  test("a malformed episode file is never overwritten by the edit counter", () => {
    // Regression for the gemini third-party finding. `readEpisodeState` returns null for BOTH
    // "absent" and "present but unparseable", and `episodeFor` treated every null as absent — so a
    // corrupt episode.json was replaced with a fresh state, destroying recorded phases and silently
    // discharging a review debt nobody satisfied. The function's own docstring already promised this
    // guard; for one evening it did not implement it. codex reviewed the same diff and missed it.
    const root = canonicalProject();
    const statePath = join(root, ".planning", ".state", "episode.json");
    writeFileSync(statePath, "not json at all");
    const draft = join(root, "drafts", "section.md");
    writeFileSync(draft, "Draft.\n");
    const result = hook("writing-suggest-verify.ts", root, draft);
    expect(result.stdout).toBe("");
    expect(readFileSync(statePath, "utf8")).toBe("not json at all");
  });

  test("pending or malformed receipt fails safe and creates no writing state", () => {
    for (const status of ["PENDING", "malformed"]) {
      const root = canonicalProject(status === "malformed" ? "APPROVED" : status);
      if (status === "malformed") writeFileSync(join(root, ".planning", ".state", "review.json"), "not json");
      const draft = join(root, "drafts", "section.md");
      writeFileSync(draft, "Draft.\n");
      for (const name of ["writing-suggest-verify.ts", "writing-prose-check.ts", "cite-fidelity-lint.ts"]) {
        const result = hook(name, root, draft);
        expect(result.stdout).toBe("");
      }
      expect(existsSync(join(root, ".planning", ".state", "writing.json"))).toBe(false);
      expect(existsSync(join(root, ".planning", "ACTIVE_WORKFLOW.md"))).toBe(false);
    }
  });
});
