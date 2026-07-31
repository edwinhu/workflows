import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(import.meta.dir, "..");
const read = path => readFileSync(join(ROOT, path), "utf8");
const fresh = read("skills/workflow-creator/SKILL.md");
const improve = read("skills/workflow-creator-improve/SKILL.md");

describe("workflow-creator shared-v1 entry contracts", () => {
  test("has fresh and corrective entries", () => {
    expect(existsSync(join(ROOT, "skills/workflow-creator/SKILL.md"))).toBe(true);
    expect(existsSync(join(ROOT, "skills/workflow-creator-improve/SKILL.md"))).toBe(true);
    expect(fresh).toContain("lifecycle: shared-v1");
    expect(improve).toContain("entry: corrective");
  });
  test("wires clarification approval and mutation boundaries", () => {
    for (const text of [fresh, improve]) {
      expect(text).toContain("clarify-before-recon-guard.ts --workflow workflow-creator");
      expect(text).toContain("orchestrator-mutation-guard.ts --workflow workflow-creator");
      expect(text).toContain("approved-artifact-gate.ts --workflow workflow-creator");
      expect(text).toContain("approved-artifact-persist.ts --workflow workflow-creator");
      expect(text).toContain('matcher: "Edit|Write|Bash"');
      expect(text).toContain('matcher: "Agent|Workflow"');
    }
  });
  test("rejects legacy state and requires canonical compiler", () => {
    expect(fresh).toContain("not resumable or convertible");
    expect(improve).toContain("Reject legacy");
    expect(fresh).toContain("workflow-plan-compiler.ts");
    expect(fresh).toContain("There is no LLM, Python, or legacy enumeration fallback");
  });
  test("does not contain load-time shell interpolation", () => {
    // A literal bang-backtick inside skill content is executed even in prose or fences.
    expect(fresh).not.toContain("!`");
  });
  test("keeps audit-only read-only and human review terminal", () => {
    expect(improve).toContain("Audit-only requests never receive mutation authority");
    expect(improve).toContain("Do not create a generated plan or receipt");
    for (const text of [fresh, improve]) expect(text).toContain("HUMAN_REVIEW.md");
  });
});
