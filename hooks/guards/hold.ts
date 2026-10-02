// The work hold's per-session state file name and its version-skew diagnosis, node-free so the
// mod's cron-delete guard can read them. work-hold.ts re-exports both.

/** `work-hold-<session>.json` under `tmp` (TMPDIR, else os.tmpdir()). */
export function holdStateName(session: string): string {
  return `work-hold-${session}.json`
}

/**
 * How long an armed hold may go unevaluated before the silence is itself the evidence.
 *
 * A round is one Stop, and a session working under a hold stops far more often than this; ten
 * minutes is longer than any single turn and shorter than the shortest ceiling, so it cannot fire on
 * a hold that was merely armed a moment ago.
 */
export const UNEVALUATED_AFTER_SECONDS = 600

/**
 * The version-skew diagnosis, as a sentence — or null when the hook is demonstrably running.
 *
 * Read by work-hold.ts `--status` and by the cron-delete guard, which is the OTHER half of the incident: that
 * guard enforces an armed hold from its own unchanged path, so the two disagree about whether
 * anything is alive. It still denies; it just stops being silent about why the hold is not moving.
 */
export function unevaluatedNote(
  s: { startedAt: number; lastEvaluatedAt?: number },
  nowSeconds: number,
): string | null {
  if (typeof s.lastEvaluatedAt === 'number') return null
  const age = Math.floor((nowSeconds - s.startedAt) / 60)
  if (age * 60 < UNEVALUATED_AFTER_SECONDS) return null
  return (
    `never evaluated since arm ${age}m ago — this session's Stop hook is not running work-hold.ts; ` +
    `run /reload-plugins`
  )
}
