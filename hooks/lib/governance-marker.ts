/**
 * The governance opt-in: `.claude-workflows.json`, committed at the repository root.
 *
 * WHY A DEDICATED COMMITTED FILE AND NOT A SETTING
 *   The transition machinery must be opt-in, and the opt-in has to be answerable FROM THE REPO. A key
 *   in `.claude/settings.json` is not: settings resolve Managed > CLI args > Local > Project > User
 *   and most keys OVERRIDE rather than merge, so `~/.claude/settings.json` could govern every project
 *   on a machine invisibly, and `.claude/settings.local.json` — which outranks project settings, and
 *   which Claude Code automatically adds to the global git excludes when it writes there — could
 *   switch governance off in a file kept out of git by design. An opt-in whose whole justification is
 *   that it is committed and reviewable cannot depend on a gitignored sibling that outranks it.
 *
 *   `.planning/` was the other candidate and is gitignored (`.gitignore:40`), as is the sanctioned
 *   `.claude/<plugin>.local.md` settings pattern. Everything this plugin already writes is
 *   deliberately not in git, which is exactly why the marker cannot live with it.
 *
 * WHY IT IS A BOOLEAN AND NOT BARE PRESENCE
 *   Turning enforcement OFF should be a visible one-line diff. A presence-only marker can only be
 *   disabled by deletion, and a deletion reads as though the file was never there.
 *
 * THIS DOES NOT MAKE A PROJECT `governed` IN THE APPROVED-ARTIFACT SENSE.
 *   `hasReceiptSurface` still decides that, and `implementer-identity-gate` still keys on it, both
 *   unchanged. This marker gates the TRANSITION machinery only. The two predicates are deliberately
 *   separate: the identity gate needs an approved plan to compare actors against, while the
 *   transition gate needs only to know the project asked to be governed.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const GOVERNANCE_MARKER = ".claude-workflows.json";

/**
 * Find the governed project root at or above `startDir`, or `undefined`.
 *
 * WHY A WALK AND NOT JUST `cwd`. The marker lives at the REPOSITORY root, but a hook's working
 * directory is wherever the session happens to be. Checking only `cwd` means running Claude from
 * `src/` silently turns governance off — measured: with `payload.cwd` correctly naming the project
 * root, `approved-artifact-persist` still exited 0 and wrote no receipt, because it asked
 * `process.cwd()`. Found by the gemini third-party adapter. A silent skip is the worst shape this can
 * take: the episode looks governed to the user and is not.
 *
 * WHY IT IS BOUNDED AT THE REPOSITORY. An unbounded walk to `/` would let one stray marker in `$HOME`
 * govern every project beneath it — the same shape as the `~/.planning` dotfiles symlink that once
 * classified `$HOME` as governed and cost every session there its Bash. So the walk stops after
 * examining the directory that holds `.git`. A marker above the repository root is deliberately not
 * found: governance is a property a repository opts into, and it must be visible in that repository.
 */
export function governedRoot(startDir: string): string | undefined {
  let cursor: string;
  try {
    cursor = startDir;
  } catch {
    return undefined;
  }
  for (;;) {
    if (existsSync(join(cursor, GOVERNANCE_MARKER))) return cursor;
    // Checked AFTER the marker so a marker sitting at the repository root is still found.
    if (existsSync(join(cursor, ".git"))) return undefined;
    const parent = dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

/**
 * `isGoverned` for a directory that may be anywhere inside the project.
 *
 * Prefer this at every hook entry point. `isGoverned` alone answers only about the exact directory
 * given, which is right for a resolved project root and wrong for a session's working directory.
 */
export function isGovernedFrom(startDir: string): boolean {
  const root = governedRoot(startDir);
  return root !== undefined && isGoverned(root);
}

export function governanceMarkerPath(projectDir: string): string {
  return join(projectDir, GOVERNANCE_MARKER);
}

/**
 * ABSENT IS THE ONLY TOTAL NO-OP, AND THAT CASE IS THE ONE THAT MUST NEVER REGRESS.
 *
 * These hooks run in every project of every user. A project without the marker must be untouched:
 * no denials, no new files, no hook output, byte for byte today's behaviour.
 *
 * PRESENT-BUT-UNREADABLE IS GOVERNED, NOT UNGOVERNED. Reading a malformed marker as "no governance"
 * would make corrupting the file a silent bypass — the same shape as the aliased-receipt bypass this
 * codebase already paid for, where an unclassifiable project was read as permission. A typo
 * therefore ARMS enforcement rather than disabling it. That is the deliberate direction: over-strict
 * is discoverable (you get a denial and go look), silently-off is not.
 *
 * The one way to be present and ungoverned is to say so explicitly, which is the whole point of
 * storing a boolean rather than relying on presence.
 */
export function isGoverned(projectDir: string): boolean {
  let raw: string;
  try {
    raw = readFileSync(governanceMarkerPath(projectDir), "utf8");
  } catch {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return true;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return true;
  const marker = parsed as Record<string, unknown>;
  return marker.governed !== false;
}
