#!/usr/bin/env bun
/**
 * Where `scripts/ensure-plans-directory.ts` records "this session's plans directory is stale" and
 * where `hooks/plans-directory-restart-gate.ts` reads it. Shared so the two can never disagree about
 * the path — a writer and a reader pointing at different directories is a gate that never fires, and
 * a gate that never fires is indistinguishable from a gate that passed.
 *
 * IT IS DELIBERATELY NOT `gettempdir()`, AND THAT IS THE WHOLE POINT OF THIS FILE.
 *   Every other session-scoped record in this plugin uses TMPDIR, and for those it is correct: they
 *   are written by a hook and read by a hook, so both processes inherit Claude Code's environment
 *   and always agree. This marker is different — it is written by a SKILL PREAMBLE, which runs in a
 *   profile-initialized shell, and read by a HOOK, which does not. Measured 2026-08-04 on the
 *   author's machine: the login shell exports `TMPDIR=/home/eh/.tmp` while a subprocess spawned
 *   without the profile sees TMPDIR unset and falls back to `/tmp`. Writer and reader would have
 *   resolved different directories, the gate would have found no marker, and it would have permitted
 *   every session it exists to stop — silently, with a passing test suite, because the tests forced
 *   TMPDIR on both sides and so could not observe the divergence they were meant to catch.
 *
 *   `homedir()` is read from the same `$HOME` by both, which is what makes it safe here.
 *   `tests/plans-directory-gate.test.ts` asserts the path does not move when TMPDIR does.
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Under Claude Code's own directory rather than the project: this is session state, and `.planning/`
 * is for episode records that belong to the repository. Markers are pruned after a week by the
 * writer; nothing else needs to clean them up, because session ids never repeat.
 */
export const PLANS_RESTART_DIR = join(homedir(), ".claude", "plans-restart");

/**
 * Session ids are opaque and are NOT assumed to be filename-safe. Hashing rather than sanitizing
 * avoids the collision a naive `replace(/[^a-z0-9]/g, "-")` would introduce between two distinct ids
 * that differ only in punctuation — which would deny a session that never needed denying.
 */
export function restartMarkerPath(sessionId: string): string {
  return join(PLANS_RESTART_DIR, `${createHash("sha256").update(sessionId).digest("hex").slice(0, 32)}.json`);
}
