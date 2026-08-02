import { lstatSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

export type TaskContract = {
  id: string; name: string; work: string; criteria: string; outputs: string[]; writablePaths: string[];
  instructionFiles?: string[]; dependencyProof?: string; model: string; effort: string;
  /**
   * The command that must FAIL before this task is implemented and PASS after — TDD's "valid RED",
   * as something the runtime executes rather than something an agent reports.
   *
   * It was doctrine in four SKILL.md files and enforced in none: the task contract checked only that
   * `work` and `criteria` were nonempty strings, the generated prompt asked for "task-local
   * evidence", the result schema had no RED field at all, and the gate adjudicated filesystem
   * observations only. An implementer could skip the failing test entirely, produce exactly the
   * declared files, report them accurately, and pass. Nothing anywhere recorded whether a test ran
   * before the implementation, whether it failed, or why.
   */
  redCommand?: string;
};
export type TaskResult = {
  taskId: string; taskFingerprint: string; approvedBodyHash: string; session: string;
  status: "implemented" | "blocked" | "failed"; summary: string; reusableFacts: string[]; changedFiles: string[];
};
export function requiredText(value: unknown): value is string { return typeof value === "string" && !!value.trim(); }
export function concretePaths(paths: unknown): Set<string> | null {
  if (!Array.isArray(paths) || !paths.length) return null;
  const values = paths.map(path => typeof path === "string" ? path.trim() : "");
  return values.every(path => path && !path.startsWith("/") && !path.includes("\\") && !/[?*\[\]{}]/.test(path) && !path.endsWith("/") && path.split("/").every(part => part && part !== "." && part !== "..")) ? new Set(values) : null;
}
export function pathsOverlap(left: string, right: string): boolean { return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`); }

/**
 * Fail closed unless a project-relative path has a stable, non-symlink route below the
 * canonical project root. Missing leaves inherit the nearest existing ancestor's identity.
 */
export function canonicalPathWithin(projectRoot: string, relativePath: string): boolean {
  if (!concretePaths([relativePath])) return false;
  try {
    const root = realpathSync(projectRoot);
    let current = root;
    const parts = relativePath.split("/");
    for (let index = 0; index < parts.length; index++) {
      const candidate = resolve(current, parts[index]);
      if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return false;
      try {
        const stat = lstatSync(candidate);
        // A link is never stable writable authority, including dangling and internal aliases.
        if (stat.isSymbolicLink()) return false;
        current = candidate;
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) return false;
        const unresolved = resolve(current, ...parts.slice(index));
        return unresolved === root || unresolved.startsWith(`${root}${sep}`);
      }
    }
    return current === root || current.startsWith(`${root}${sep}`);
  } catch {
    return false;
  }
}

export function writablePathsWithin(projectRoot: string, writablePaths: unknown): boolean {
  const paths = writablePaths instanceof Set ? writablePaths : concretePaths(writablePaths);
  return !!paths && [...paths].every(path => canonicalPathWithin(projectRoot, path));
}

export function normalizeExpectedOutputs(outputs: unknown): string[] {
  const paths = concretePaths(outputs);
  if (!paths) throw new Error("expected outputs must be a non-empty concrete project-relative inventory");
  if ((outputs as unknown[]).length !== paths.size) throw new Error("expected outputs contain duplicate paths");
  return [...paths].sort((left, right) => left.localeCompare(right, "en", { sensitivity: "variant" }));
}

export function validateTask(task: unknown): task is TaskContract {
  if (!task || typeof task !== "object") return false;
  const value = task as Record<string, unknown>;
  let outputsValid = false;
  try { normalizeExpectedOutputs(value.outputs); outputsValid = true; } catch { outputsValid = false; }
  return ["id", "name", "work", "criteria", "model", "effort"].every(key => requiredText(value[key])) && !!concretePaths(value.writablePaths) && outputsValid
    && (value.instructionFiles === undefined || (Array.isArray(value.instructionFiles) && value.instructionFiles.every(path => requiredText(path) && path.startsWith("/"))))
    && (value.redCommand === undefined || requiredText(value.redCommand));
}
export function fingerprint(task: TaskContract): string { return JSON.stringify({ id: task.id, name: task.name, work: task.work, criteria: task.criteria, outputs: normalizeExpectedOutputs(task.outputs), writablePaths: task.writablePaths, dependencyProof: task.dependencyProof || "", model: task.model, effort: task.effort, redCommand: task.redCommand || "" }); }
export function changedFilesWithin(task: TaskContract, changedFiles: unknown, projectRoot: string): changedFiles is string[] {
  const paths = concretePaths(task.writablePaths);
  return !!paths && writablePathsWithin(projectRoot, paths) && Array.isArray(changedFiles) && changedFiles.every(file =>
    typeof file === "string" && !!concretePaths([file]) && canonicalPathWithin(projectRoot, file)
      && [...paths].some(allowed => pathsOverlap(file, allowed)));
}

function exactReportedPaths(paths: unknown, label: string): string[] {
  if (!Array.isArray(paths)) throw new Error(`${label} must be an array`);
  const concrete = concretePaths(paths);
  if (!concrete) throw new Error(`${label} must contain concrete project-relative paths`);
  if (concrete.size !== paths.length) throw new Error(`${label} contains duplicate paths`);
  return [...concrete].sort((left, right) => left.localeCompare(right, "en", { sensitivity: "variant" }));
}

export function enforceTaskOutputs(task: TaskContract, observedChangedFiles: unknown, reportedChangedFiles: unknown): string[] {
  const expected = normalizeExpectedOutputs(task.outputs);
  const writable = concretePaths(task.writablePaths);
  if (!writable) throw new Error("task writable authority is invalid");
  for (const output of expected) {
    if (![...writable].some(allowed => pathsOverlap(output, allowed))) throw new Error(`expected output is outside writable authority: ${output}`);
  }
  const observed = exactReportedPaths(observedChangedFiles, "observed changed files");
  const outsideAuthority = observed.filter(path => ![...writable].some(allowed => pathsOverlap(path, allowed)));
  if (outsideAuthority.length) throw new Error(`observed output is outside writable authority: ${outsideAuthority.join(", ")}`);
  const reported = exactReportedPaths(reportedChangedFiles, "reported changed files");
  const expectedSet = new Set(expected);
  const observedSet = new Set(observed);
  const missing = expected.filter(path => !observedSet.has(path));
  if (missing.length) throw new Error(`required output was not produced: ${missing.join(", ")}`);
  const extra = observed.filter(path => !expectedSet.has(path));
  if (extra.length) throw new Error(`unexpected output was produced: ${extra.join(", ")}`);
  if (observed.length !== reported.length || observed.some((path, index) => path !== reported[index])) throw new Error("changed-file report mismatch");
  return expected;
}
