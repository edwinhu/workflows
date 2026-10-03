#!/usr/bin/env bun
/**
 * openrouter-credits.ts — warn BEFORE the OpenRouter account runs dry. There is no auto top-up (user
 * decision 2026-10-03): the user tops up by hand, so every Jev judge and rule leg depends on someone
 * noticing a low balance in time.
 *
 *   bun scripts/lib/openrouter-credits.ts --session     the SessionStart line (silent when healthy),
 *                                                       plus a notify-send at most once a day when low
 *   bun scripts/lib/openrouter-credits.ts --preflight   canary: exit 1 with the top-up line at <= $0;
 *                                                       low prints the warning and exits 0
 *   bun scripts/lib/openrouter-credits.ts --balance [--fresh]   print the balance
 *   bun scripts/lib/openrouter-credits.ts --sample      silent: refresh the cache under the same hourly
 *                                                       gate (the Jev forecast band's tick)
 *
 * Balance = total_credits - total_usage from GET /api/v1/credits (docs: api-reference/credits/
 * get-remaining-credits; documented as management-key only, answers 200 to the inference key too —
 * measured 2026-10-03), read with the key every Decisions caller uses. At most one API call an hour:
 * the result, a failed read included, is cached in $TMPDIR/openrouter-credits.json, which also
 * records the day of the last desktop notification and, per successful read, one [ms, balance] sample
 * for the Jev forecast band (hooks/jev/forecast.ts; a week, at most 200). An unreachable API, an error status or no key
 * is UNKNOWN and silent — never a false alarm.
 *
 *   OPENROUTER_LOW_BALANCE=3       warn below this many dollars
 *   OPENROUTER_CREDITS_URL         the endpoint (tests point it at a stub); `off` reads nothing, writes nothing
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { OPENROUTER_OUT_OF_CREDITS, openrouterKey, outOfCredits } from '../../hooks/work-hold.ts'
import { addSample, type CreditsCache as Cache } from '../../hooks/jev/forecast.ts'

const HOUR_MS = 3_600_000
const TOPUP = 'https://openrouter.ai/settings/credits'

const cachePath = () => join(process.env.TMPDIR || tmpdir(), 'openrouter-credits.json')

function readCache(): Cache | null {
  try {
    const c = JSON.parse(readFileSync(cachePath(), 'utf8'))
    return typeof c?.checkedAt === 'number' ? c : null
  } catch {
    return null
  }
}

function writeCache(c: Cache): void {
  try { writeFileSync(cachePath(), JSON.stringify(c)) } catch {}
}

export function threshold(): number {
  const raw = process.env.OPENROUTER_LOW_BALANCE
  const t = raw ? Number(raw) : NaN
  return Number.isFinite(t) ? t : 3
}

/** One API read. A 402 is an empty account (balance 0); anything else that is not a balance is null. */
function fetchBalance(): number | null {
  const k = openrouterKey()
  if (k.key === null) return null
  const url = process.env.OPENROUTER_CREDITS_URL || 'https://openrouter.ai/api/v1/credits'
  // The header goes in on stdin as a curl config, so the key is never in argv.
  const r = spawnSync('curl', ['-sS', '--max-time', '4', '-K', '-', '-w', '\n%{http_code}', url], {
    encoding: 'utf8', timeout: 8000,
    input: `header = "Authorization: Bearer ${k.key.replace(/["\\]/g, '')}"\n`,
  })
  if (r.error || r.status !== 0) return null
  const raw = r.stdout || ''
  const nl = raw.lastIndexOf('\n')
  const body = raw.slice(0, nl)
  const status = Number(raw.slice(nl + 1).trim())
  if (outOfCredits(status, body)) return 0
  if (status !== 200) return null
  try {
    const d = JSON.parse(body)?.data
    const total = Number(d?.total_credits), used = Number(d?.total_usage)
    return Number.isFinite(total) && Number.isFinite(used) ? total - used : null
  } catch {
    return null
  }
}

/** The balance, from the cache when it is under an hour old. `fresh` forces a read. */
export function balance(opts: { fresh?: boolean; now?: number } = {}): { balance: number | null; cache: Cache; cached: boolean } {
  const now = opts.now ?? Date.now()
  if (process.env.OPENROUTER_CREDITS_URL === 'off') return { balance: null, cache: { checkedAt: now, balance: null }, cached: true }
  const c = readCache()
  if (c && !opts.fresh && now - c.checkedAt < HOUR_MS) return { balance: c.balance, cache: c, cached: true }
  const b = fetchBalance()
  // A cache written before samples existed still holds one real reading: it is the first sample.
  const prior = c?.samples ?? (c && typeof c.balance === 'number' ? [[c.checkedAt, c.balance] as [number, number]] : undefined)
  const samples = b === null ? prior : addSample(prior, now, b)
  const next: Cache = {
    checkedAt: now, balance: b,
    ...(c?.notifiedOn ? { notifiedOn: c.notifiedOn } : {}),
    ...(samples?.length ? { samples } : {}),
  }
  writeCache(next)
  return { balance: next.balance, cache: next, cached: false }
}

const dollars = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2)

/** The loud line, or null when the balance is healthy or unknown. */
export function warningLine(b: number | null, t = threshold()): string | null {
  if (b === null) return null
  if (b <= 0) return `${OPENROUTER_OUT_OF_CREDITS} (balance ${dollars(b)}). Every Jev judge and rule leg returns UNAVAILABLE until then.`
  if (b < t) return `OpenRouter balance is LOW: ${dollars(b)} (warning below ${dollars(t)}) — top up at ${TOPUP}; there is no auto top-up.`
  return null
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The desktop notification, at most once a calendar day, only where notify-send exists. */
function notifyOnce(line: string, cache: Cache): void {
  if (cache.notifiedOn === today()) return
  const which = spawnSync('sh', ['-c', 'command -v notify-send'], { encoding: 'utf8', timeout: 2000 })
  if (which.status !== 0) return
  spawnSync('notify-send', ['-u', 'critical', '-a', 'workflows', 'OpenRouter credits', line], { timeout: 5000 })
  writeCache({ ...cache, notifiedOn: today() })
}

/** SessionStart: the line to show (null when silent), notifying the desktop on the way. */
export function sessionLine(): string | null {
  const { balance: b, cache } = balance()
  const line = warningLine(b)
  if (line) notifyOnce(line, cache)
  return line
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.includes('--preflight')) {
    let { balance: b, cached } = balance()
    // A cached empty account is re-read: the user may have topped up inside the hour.
    if (cached && b !== null && b <= 0) b = balance({ fresh: true }).balance
    const line = warningLine(b)
    if (b !== null && b <= 0) {
      console.log(`FAIL [credits] ${line}`)
      process.exit(1)
    }
    if (line) console.log(`canary: WARNING ${line}`)
    process.exit(0)
  }
  if (args.includes('--balance')) {
    const { balance: b } = balance({ fresh: args.includes('--fresh') })
    console.log(b === null ? 'OpenRouter balance: unknown (no key, API unreachable or an error status)' : `OpenRouter balance: ${dollars(b)}`)
    const line = warningLine(b)
    if (line) console.log(line)
    process.exit(0)
  }
  if (args.includes('--sample')) {
    balance()
    process.exit(0)
  }
  if (args.includes('--session')) {
    const line = sessionLine()
    if (line) console.log(line)
    process.exit(0)
  }
  console.error('usage: openrouter-credits.ts --session | --preflight | --balance [--fresh] | --sample')
  process.exit(2)
}
