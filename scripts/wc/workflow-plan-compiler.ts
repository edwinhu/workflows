#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { concretePaths, fingerprint, validateTask, type TaskContract } from "../../workflows/lib/task-contract.ts";

const REQUIRED = ["ID", "Kind", "Path", "Depends On", "Work", "Criteria", "Evidence", "Writable Paths", "Instruction Files", "Model", "Effort"] as const;
const KINDS = new Set(["skill-entry", "skill-midpoint", "skill-phase", "hook", "script", "constraint", "reference", "test", "workflow"]);
const SLUG = /^[a-z0-9][a-z0-9._:-]*$/;
export type CompileResult = { ok: boolean; readyWave: TaskContract[]; fingerprints: Record<string, string>; violations: string[] };

function cells(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return body.split(/(?<!\\)\|/).map(value => value.replaceAll("\\|", "|").trim());
}
function list(value: string): string[] { return value === "-" || !value ? [] : value.split(/\s*,\s*/).filter(Boolean); }
function safe(paths: string[]): boolean { return !!concretePaths(paths); }

export function compileWorkflowPlan(plan: string, projectRoot: string): CompileResult {
  const violations: string[] = [];
  const marker = /^## Workflow Output Manifest\s*$/m.exec(plan);
  if (!marker) return { ok: false, readyWave: [], fingerprints: {}, violations: ["Missing canonical ## Workflow Output Manifest"] };
  const lines = plan.slice(marker.index + marker[0].length).split(/\r?\n/);
  const table: string[] = [];
  let started = false;
  for (const line of lines) {
    if (line.trim().startsWith("|")) { started = true; table.push(line); continue; }
    if (!started && !line.trim()) continue;
    if (started) break;
    return { ok: false, readyWave: [], fingerprints: {}, violations: ["Workflow Output Manifest must begin with its table"] };
  }
  if (table.length < 3) return { ok: false, readyWave: [], fingerprints: {}, violations: ["Workflow Output Manifest has no executable rows"] };
  const headers = cells(table[0]);
  if (headers.length !== REQUIRED.length || REQUIRED.some((name, i) => headers[i] !== name)) violations.push(`Manifest headers must be exactly: ${REQUIRED.join(" | ")}`);
  const seenIds = new Set<string>(), seenOutputs = new Set<string>();
  const tasks: TaskContract[] = [];
  for (let rowIndex = 2; rowIndex < table.length; rowIndex++) {
    const row = cells(table[rowIndex]);
    if (row.length !== REQUIRED.length) { violations.push(`Row ${rowIndex}: expected ${REQUIRED.length} cells, got ${row.length}`); continue; }
    const [id, kind, path, dependsRaw, work, criterion, evidence, writableRaw, instructionsRaw, model, effort] = row;
    if (!SLUG.test(id)) violations.push(`Row ${rowIndex}: invalid task ID ${id}`);
    if (seenIds.has(id)) violations.push(`Row ${rowIndex}: duplicate task ID ${id}`); else seenIds.add(id);
    if (!KINDS.has(kind)) violations.push(`Row ${rowIndex}: unknown file kind ${kind}`);
    if (!safe([path])) violations.push(`Row ${rowIndex}: unsafe output path ${path}`);
    if (seenOutputs.has(path)) violations.push(`Row ${rowIndex}: duplicate output ${path}`); else seenOutputs.add(path);
    const writablePaths = list(writableRaw);
    if (!safe(writablePaths) || !writablePaths.includes(path)) violations.push(`Row ${rowIndex}: writable paths must be concrete and include ${path}`);
    if (!work) violations.push(`Row ${rowIndex}: Work is required`);
    if (!criterion) violations.push(`Row ${rowIndex}: Criteria is required`);
    if (!evidence) violations.push(`Row ${rowIndex}: Evidence is required`);
    const depends = list(dependsRaw);
    const instructionFiles = list(instructionsRaw).map(item => item.startsWith("/") ? item : resolve(projectRoot, item));
    const task: TaskContract = {
      id, name: `${kind}: ${path}`, work,
      criteria: `${criterion}\nEvidence: ${evidence}`,
      outputs: [path], writablePaths, instructionFiles,
      dependencyProof: depends.join(", "), model, effort,
    };
    if (!validateTask(task)) violations.push(`Row ${rowIndex}: task contract is incomplete`);
    tasks.push(task);
  }
  const byId = new Map(tasks.map(task => [task.id, task]));
  const deps = new Map(tasks.map(task => [task.id, list(task.dependencyProof ?? "")]));
  for (const task of tasks) for (const dep of deps.get(task.id) ?? []) {
    if (!seenIds.has(dep)) violations.push(`Task ${task.id}: unknown dependency ${dep}`);
    if (dep === task.id) violations.push(`Task ${task.id}: self dependency is forbidden`);
  }
  const ordered: TaskContract[] = [], visiting = new Set<string>(), visited = new Set<string>();
  function visit(id: string): void {
    if (visited.has(id) || !byId.has(id)) return;
    if (visiting.has(id)) { violations.push(`Dependency cycle includes ${id}`); return; }
    visiting.add(id);
    for (const dep of [...(deps.get(id) ?? [])].sort()) visit(dep);
    visiting.delete(id); visited.add(id); ordered.push(byId.get(id)!);
  }
  for (const id of [...byId.keys()].sort()) visit(id);
  const fingerprints = Object.fromEntries(ordered.map(task => [task.id, fingerprint(task)]));
  return { ok: violations.length === 0, readyWave: violations.length ? [] : ordered, fingerprints: violations.length ? {} : fingerprints, violations };
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const planPath = argv.find(arg => !arg.startsWith("--"));
  const projectIndex = argv.indexOf("--project");
  const projectRoot = projectIndex >= 0 ? argv[projectIndex + 1] : process.cwd();
  if (!planPath || !projectRoot) { console.error("usage: bun workflow-plan-compiler.ts PLAN.md --project ROOT [--json]"); process.exit(2); }
  const result = compileWorkflowPlan(readFileSync(planPath, "utf8"), projectRoot);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}
