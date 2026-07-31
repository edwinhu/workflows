import { validateTask, type TaskContract } from "./task-contract";

export const TASKLIST_ITEM_KINDS = ["implementation", "retry", "blocker", "review", "human-decision", "verification"] as const;
export type TaskItemKind = typeof TASKLIST_ITEM_KINDS[number];
export type PlanTaskIdentity = Readonly<{ planHash: string; plan_task_id: string; item_kind: TaskItemKind }>;
export type ReconciledPlanTask = TaskContract & Readonly<{ dependencies?: readonly string[]; itemKinds?: readonly TaskItemKind[] }>;
export type TaskListSnapshot = Readonly<{
  id: string; status: "pending" | "in_progress" | "completed" | "deleted"; subject: string; description: string;
  blockedBy: readonly string[]; metadata: Readonly<Record<string, unknown>>;
}>;
export type ReconciliationAction =
  | Readonly<{ kind: "create"; planTask: ReconciledPlanTask; metadata: PlanTaskIdentity; blockedByPlanTaskIds: readonly string[] }>
  | Readonly<{ kind: "update"; taskId: string; status: "completed"; metadata: Readonly<{ disposition: "superseded"; superseded_by_plan_hash: string }> }>
  | Readonly<{ kind: "delete"; taskId: string }>
  | Readonly<{ kind: "block"; reason: string; identities: readonly PlanTaskIdentity[] }>;
export type TaskListReconciliation = Readonly<{
  actions: readonly ReconciliationAction[];
  currentImplementationIds: Readonly<Record<string, string>>;
}>;

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const KINDS = new Set<string>(TASKLIST_ITEM_KINDS);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function taskListIdentity(value: PlanTaskIdentity): string {
  if (!value || typeof value !== "object" || !HASH.test(value.planHash) || !ID.test(value.plan_task_id) || !KINDS.has(value.item_kind)) throw new Error("invalid canonical TaskList identity");
  return `${value.planHash}:${value.plan_task_id}:${value.item_kind}`;
}
function parseIdentity(metadata: Readonly<Record<string, unknown>>): PlanTaskIdentity | null {
  const value = { planHash: metadata.planHash, plan_task_id: metadata.plan_task_id, item_kind: metadata.item_kind } as PlanTaskIdentity;
  try { taskListIdentity(value); return value; } catch { return null; }
}
function itemKinds(task: ReconciledPlanTask): TaskItemKind[] {
  const values = task.itemKinds === undefined ? ["implementation" as const] : [...task.itemKinds];
  if (!values.length || values.some(value => !KINDS.has(value))) throw new Error(`plan task ${task.id} has invalid itemKinds`);
  if (new Set(values).size !== values.length) throw new Error(`plan task ${task.id} has duplicate itemKinds`);
  return values;
}
function dependencies(task: ReconciledPlanTask): string[] {
  const values = task.dependencies === undefined ? [] : [...task.dependencies];
  if (values.some(value => !text(value) || !ID.test(value)) || new Set(values).size !== values.length) throw new Error(`plan task ${task.id} has invalid dependencies`);
  return values;
}
function freezeAction<T extends ReconciliationAction>(action: T): T { return Object.freeze(action); }

/**
 * Pure deterministic reconciliation planner. It never invents TaskList ids or executes tools.
 * Canonical identity is exactly (planHash, plan_task_id, item_kind); prior-plan live work is
 * deleted only while pending and otherwise completed with an explicit superseded disposition.
 */
export function reconcileTaskList(args: Readonly<{
  planHash: string; planTasks: readonly ReconciledPlanTask[]; existingItems: readonly TaskListSnapshot[];
}>): TaskListReconciliation {
  if (!args || typeof args !== "object" || !HASH.test(args.planHash)) throw new Error("reconciliation planHash must be a lowercase SHA-256 digest");
  if (!Array.isArray(args.planTasks) || !Array.isArray(args.existingItems)) throw new Error("planTasks and existingItems must be arrays");
  const tasks = args.planTasks.map(task => ({ ...task, outputs: [...task.outputs], writablePaths: [...task.writablePaths], dependencies: dependencies(task), itemKinds: itemKinds(task) }));
  if (tasks.some(task => !validateTask(task))) throw new Error("planTasks contain an invalid TaskContract");
  const taskIds = new Set<string>();
  for (const task of tasks) { if (!ID.test(task.id)) throw new Error(`invalid plan task id: ${task.id}`); if (taskIds.has(task.id)) throw new Error(`duplicate plan task id: ${task.id}`); taskIds.add(task.id); }
  for (const task of tasks) for (const dependency of task.dependencies) { if (!taskIds.has(dependency)) throw new Error(`plan task ${task.id} has missing dependency: ${dependency}`); if (dependency === task.id) throw new Error(`plan task ${task.id} cannot depend on itself`); }
  const visiting = new Set<string>(), visited = new Set<string>(), byId = new Map(tasks.map(task => [task.id, task]));
  const visit = (id: string): void => { if (visiting.has(id)) throw new Error("plan task dependencies contain a cycle"); if (visited.has(id)) return; visiting.add(id); for (const dep of byId.get(id)!.dependencies) visit(dep); visiting.delete(id); visited.add(id); };
  for (const task of tasks) visit(task.id);

  const snapshots = args.existingItems.map((item, index) => {
    if (!item || typeof item !== "object" || !text(item.id) || !["pending", "in_progress", "completed", "deleted"].includes(item.status) || !text(item.subject) || typeof item.description !== "string" || !Array.isArray(item.blockedBy) || !item.metadata || typeof item.metadata !== "object" || Array.isArray(item.metadata)) throw new Error(`existing TaskList item ${index} is invalid`);
    return item;
  });
  const desired = tasks.flatMap(task => task.itemKinds.map(item_kind => ({ task, identity: { planHash: args.planHash, plan_task_id: task.id, item_kind } as PlanTaskIdentity }))).sort((a, b) => taskListIdentity(a.identity).localeCompare(taskListIdentity(b.identity)));
  const liveByIdentity = new Map<string, TaskListSnapshot[]>();
  for (const item of snapshots) {
    if (item.status === "deleted" || item.metadata.disposition === "superseded") continue;
    const identity = parseIdentity(item.metadata); if (!identity) throw new Error(`existing TaskList item ${item.id} lacks valid canonical identity metadata`);
    const key = taskListIdentity(identity); liveByIdentity.set(key, [...(liveByIdentity.get(key) ?? []), item]);
  }
  const actions: ReconciliationAction[] = [];
  for (const [key, matches] of [...liveByIdentity].sort(([a], [b]) => a.localeCompare(b))) if (matches.length > 1) actions.push(freezeAction({ kind: "block", reason: `ambiguous live TaskList identity: ${key}`, identities: Object.freeze(matches.map(item => parseIdentity(item.metadata)!)) }));
  if (actions.length) return Object.freeze({ actions: Object.freeze(actions), currentImplementationIds: Object.freeze({}) });

  const currentImplementationIds: Record<string, string> = {};
  for (const { task, identity } of desired) {
    const existing = liveByIdentity.get(taskListIdentity(identity))?.[0];
    if (existing) { if (identity.item_kind === "implementation") currentImplementationIds[identity.plan_task_id] = existing.id; continue; }
    const blockedByPlanTaskIds = identity.item_kind === "implementation"
      ? [...task.dependencies]
      : task.itemKinds.includes("implementation") ? [task.id] : [...task.dependencies];
    actions.push(freezeAction({ kind: "create", planTask: Object.freeze(task), metadata: Object.freeze(identity), blockedByPlanTaskIds: Object.freeze(blockedByPlanTaskIds) }));
  }
  const desiredKeys = new Set(desired.map(item => taskListIdentity(item.identity)));
  for (const item of snapshots.sort((a, b) => a.id.localeCompare(b.id))) {
    if (item.status === "deleted" || item.metadata.disposition === "superseded") continue;
    const identity = parseIdentity(item.metadata)!;
    if (identity.planHash === args.planHash && desiredKeys.has(taskListIdentity(identity))) continue;
    if (item.status === "pending") actions.push(freezeAction({ kind: "delete", taskId: item.id }));
    else actions.push(freezeAction({ kind: "update", taskId: item.id, status: "completed", metadata: Object.freeze({ disposition: "superseded", superseded_by_plan_hash: args.planHash }) }));
  }
  return Object.freeze({ actions: Object.freeze(actions), currentImplementationIds: Object.freeze(currentImplementationIds) });
}
