// The Jev spend forecast: balance, burn rate and days left, from the timestamped balance samples the
// credit-warn script (scripts/lib/openrouter-credits.ts) keeps in its one hourly cache. Pure: no
// Node, no network, so the mod (forecast-mod.ts) and the script share it.
//
// Why samples and not OpenRouter's usage fields: GET /api/v1/credits returns only total_credits and
// total_usage. The usage_daily/_weekly fields are on GET /api/v1/key, per KEY (not the account) and
// for the current UTC day/week (a partial bucket, not a trailing rate), and reading them would be a
// second call each hour (docs api-reference/api-keys/get-current-api-key, checked 2026-10-03).

export type Sample = [atMs: number, balance: number]
export interface CreditsCache { checkedAt: number; balance: number | null; notifiedOn?: string; samples?: Sample[] }
export interface ForecastView { level: 'ok' | 'warn' | 'out'; text: string }

const H = 3_600_000
const DAY = 24 * H
export const WINDOW_MS = DAY //       the trailing window the rate is read over
export const KEEP_MS = 7 * DAY //     samples older than this are dropped; the widened window
export const MIN_SPAN_MS = 3 * H //   less spending time than this is too few samples for a rate
export const STALE_MS = DAY //        a newest sample older than this shows nothing
const MAX_SAMPLES = 200
export const TOPUP = 'https://openrouter.ai/settings/credits'

export function addSample(samples: Sample[] | undefined, at: number, balance: number): Sample[] {
  return [...(samples ?? []).filter(([t]) => at - t < KEEP_MS && t < at), [at, balance] as Sample].slice(-MAX_SAMPLES)
}

/** Dollars a day spent between consecutive samples at or after `from`. A rise is a top-up: its
 *  interval counts as neither spend nor time. Null below MIN_SPAN_MS of spending time. */
function rateFrom(samples: Sample[], from: number): number | null {
  const s = samples.filter(([t]) => t >= from)
  let spent = 0, span = 0
  for (let i = 1; i < s.length; i++) {
    const dt = s[i][0] - s[i - 1][0], db = s[i - 1][1] - s[i][1]
    if (dt <= 0 || db < 0) continue
    spent += db
    span += dt
  }
  return span >= MIN_SPAN_MS ? (spent / span) * DAY : null
}

/** The trailing day's burn, anchored at the newest sample; the kept week when the day is too thin. */
export function burnRate(samples: Sample[] | undefined): { perDay: number } | null {
  if (!samples || samples.length < 2) return null
  const newest = samples[samples.length - 1][0]
  const perDay = rateFrom(samples, newest - WINDOW_MS) ?? rateFrom(samples, newest - KEEP_MS)
  return perDay === null ? null : { perDay }
}

const dollars = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2)

function left(days: number): string {
  if (days >= 1) { const d = Math.round(days); return `~${d} day${d === 1 ? '' : 's'}` }
  return `~${Math.max(1, Math.round(days * 24))}h`
}

/** The band's line, or null when there is nothing true to say: no cache, a newest sample older than
 *  a day, or too few samples for a rate. An empty account needs no rate. */
export function forecast(cache: CreditsCache | null, now: number, threshold: number): ForecastView | null {
  const samples = cache?.samples
  if (!samples?.length) return null
  const [at, balance] = samples[samples.length - 1]
  const age = now - at
  if (age > STALE_MS) return null
  const asOf = age > 1.5 * H ? ` · as of ${Math.round(age / H)}h ago` : ''
  if (balance <= 0) return { level: 'out', text: `Jev OUT OF CREDITS — top up at ${TOPUP} (balance ${dollars(balance)})${asOf}` }
  const rate = burnRate(samples)
  if (!rate) return null
  if (rate.perDay < 0.005) return { level: balance < threshold ? 'warn' : 'ok', text: `Jev ${dollars(balance)} · $0.00/day${asOf}` }
  const days = balance / rate.perDay
  return {
    level: days < 3 || balance < threshold ? 'warn' : 'ok',
    text: `Jev ${dollars(balance)} · ${dollars(rate.perDay)}/day · ${left(days)}${asOf}`,
  }
}
