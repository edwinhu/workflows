import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

/** Normalize an untrusted project-relative path; reject aliases before resolving it. */
export function safeProjectPath(projectDir: string, value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.includes("\\")) return null;
  if (value.split(/[\\/]+/).some(part => part === "..")) return null;
  const root = canonicalExisting(projectDir);
  if (!root) return null;
  const target = resolve(root, value);
  return contained(root, target) ? target : null;
}

export function contained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith("/");
}

export function canonicalExisting(path: string): string | null {
  try { return realpathSync(path); } catch { return null; }
}

/** Resolve through every existing ancestor and deny dangling/chained symlink escapes. */
export function canonicalPossiblyMissing(path: string): string | null {
  const missing: string[] = [];
  let candidate = resolve(path);
  for (let depth = 0; depth < 80; depth += 1) {
    try { return resolve(realpathSync(candidate), ...missing); } catch { /* seek existing ancestor */ }
    const parent = dirname(candidate);
    if (parent === candidate) return null;
    missing.unshift(basename(candidate));
    candidate = parent;
  }
  return null;
}

/** True only if a requested (including missing) path resolves inside root without symlink escape. */
export function safeExactTarget(projectDir: string, candidate: string, expected: string): boolean {
  const root = canonicalExisting(projectDir);
  // A verdict target must never be a leaf symlink, including dangling/chained aliases.
  try { if (lstatSync(candidate).isSymbolicLink()) return false; } catch { /* missing leaf is permitted */ }
  const actualCanonical = canonicalPossiblyMissing(candidate);
  const expectedCanonical = canonicalPossiblyMissing(expected);
  if (!root || !actualCanonical || !expectedCanonical || actualCanonical !== expectedCanonical) return false;
  if (!contained(root, actualCanonical)) return false;
  try {
    let leaf = candidate;
    for (let depth = 0; depth < 40 && existsSync(leaf); depth += 1) {
      const stat = lstatSync(leaf);
      if (!stat.isSymbolicLink()) break;
      leaf = resolve(realpathSync(dirname(leaf)), readlinkSync(leaf));
    }
    const leafCanonical = canonicalPossiblyMissing(leaf);
    return !!leafCanonical && contained(root, leafCanonical);
  } catch { return false; }
}

/** Split commands on shell chain operators. Prefix approval applies only to one simple command. */
export function hasUnsafeCompoundCommand(command: string): boolean {
  return /(?:^|[^\\])(?:&&|\|\||;|\||`|\$\()/.test(command);
}
