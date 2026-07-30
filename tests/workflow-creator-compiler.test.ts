import { describe, expect, test } from "bun:test";
import { compileWorkflowPlan } from "../scripts/wc/workflow-plan-compiler.ts";

const header = `# Plan\n\n## Workflow Output Manifest\n\n| ID | Kind | Path | Depends On | Work | Criteria | Evidence | Writable Paths | Instruction Files | Model | Effort |\n|---|---|---|---|---|---|---|---|---|---|---|`;
const row = `| entry | skill-entry | skills/demo/SKILL.md | - | Create the fresh entry | Contains shared-v1 lifecycle | bun test exits 0 | skills/demo/SKILL.md | /tmp/instructions.md | sonnet | high |`;

describe("workflow plan compiler", () => {
  test("compiles canonical manifest deterministically", () => {
    const first = compileWorkflowPlan(`${header}\n${row}\n`, "/tmp/project");
    const second = compileWorkflowPlan(`Unrelated prose\n\n${header}\n${row}\n`, "/tmp/project");
    expect(first.ok).toBe(true);
    expect(first.readyWave).toHaveLength(1);
    expect(first.readyWave[0].writablePaths).toEqual(["skills/demo/SKILL.md"]);
    expect(first.fingerprints).toEqual(second.fingerprints);
  });
  test("fails closed without manifest", () => expect(compileWorkflowPlan("# prose", "/tmp").ok).toBe(false));
  test("stops at the end of the contiguous manifest table", () => {
    const plan = `${header}\n${row}\n\n## Review Surfaces\n\n| Artifact | Surface |\n|---|---|\n| Diff | tuicr |\n`;
    const result = compileWorkflowPlan(plan, "/tmp/project");
    expect(result.ok).toBe(true);
    expect(result.readyWave).toHaveLength(1);
  });
  test("rejects duplicate ids and outputs", () => {
    const result = compileWorkflowPlan(`${header}\n${row}\n${row}\n`, "/tmp");
    expect(result.ok).toBe(false);
    expect(result.violations.join(" ")).toContain("duplicate task ID");
    expect(result.violations.join(" ")).toContain("duplicate output");
  });
  test("rejects unsafe paths and missing evidence", () => {
    const bad = `| bad | hook | ../hooks/x.ts | missing | mutate | done |  | ../hooks/x.ts | - | sonnet | high |`;
    const result = compileWorkflowPlan(`${header}\n${bad}\n`, "/tmp");
    expect(result.ok).toBe(false);
    expect(result.violations.join(" ")).toContain("unsafe output path");
    expect(result.violations.join(" ")).toContain("Evidence is required");
  });
  test("rejects unknown dependencies and kinds", () => {
    const bad = `| x | mystery | skills/x/SKILL.md | absent | create | present | test | skills/x/SKILL.md | - | sonnet | high |`;
    const result = compileWorkflowPlan(`${header}\n${bad}\n`, "/tmp");
    expect(result.ok).toBe(false);
    expect(result.violations.join(" ")).toContain("unknown file kind");
    expect(result.violations.join(" ")).toContain("unknown dependency");
  });
  test("topologically orders dependencies and rejects cycles", () => {
    const dependent = `| a | test | tests/a.test.ts | z | test after z | passes | bun test | tests/a.test.ts | - | sonnet | high |`;
    const prerequisite = `| z | script | scripts/z.ts | - | create z | exists | file exists | scripts/z.ts | - | sonnet | high |`;
    const ordered = compileWorkflowPlan(`${header}\n${dependent}\n${prerequisite}\n`, "/tmp");
    expect(ordered.readyWave.map(task => task.id)).toEqual(["z", "a"]);
    const cycleA = dependent.replace("| z |", "| b |");
    const cycleB = `| b | script | scripts/b.ts | a | create b | exists | file exists | scripts/b.ts | - | sonnet | high |`;
    const cyclic = compileWorkflowPlan(`${header}\n${cycleA}\n${cycleB}\n`, "/tmp");
    expect(cyclic.ok).toBe(false);
    expect(cyclic.violations.join(" ")).toContain("Dependency cycle");
  });
});
