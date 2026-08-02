import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(import.meta.dir, "..");
const read = p => readFileSync(join(ROOT, p), "utf8");

describe("workflow-creator shared lifecycle infrastructure", () => {
  test("policy and artifact metadata support workflow-creator", () => {
    expect(read("hooks/_workflow_policies.ts")).toContain('"workflow-creator": Object.freeze');
    expect(read("workflows/lib/approved-artifact.ts")).toContain('"workflow-creator"');
    // Was `workflows/beat-implement.js`. That script was retired (it could never execute under the
    // Workflow runtime); the built-in workflow list it carried now lives in the beat's pre-step.
    expect(read("scripts/beat/preflight.ts")).toContain('"workflow-creator"');
  });
  test("semantic resume routes fresh corrective and review phases", () => {
    const start = read("hooks/session-start.ts");
    const compact = read("hooks/pre-compact.ts");
    for (const text of [start, compact]) {
      expect(text).toContain("workflow-creator");
      expect(text).toContain("workflow-creator-improve");
      expect(text).toContain("beat-review");
    }
  });
  test("legacy numeric hooks and generator are retired", () => {
    for (const path of ["hooks/wc-step-gate-guard.ts", "hooks/wc-constraint-check.ts", "workflows/wc-generate.js", "scripts/wc/wc_file_set.py"]) {
      expect(() => read(path)).toThrow();
    }
  });
  test("mutation guard includes workflow-creator", () => {
    const guard = read("hooks/orchestrator-mutation-guard.ts");
    expect(guard).toContain('["writing", "workshop", "workflow-creator"]');
  });
});
