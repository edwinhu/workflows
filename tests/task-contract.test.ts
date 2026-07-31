import { describe, expect, test } from "bun:test";
import { enforceTaskOutputs, normalizeExpectedOutputs, validateTask } from "../workflows/lib/task-contract";

const task = {
  id: "15", name: "observe", work: "implement", criteria: "passes", model: "test", effort: "high",
  writablePaths: ["workflows/lib/a.ts", "tests"], outputs: ["tests/a.test.ts", "workflows/lib/a.ts"],
};

describe("declared task outputs", () => {
  test("normalizes a strict deterministic inventory and requires it on every task", () => {
    expect(normalizeExpectedOutputs(task.outputs)).toEqual(["tests/a.test.ts", "workflows/lib/a.ts"]);
    expect(validateTask(task)).toBe(true);
    expect(validateTask({ ...task, outputs: undefined })).toBe(false);
    expect(() => normalizeExpectedOutputs(["a", "a"])).toThrow(/duplicate/i);
  });

  test("rejects required, extra, outside-authority, duplicate, and report-mismatch violations", () => {
    expect(() => enforceTaskOutputs(task, ["workflows/lib/a.ts"], ["workflows/lib/a.ts"])).toThrow(/required output/i);
    expect(() => enforceTaskOutputs(task, [...task.outputs, "tests/extra.test.ts"], [...task.outputs, "tests/extra.test.ts"])).toThrow(/unexpected output/i);
    expect(() => enforceTaskOutputs({ ...task, outputs: ["outside.txt"] }, ["outside.txt"], ["outside.txt"])).toThrow(/writable authority/i);
    expect(() => enforceTaskOutputs(task, [...task.outputs, "outside.txt"], [...task.outputs, "outside.txt"])).toThrow(/outside writable authority/i);
    expect(() => enforceTaskOutputs(task, [...task.outputs, task.outputs[0]], task.outputs)).toThrow(/duplicate/i);
    expect(() => enforceTaskOutputs(task, task.outputs, ["tests/a.test.ts"])).toThrow(/report mismatch/i);
    expect(enforceTaskOutputs(task, task.outputs, [...task.outputs].reverse())).toEqual(task.outputs);
  });
});
