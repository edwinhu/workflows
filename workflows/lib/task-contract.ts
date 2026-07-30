import { lstatSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

export type TaskContract = {
  id: string; name: string; work: string; criteria: string; outputs?: string[]; writablePaths: string[];
  instructionFiles?: string[]; dependencyProof?: string; model: string; effort: string;
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

export function validateTask(task: unknown): task is TaskContract {
  if (!task || typeof task !== "object") return false;
  const value = task as Record<string, unknown>;
  return ["id", "name", "work", "criteria", "model", "effort"].every(key => requiredText(value[key])) && !!concretePaths(value.writablePaths)
    && (value.instructionFiles === undefined || (Array.isArray(value.instructionFiles) && value.instructionFiles.every(path => requiredText(path) && path.startsWith("/"))));
}
export function fingerprint(task: TaskContract): string { return JSON.stringify({ id: task.id, name: task.name, work: task.work, criteria: task.criteria, outputs: task.outputs || [], writablePaths: task.writablePaths, dependencyProof: task.dependencyProof || "", model: task.model, effort: task.effort }); }
export function changedFilesWithin(task: TaskContract, changedFiles: unknown, projectRoot: string): changedFiles is string[] {
  const paths = concretePaths(task.writablePaths);
  return !!paths && writablePathsWithin(projectRoot, paths) && Array.isArray(changedFiles) && changedFiles.every(file =>
    typeof file === "string" && !!concretePaths([file]) && canonicalPathWithin(projectRoot, file)
      && [...paths].some(allowed => pathsOverlap(file, allowed)));
}
