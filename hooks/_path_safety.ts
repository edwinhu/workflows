import { lstatSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Normalize an untrusted project-relative path to its REAL location inside the project.
 *
 * WHY THE RETURN VALUE IS CANONICAL, NOT LEXICAL
 *   Both callers authorize by comparing the project-relative prefix against a permitted-directory
 *   list. Rejecting a literal `..` and then returning the lexical path made that comparison a
 *   statement about the SPELLING of the path, not about where the bytes land. Live escape, measured
 *   against `implementer-identity-gate` with an APPROVED `dev` receipt: the approving actor creates
 *   `.planning/out -> ../src`, writes `.planning/out/a.ts`, the prefix check sees `.planning/` and
 *   allows, and the file lands in `src/a.ts`. `.claude` is permitted by every workflow and gives the
 *   same escape, with the extra step of then executing what was written as an opaque executable.
 *
 *   So the target AND every ancestor are resolved through `realpath` before authorization, and the
 *   canonical path is what is returned. `.planning/out/a.ts` now presents as `src/a.ts` and is
 *   denied; a symlink pointing outside the project fails containment and is denied outright.
 *
 * WHAT CANONICALIZATION STILL DOES NOT DECIDE — READ THIS BEFORE CALLING THE CHECK DISPOSITIVE
 *   1. HARD LINKS. `realpath` resolves names to a path; it cannot see that two paths share one
 *      inode. `ln src/a.ts .planning/a.ts` yields a permitted, fully canonical, containment-passing
 *      project-relative path whose Write truncates `src/a.ts`. There is no canonical form that
 *      distinguishes it, so it is rejected structurally instead: a resolved target with a link count
 *      above one is refused, because a multiply-linked leaf cannot be authorized by its own path.
 *      The cost is that a legitimately hardlinked file under `.planning` is unwritable, which is
 *      the right trade for a directory of generated planning artifacts.
 *   2. BIND MOUNTS AND FIRMLINKS. Hard links were NOT the last aliasing case, which an earlier
 *      version of this header implied by naming only them. `mount --bind src /project/.planning/out`
 *      (Linux) and an APFS firmlink (macOS) both make one directory reachable under two paths with
 *      no symlink and no raised link count: `realpath` reports the alias as its own real location
 *      and `nlink` on the leaf is 1. Nothing computed from the path or from `lstat` distinguishes
 *      them, and unlike the hard-link case there is no structural signal to reject on. Establishing
 *      either requires privileges the gated actor does not have through this tool, which is the
 *      bound — not that the check sees them.
 *   3. TOCTOU, WHICH IS STRUCTURAL AT PreToolUse AND NOT FIXABLE HERE. This gate resolves the path
 *      at HOOK time; the tool re-resolves it at WRITE time. Between the two, a concurrent Bash call
 *      can replace `.planning/notes.md` with a symlink to `src/a.ts`, and the write follows the new
 *      link. Nothing a PreToolUse hook can compute closes that window — only the tool performing the
 *      write under the resolved handle could. What narrows it in practice is that the same actor's
 *      Bash is itself gated, not that this function is atomic.
 */
export function safeProjectPath(projectDir: string, value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.includes("\\")) return null;
  if (value.split(/[\\/]+/).some(part => part === "..")) return null;
  const root = canonicalExisting(projectDir);
  if (!root) return null;
  const target = resolve(root, value);
  if (!contained(root, target)) return null;
  // Resolves symlinked ancestors, then the leaf itself — including a dangling one, whose target is
  // where a write actually lands — so a path is judged by where it points, not by how it is spelled.
  const canonical = canonicalPossiblyMissing(target);
  if (!canonical || !contained(root, canonical)) return null;
  const leaf = resolveLeafLink(canonical);
  if (!leaf || !contained(root, leaf)) return null;
  return multiplyLinked(leaf) ? null : leaf;
}

/**
 * True for an existing file reachable under more than one name, i.e. a hard link.
 *
 * A missing leaf has no links yet and is fine; an `lstat` that fails for any other reason is treated
 * as "cannot vouch for it" and refused by the callers, consistent with failing closed.
 */
function multiplyLinked(path: string): boolean {
  try { return lstatSync(path).nlink > 1; } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

/**
 * The project-relative form of `safeProjectPath`, which is what every caller actually authorizes on.
 *
 * Both gates were computing it as `path.slice(cwd.length + 1)` against the RAW cwd, while the path
 * being sliced is rooted at the CANONICAL cwd. The two agree only when the project directory
 * contains no symlink, and when they disagree the prefix comparison is made against a garbled
 * string. Deriving it here removes the second copy of the rule as well.
 */
export function projectRelativePath(projectDir: string, value: unknown): string | null {
  const root = canonicalExisting(projectDir);
  const target = safeProjectPath(projectDir, value);
  if (!root || !target) return null;
  const rel = relative(root, target);
  return rel && !rel.startsWith("..") ? rel : null;
}

/**
 * WHY A REJECTED PATH NEEDS TO SAY WHICH RULE REJECTED IT.
 *
 * `safeProjectPath` returns `null` for three unrelated reasons, and both callers rendered all three
 * as the SAME message: "the orchestrator may only write .planning, .claude". For a hard link at
 * `.planning/a.ts` that message names the directory the file is already in, so the denial reads as
 * a bug in the permitted-directory list rather than as the aliasing rejection it is — and the
 * obvious "fix" is to widen the list, which reopens the escape. This returns the distinguishing
 * clause, or `null` when the path is simply outside the permitted set and the caller's own message
 * is already correct.
 */
export function aliasRejectionReason(projectDir: string, value: unknown): string | null {
  if (safeProjectPath(projectDir, value) !== null) return null;
  if (typeof value !== "string" || !value.trim()) return null;
  const root = canonicalExisting(projectDir);
  if (!root) return null;
  const target = resolve(root, value);
  const canonical = canonicalPossiblyMissing(target);
  const leaf = canonical ? resolveLeafLink(canonical) : null;
  if (leaf && multiplyLinked(leaf)) {
    return `\`${value}\` is a HARD LINK (link count above one), so the same bytes are reachable under another path and writing it cannot be authorized by this path. This is not a permitted-directory problem — widening the permitted list would not and should not admit it.`;
  }
  // Only report a symlink when resolution actually MOVED the path. A path that is simply outside
  // the project root did not alias anything, and calling it a symlink escape is its own false
  // diagnosis — the exact failure mode this function exists to prevent.
  const resolvedElsewhere = (leaf ?? canonical) !== null && (leaf ?? canonical) !== target;
  if (resolvedElsewhere && (!canonical || !contained(root, canonical) || (leaf && !contained(root, leaf)))) {
    return `\`${value}\` resolves through a symlink to \`${leaf ?? canonical}\`, outside the project root. A path is judged by where it points, not by how it is spelled.`;
  }
  return null;
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

/**
 * Follow a leaf that is itself a symlink, including a DANGLING one, to where a write would land.
 *
 * `canonicalPossiblyMissing` walks up to the nearest existing ancestor, so it resolves symlinked
 * DIRECTORIES but stops at a leaf whose target does not exist yet — and a write through a dangling
 * link creates the file at the link's target. Both callers need the same answer, and keeping two
 * copies of a symlink resolver is how they drift apart.
 *
 * THE RESOLVER IS SHARED; THE POLICY DELIBERATELY IS NOT. Do not "fix" the two callers into
 * agreement — they are asking different questions:
 *   - `safeProjectPath` authorizes a DIRECTORY PREFIX, so a leaf symlink is fine as long as it lands
 *     back inside the permitted root. Following it is the whole point: the path is judged by where
 *     the bytes go.
 *   - `safeExactTarget` authorizes ONE EXACT FILE — a reviewer's verdict receipt. A leaf symlink
 *     there is rejected outright even when its target is inside the root, because an alias to the
 *     right path is still not the file the caller named, and accepting aliases would let a receipt
 *     be written through a name the gate never checked.
 */
export function resolveLeafLink(path: string): string | null {
  try {
    let leaf = path;
    for (let depth = 0; depth < 40; depth += 1) {
      let stat;
      try { stat = lstatSync(leaf); } catch { break; }   // absent leaf: nothing left to follow
      if (!stat.isSymbolicLink()) break;
      const parent = canonicalExisting(dirname(leaf));
      if (!parent) return null;
      leaf = resolve(parent, readlinkSync(leaf));
    }
    return canonicalPossiblyMissing(leaf);
  } catch { return null; }
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
  const leafCanonical = resolveLeafLink(candidate);
  // A hard link is an alias `realpath` cannot see; see the header note on `safeProjectPath`.
  return !!leafCanonical && contained(root, leafCanonical) && !multiplyLinked(leafCanonical);
}

/**
 * True for a write target that is a native generated plan leaf directly inside `~/.claude/plans`.
 *
 * Shared by every gate that must let plan-mode planning proceed, so a relaxation cannot be applied
 * in one gate and forgotten in another — the failure mode that let the mutation guard and the
 * identity gate disagree about what plan mode may write.
 */
export function allowedNativePlanPath(raw: unknown): boolean {
  if (typeof raw !== "string" || !isAbsolute(raw) || raw.includes("\\")) return false;
  const configDir = resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
  const plansDir = join(configDir, "plans");
  const target = resolve(raw);
  if (dirname(target) !== plansDir || extname(target) !== ".md") return false;

  const canonicalConfig = canonicalExisting(configDir);
  const canonicalPlans = canonicalExisting(plansDir);
  const canonicalTarget = canonicalPossiblyMissing(target);
  if (!canonicalConfig || !canonicalPlans || !canonicalTarget) return false;
  try {
    if (!statSync(configDir).isDirectory() || !statSync(plansDir).isDirectory()) return false;
  } catch { return false; }
  if (dirname(canonicalPlans) !== canonicalConfig || !contained(canonicalPlans, canonicalTarget) || dirname(canonicalTarget) !== canonicalPlans) return false;

  try {
    const leaf = lstatSync(target);
    return leaf.isFile() && !leaf.isSymbolicLink();
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/** Split commands on shell chain operators. Prefix approval applies only to one simple command. */
export function hasUnsafeCompoundCommand(command: string): boolean {
  return /(?:^|[^\\])(?:&&|\|\||;|\||`|\$\()/.test(command);
}
