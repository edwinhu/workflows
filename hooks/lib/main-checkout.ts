import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

/**
 * The same repo-relative path in the MAIN checkout, when `abs` sits in a linked worktree of a git
 * repo; null otherwise. A worktree is a second copy of the tree, but user-level state that points
 * into the repo (`~/.claude/agents/*.md` symlinks, gitignored `*.local.md`) points at the main
 * checkout, and must still count when the code under test runs from the worktree.
 */
export function mainCheckoutTwin(abs: string): string | null {
  const dir = dirname(abs);
  const r = spawnSync(
    "git",
    ["-C", dir, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (r.status !== 0) return null;
  const [top, common] = (r.stdout || "").trim().split("\n");
  if (!top || !common || basename(common) !== ".git") return null;
  const main = dirname(common);
  let realTop: string, realMain: string;
  try {
    realTop = realpathSync(top);
    realMain = realpathSync(main);
  } catch {
    return null;
  }
  if (realTop === realMain) return null; // already the main checkout
  const rel = relative(realTop, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return join(realMain, rel);
}

/**
 * Does `linked` (a resolved real path, or null) point at `shipped` (a resolved real path in the
 * tree under test)? Exact match, or the same repo-relative file in the main checkout of the same
 * repo. Anything else — another repo, another path, a missing or dangling link — is false.
 */
export function pointsAtShipped(linked: string | null, shipped: string | null): boolean {
  if (linked === null || shipped === null) return false;
  if (linked === shipped) return true;
  const twin = mainCheckoutTwin(shipped);
  if (twin === null) return false;
  try {
    return realpathSync(twin) === linked;
  } catch {
    return false;
  }
}
