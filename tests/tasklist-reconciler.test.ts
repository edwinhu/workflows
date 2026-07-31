import { describe, expect, test } from "bun:test";
import { reconcileTaskList, taskListIdentity, type ReconciledPlanTask, type TaskListSnapshot } from "../workflows/lib/tasklist-reconciler";
const OLD = "a".repeat(64), NEXT = "b".repeat(64);
const task = (id: string, dependencies: string[] = [], itemKinds: ReconciledPlanTask["itemKinds"] = ["implementation"]): ReconciledPlanTask => ({ id, name: id, work: "work", criteria: "done", outputs: [`src/${id}.ts`], writablePaths: ["src"], model: "sonnet", effort: "medium", dependencies, itemKinds });
const snapshot = (id: string, status: TaskListSnapshot["status"], planHash: string, plan_task_id: string, item_kind = "implementation", disposition?: string): TaskListSnapshot => ({ id, status, subject: id, description: "task", blockedBy: [], metadata: { planHash, plan_task_id, item_kind, ...(disposition ? { disposition } : {}) } });

describe("TaskList reconciler public contract", () => {
  test("uses exactly planHash, plan_task_id, item_kind identity and creates explicit kinds", () => {
    expect(taskListIdentity({ planHash: NEXT, plan_task_id: "TASK-01", item_kind: "implementation" })).toBe(`${NEXT}:TASK-01:implementation`);
    const result = reconcileTaskList({ planHash: NEXT, planTasks: [task("TASK-01", [], ["retry", "blocker", "review", "human-decision", "verification"])], existingItems: [] });
    expect(result.actions.filter(a => a.kind === "create").map(a => a.kind === "create" && a.metadata.item_kind)).toEqual(["blocker", "human-decision", "implementation", "retry", "review", "verification"]);
  });

  test("reuses same-hash tasks, validates dependencies, and emits tool-neutral creates", () => {
    const result = reconcileTaskList({ planHash: NEXT, planTasks: [task("TASK-01"), task("TASK-02", ["TASK-01"])], existingItems: [snapshot("tool-1", "in_progress", NEXT, "TASK-01")] });
    expect(result.currentImplementationIds).toEqual({ "TASK-01": "tool-1" });
    expect(result.actions).toEqual([expect.objectContaining({ kind: "create", metadata: expect.objectContaining({ plan_task_id: "TASK-02" }), blockedByPlanTaskIds: ["TASK-01"] })]);
  });

  test("rolls replacement plans over with delete or explicit superseded disposition", () => {
    const result = reconcileTaskList({ planHash: NEXT, planTasks: [task("TASK-01")], existingItems: [snapshot("old-pending", "pending", OLD, "TASK-01"), snapshot("old-work", "in_progress", OLD, "TASK-02"), snapshot("old-done", "completed", OLD, "TASK-03", "review")] });
    expect(result.actions).toEqual(expect.arrayContaining([
      { kind: "delete", taskId: "old-pending" },
      { kind: "update", taskId: "old-work", status: "completed", metadata: { disposition: "superseded", superseded_by_plan_hash: NEXT } },
      { kind: "update", taskId: "old-done", status: "completed", metadata: { disposition: "superseded", superseded_by_plan_hash: NEXT } },
    ]));
  });

  test("is idempotent once current items and superseded dispositions exist", () => {
    const current = snapshot("tool-1", "completed", NEXT, "TASK-01");
    const superseded = snapshot("old", "completed", OLD, "TASK-X", "implementation", "superseded");
    expect(reconcileTaskList({ planHash: NEXT, planTasks: [task("TASK-01")], existingItems: [current, superseded] }).actions).toEqual([]);
  });

  test("blocks ambiguous live identity and throws on invalid plans", () => {
    const duplicate = snapshot("two", "pending", NEXT, "TASK-01");
    const result = reconcileTaskList({ planHash: NEXT, planTasks: [task("TASK-01")], existingItems: [snapshot("one", "pending", NEXT, "TASK-01"), duplicate] });
    expect(result.actions).toEqual([expect.objectContaining({ kind: "block", reason: expect.stringContaining("ambiguous") })]);
    expect(() => reconcileTaskList({ planHash: NEXT, planTasks: [task("TASK-01", ["missing"])], existingItems: [] })).toThrow(/missing dependency/);
    expect(() => reconcileTaskList({ planHash: NEXT, planTasks: [task("TASK-01", ["TASK-02"]), task("TASK-02", ["TASK-01"])], existingItems: [] })).toThrow(/cycle/);
  });
});
