import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
function ignored(path: string): boolean { return Bun.spawnSync(["git", "check-ignore", "-q", path], { cwd: ROOT }).exitCode === 0; }

describe("native generated plan settings contract", () => {
  test("tracks project settings that direct native plans into ignored .planning", () => {
    const settingsPath = ".claude/settings.json";
    expect(existsSync(join(ROOT, settingsPath))).toBe(true);
    expect(JSON.parse(read(settingsPath))).toEqual({ plansDirectory: "./.planning" });
    expect(ignored(settingsPath)).toBe(false);
    expect(ignored(".planning/generated-native-plan.md")).toBe(true);
  });

  test("ExitPlanMode binding records metadata without copying plan bytes", () => {
    const source = read("hooks/approved-artifact-persist.ts");
    const library = read("workflows/lib/approved-artifact.ts");
    expect(source).toContain("bindApprovedGeneratedPlan");
    expect(source).not.toContain("tool_input.plan");
    expect(library).not.toMatch(/atomicWrite\([^\n]*(?:PLAN\.md|plan\.json)/);
    expect(library).toContain('atomicWriteOwnedDirectory(root, state, stateDirectory, "review.json"');
    expect(library).toContain("forceNoDescriptorAnchor");
    expect(library).toContain("afterStateOpen");
  });
});
