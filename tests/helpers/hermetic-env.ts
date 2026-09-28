/**
 * The child env for any test that spawns a session-scoped hook or script.
 *
 * A suite run from inside a live Claude Code session inherits that session's identity and its
 * TMPDIR, and a hook that reads either answers about the REAL session instead of the fixture.
 * Measured 2026-09-27: four `cron-delete-guard` tests denied, quoting the running session's own
 * hold ledger (`passed`, checking a `.craft` run in an unrelated repo). The hook's ambient
 * fallback was removed; this is the other half, so a future fallback cannot silently re-open it.
 *
 * TMPDIR is NOT defaulted here — session-scoped state is keyed by session id under TMPDIR, so each
 * test must pass its own fresh directory and a test that forgets should be visibly wrong, not
 * quietly sharing one.
 */
const { CLAUDE_CODE_SESSION_ID: _sid, CLAUDE_CODE_BRIDGE_SESSION_ID: _bid, ...rest } = process.env

/** `process.env` with every ambient session identity stripped. */
export const HERMETIC_ENV: Record<string, string> = rest as Record<string, string>

/** `HERMETIC_ENV` plus this test's own TMPDIR and whatever else it pins. */
export function hermeticEnv(
  dir: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { ...HERMETIC_ENV, TMPDIR: dir, ...extra }
}
