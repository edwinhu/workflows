#!/usr/bin/env bun
/**
 * Stop hook: refuse an EARLY stop — a turn that ends while work the user asked for is still owed.
 *
 * The four endings this exists to catch are the user's own rule, verbatim: a summary that announces
 * the next step instead of taking it; an offer to carry on "unless you'd prefer otherwise"; a list
 * of decisions none of which blocks the rest; stopping because a milestone felt like a good place to
 * report. A message with no tool call stops the work until the user comes back, so each of them
 * costs a round trip that the session could have spent working.
 *
 * WHO IT NEVER FIRES FOR. Unattended children carry the standing instruction in their prompt
 * instead: `FARM_OUT_CHILD=1` (farm-out and farm-team runners) and `GRIND_ITERATION` (a grind
 * iteration) allow immediately, before anything else is read. A child blocked by a judge nobody is
 * watching is a loop with no operator in it.
 *
 * WHAT MAKES IT SAFE rather than a trap, in the order the code checks them:
 *
 *   1. FAILS OPEN EVERYWHERE. No judge, no key, no network, an unparsable answer, an unreadable
 *      transcript, a counter that cannot be read or written — every one of them allows the stop. The
 *      harness's own 20 s hook timeout is the outer bound: a killed hook emits nothing, also an allow.
 *   2. BOUNDED. At most MAX_BLOCKS_PER_TURN blocks per USER turn, counted per session in TMPDIR.
 *      The bound is the counter rather than `stop_hook_active` because it is strictly stronger: it
 *      caps every stop in the turn, not just the ones that directly follow a block. The turn marker
 *      is the last genuine user message's uuid, and hook feedback is NOT one — the harness records a
 *      blocked stop as a `type:"user"` entry with `isMeta:true`, which `latestUserTurn` skips, so
 *      this hook's own blocks cannot rotate the key that caps them.
 *   3. NEVER DOUBLE-BLOCKS WITH `work-hold`. An armed hold is already holding the session on an
 *      objective and speaks for itself; this one stands down for the duration. The exception is an
 *      afk hold with no check and no run before its ceiling: `work-hold.ts` allows every such stop,
 *      so this hook speaks for it, with reasons that never send the model to AskUserQuestion.
 *   4. NEVER BLOCKS WHILE THE WATCHER WILL WAKE THE SESSION. When a farm or work run this session
 *      launched is still live and the watcher mod (`hooks/watch/watcher.ts`) is running here — its
 *      beacon is fresh — the owed work is in flight and its finish arrives as a `$.prompt.submit`, so a
 *      block would only force busy-work. See `liveOwnedRuns` and `watcherActive`.
 *
 * The judge is the one `work-hold.ts` already uses — Jev, through the Decisions API — reached
 * through that file's exported `decisionsCall`/`parseNoul`. There is exactly one Decisions transport
 * in this plugin and this hook does not add a second.
 *
 * Opt out for a session with `EARLY_STOP_HOOK=0`. Tune the bar with `EARLY_STOP_THRESHOLD` (default 0.8); an
 * answer from the luna fallback is held to at least 0.95 (`decisionThreshold`, applied in `parseNoul`).
 */

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ceilingReached, decisionsCall, lastLedgerEntry, ledgerPath, parseNoul, statePath } from './work-hold.ts'
import {
  BEACON, beaconFresh, classify, dirname, parseEvents, wakeable, WAKE_HORIZON_MS, type Facts, type Run,
} from './watch/runs.ts'

/** Blocks allowed per user turn. Two is one more chance than the session gets by itself. */
export const MAX_BLOCKS_PER_TURN = 2

/**
 * The bar on Jev's probability. On the 62-stop calibration set (tests/fixtures/early-stop-cal,
 * scripts/early-stop-cal.ts) no bar separates EARLY from LEGIT stops, so the bar stays high and the
 * deterministic `noWakeUnderMandate` leg catches the stops the judge cannot.
 */
export const DEFAULT_THRESHOLD = 0.8

/** The Decisions question key. One question, one bit. */
export const QUESTION_KEY = 'early_stop'

/** Characters of the user's request and of the final message the judge is shown. */
export const REQUEST_CHARS = 2000
export const MESSAGE_CHARS = 4000
/** Characters of the standing mandate and of the latest typed message. */
export const MANDATE_CHARS = 1500
export const TYPED_CHARS = 600

const tmp = (): string => process.env.TMPDIR || tmpdir()

/**
 * The per-session block counter.
 *
 * A session id is opaque, and this is a FILENAME component, so anything that could introduce a path
 * separator or a `..` is replaced by a digest of the raw id rather than deleted — deletion is not
 * injective and would let two sessions share one counter (the `sessionFlagKey` lesson in
 * `_gate_common.ts`). A real session id survives unchanged, so the file is the documented
 * `early-stop-<session>.json`.
 */
export function counterPath(session: string): string {
  const safe = session.replace(/[^A-Za-z0-9._-]/g, '')
  const name =
    safe === session && safe
      ? session
      : `${safe.slice(0, 64)}-${createHash('sha256').update(session, 'utf8').digest('hex').slice(0, 32)}`
  return join(tmp(), `early-stop-${name}.json`)
}

/** One line per decision, for reading back what this hook did and why. */
export function auditPath(): string {
  return join(tmp(), 'early-stop.log')
}

export interface Turn {
  /** The user message's uuid: the key the per-turn cap is counted against. */
  marker: string
  /** What the user actually asked for. */
  request: string
}

/**
 * The latest GENUINE user request, by the turn-boundary rule `teammate-idle-report-check.sh`
 * documents: a `type:"user"` entry whose `.message.content` is a STRING, with `.isMeta` falsey and
 * no `.toolUseResult`. The other two shapes are system injections and tool results, and the first of
 * those is what a blocked stop is recorded as — counting it as a new turn would uncap this hook.
 *
 * Scanned from the END: the newest boundary is normally within the last few entries, and a
 * transcript is megabytes by mid-session.
 */
export function latestUserTurn(jsonl: string): Turn | null {
  const lines = jsonl.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.trim()) continue
    let e: Record<string, unknown>
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e?.type !== 'user') continue
    const msg = e?.message as { content?: unknown } | undefined
    if (typeof msg?.content !== 'string') continue
    if (e?.isMeta) continue
    if (e?.toolUseResult !== undefined && e?.toolUseResult !== null) continue
    return { marker: typeof e.uuid === 'string' && e.uuid ? e.uuid : 'unknown', request: msg.content }
  }
  return null
}

/**
 * The user's own words that set a standing, unattended mandate, not a one-off request. Only a clear
 * sign-off counts; a bare word like "overnight" or "keep going" talks about the mode as readily as it sets it.
 */
const STANDING =
  /don'?t ask|do not ask|whatever you think|do whatever|go(ing)? to (bed|sleep)|asleep|while i'?m (away|out|gone|sleeping)|work (on this )?(overnight|autonomously)|without (asking|checking in)|until i (get back|return)|full discretion/i

/** What the assistant's tick, wake and local-command traffic looks like when its origin tag is absent. */
const NOT_TYPED = /^(\s*<pasted_content|\s*(Spawned agent |Relaunched from the |User rulings?[: (]|From the \w+ session|New task \(from )|and\? \(|<task-notification>|<bash-|<local-command|The [\w-]+ plugin sent a message|This session is being continued|Caveat:)/

/**
 * Was this `type:"user"` string entry typed by the human? The harness tags it: `origin.kind` is
 * `human` for typed and queued input, and a non-human kind (a task notification, a plugin, an
 * auto-continuation) for everything it injects. A cron tick is `isMeta` and never reaches here. Older transcripts
 * carry no tag, so the text shape decides there.
 */
export function typedByHuman(e: Record<string, unknown>, text: string): boolean {
  if (NOT_TYPED.test(text)) return false
  const kind = (e.origin as { kind?: unknown } | undefined)?.kind
  if (typeof kind === 'string') return kind === 'human'
  const turn = e.turnOrigin
  return typeof turn === 'string' ? turn === 'human' : e.promptSource === undefined
}

/** A short question ("did you use overnight autonomous?") talks about a mandate; it does not set one. */
const MONITOR_LIVE_MS = 45 * 60_000
const INTERROGATIVE = new RegExp(
  '^(?:(?:how|what|why|when|where|which|who)\\b' +
    '|(?:is|are|was|were|do|does|did|can|could|should|would|will|has|have)\\s+(?:i|you|we|it|they|he|she|this|that|there|the|my|your|our)\\b)',
  'i',
)
const isQuestion = (t: string): boolean => {
  const s = t.trim()
  return s.length < 200 && (s.endsWith('?') || INTERROGATIVE.test(s))
}

export interface JudgeContext {
  /** The newest typed message that carries a standing instruction, if any. */
  standing: string | null
  /** The newest typed message at all, when it is a different message. */
  latestTyped: string | null
  /** Hours from that typed message to the end of the transcript. */
  hoursSinceTyped: number | null
  /** Recurring CronCreate jobs created and not yet cancelled. */
  heartbeatAlive: boolean
  /** A Monitor event arrived in the last 45 minutes: a persistent monitor is still watching and will wake it. */
  monitorLive: boolean
  /** A CronDelete returned "Cancelled job" since the turn's request. */
  deletedThisTurn: boolean
}

/**
 * The deterministic facts the judge cannot see in a wake-up message: the standing mandate the user
 * typed hours ago, and whether the heartbeat that re-enters the session still exists. One pass over
 * the transcript, newest entries scanned for the typed messages, every entry for the cron ledger.
 * `holdGoal` is the goal of this session's armed `/afk` hold, see `afkHoldGoal`.
 */
export function judgeContext(jsonl: string, holdGoal?: string | null): JudgeContext {
  const lines = jsonl.split('\n')
  let standing: string | null = null
  let latest: string | null = null
  let latestAt = ''
  let lastAt = ''
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.trim()) continue
    if (!lastAt) lastAt = line.match(/"timestamp":"([^"]+)"/)?.[1] ?? ''
    if (!line.includes('"type":"user"') || !line.includes('"content":"')) continue
    let e: Record<string, unknown>
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    const text = (e?.message as { content?: unknown } | undefined)?.content
    if (e?.type !== 'user' || typeof text !== 'string' || e.isMeta || e.isSidechain) continue
    if (e.toolUseResult !== undefined && e.toolUseResult !== null) continue
    if (!typedByHuman(e, text)) continue
    if (latest === null) {
      latest = text
      latestAt = typeof e.timestamp === 'string' ? e.timestamp : ''
    }
    if (STANDING.test(text) && !isQuestion(text)) {
      standing = text
      break
    }
  }
  const created = new Set<string>()
  const cancelled = new Set<string>()
  let requestAt = -1
  let deletedThisTurn = false
  const turn = latestUserTurn(jsonl)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (turn && requestAt < 0 && line.includes(turn.marker) && line.includes('"type":"user"')) requestAt = i
    if (!line.includes('Scheduled recurring job') && !line.includes('Cancelled job')) continue
    for (const m of line.matchAll(/Scheduled recurring job ([0-9a-f]+)/g)) created.add(m[1])
    for (const m of line.matchAll(/Cancelled job ([0-9a-f]+)/g)) {
      cancelled.add(m[1])
      if (requestAt >= 0 && i > requestAt) deletedThisTurn = true
    }
  }
  let monitorLive = false
  const endMs = Date.parse(lastAt)
  for (let i = lines.length - 1; i >= 0 && Number.isFinite(endMs); i--) {
    const line = lines[i]
    if (!line.includes('Monitor event')) continue
    const at = Date.parse(line.match(/"timestamp":"([^"]+)"/)?.[1] ?? '')
    if (Number.isFinite(at) && endMs - at > MONITOR_LIVE_MS) break
    if (line.includes('<task-notification>') && line.includes('"type":"user"')) {
      monitorLive = true
      break
    }
  }
  // An armed /afk hold is a mandate in force: its goal stands in when no typed message sets one.
  if (standing === null && holdGoal) standing = holdGoal
  const alive = [...created].some((id) => !cancelled.has(id))
  const hours =
    latestAt && lastAt ? Math.max(0, (Date.parse(lastAt) - Date.parse(latestAt)) / 3_600_000) : null
  return {
    standing,
    latestTyped: latest !== null && latest !== standing ? latest : null,
    hoursSinceTyped: Number.isFinite(hours) ? hours : null,
    heartbeatAlive: alive,
    monitorLive,
    deletedThisTurn,
  }
}

/**
 * Does a stop leave the session with no way to be woken under a standing mandate? The user typed an
 * overnight or autonomous instruction, no heartbeat cron is alive, and no owned run is live, so ending
 * the turn idles the session until the user returns. Deterministic: no judge is consulted.
 */
export function noWakeUnderMandate(ctx: JudgeContext | undefined, liveRuns: readonly string[]): boolean {
  return !!ctx?.standing && !ctx.heartbeatAlive && !ctx.monitorLive && liveRuns.length === 0
}

/**
 * Is a `work-hold` armed for this session?
 *
 * The state file OR a ledger whose last word is `armed` — the second is the hold that was deleted
 * without a sanctioned release, which `work-hold.ts` restores and blocks on. Both are it speaking;
 * neither is this hook's business to speak over.
 */
export function workHoldArmed(session: string): boolean {
  try {
    if (existsSync(statePath(session))) return true
    return lastLedgerEntry(ledgerPath(session))?.verb.startsWith('armed') === true
  } catch {
    return false
  }
}

/**
 * This session's armed `/afk` hold before its ceiling, or null. `silent` is a hold `work-hold.ts`
 * never blocks for (no check, no run), so this hook speaks in its place.
 *
 * An afk hold QUEUED behind another (arm.sh over a borrowed hold) is the mandate too, but never
 * `silent`: the hold on top is the one `work-hold.ts` evaluates and it speaks for the session, so
 * this hook still stands down. Once that hold releases the afk hold is promoted and reads as above.
 */
export function afkHold(session: string, nowSeconds = Math.floor(Date.now() / 1000)): { goal: string; silent: boolean } | null {
  type H = { origin?: string; goal?: string; check?: string; run?: string; startedAt: number; ceilingMinutes: number }
  // 'overnight' is the pre-rename origin; a hold armed under it is still a mandate for one release.
  const live = (h: H) =>
    (h.origin === 'afk' || h.origin === 'overnight') &&
    !ceilingReached({ ...h, rounds: 0, maxRounds: Infinity }, nowSeconds)
  try {
    const h = JSON.parse(readFileSync(statePath(session), 'utf8')) as H & { queued?: H[] }
    if (live(h)) return { goal: h.goal || 'afk hold', silent: !h.check?.trim() && !h.run }
    const q = (h.queued ?? []).find(x => x && typeof x === 'object' && live(x))
    return q ? { goal: q.goal || 'afk hold', silent: false } : null
  } catch {
    return null
  }
}

/** The goal of this session's armed `/afk` hold, or null: the hold itself is the mandate. */
export function afkHoldGoal(session: string): string | null {
  return afkHold(session)?.goal ?? null
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM: the pid exists under another uid.
    return (e as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

function nonEmpty(p: string): boolean {
  try {
    return statSync(p).size > 0
  } catch {
    return false
  }
}

/**
 * The runs THIS session launched that are still running and that the watcher will wake it for.
 *
 * Read exactly where and how the watcher reads them: `<root>/farm-events/<session>/<pid>.ndjson` under
 * `$TMPDIR` and `/tmp`, parsed and classified by `watch/runs.ts`. The directory's session key is the
 * ownership marker, so another session's runs are never in it. A run past the watcher's wake horizon
 * would finish silently, so it does not count.
 */
export function liveOwnedRuns(session: string, nowMs: number = Date.now()): string[] {
  const runs: Run[] = []
  const firstSeen = new Map<string, number>()
  for (const root of new Set([tmp(), '/tmp'])) {
    const dir = `${root.replace(/\/+$/, '')}/farm-events/${session}`
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const n of names) {
      const m = /^(\d+)\.ndjson$/.exec(n)
      if (!m) continue
      const file = `${dir}/${n}`
      try {
        firstSeen.set(file, Math.min(nowMs, statSync(file).mtimeMs))
        runs.push(...parseEvents(readFileSync(file, 'utf8'), file, Number(m[1]), session))
      } catch {
        /* an unreadable event file is a run this hook cannot vouch for */
      }
    }
  }
  if (!runs.length) return []
  const facts: Facts = {
    alive: new Set(runs.filter((r) => !r.done && pidAlive(r.pid)).map((r) => r.pid)),
    present: new Set(runs.flatMap((r) => [r.out, ...r.claims]).filter((p) => p.startsWith('/') && nonEmpty(p))),
    firstSeen, loopExit: new Map(), loopExitAt: new Map(), round: new Map(), phase: new Map(),
  }
  // A work loop is done once loop.exit holds its code, whatever its pid says.
  for (const r of runs) {
    if (r.label !== 'work-loop' || !r.out) continue
    try {
      const f = `${dirname(r.out)}/loop.exit`
      const code = readFileSync(f, 'utf8').trim()
      if (code) {
        facts.loopExit.set(r.out, code)
        facts.loopExitAt!.set(r.out, statSync(f).mtimeMs)
      }
    } catch {}
  }
  return wakeable(classify(runs, facts))
    .filter((v) => v.state === 'running' && !(v.startedMs && nowMs - v.startedMs > WAKE_HORIZON_MS))
    .map((v) => v.label)
}

/**
 * Is the watcher mod running in this session? Only its own beacon says so: every tick it completes
 * rewrites `<TMPDIR>/farm-events/<session>/watcher.alive`. An interactive 2.1.287+ session is not
 * proof — Claude Code skips plugin mods entirely when its `tengu_plugin_hooks_modules` rollout switch
 * is served off (the secreg session e3b75752, 2026-10-02, loaded none and was never woken), and a
 * headless session or a farm child registers no watcher. No fresh beacon: the hook judges as before.
 */
export function watcherActive(session: string, nowMs: number = Date.now()): boolean {
  for (const root of new Set([tmp(), '/tmp'])) {
    try {
      if (beaconFresh(readFileSync(`${root.replace(/\/+$/, '')}/farm-events/${session}/${BEACON}`, 'utf8'), nowMs)) return true
    } catch {}
  }
  return false
}

/** The tail of a string, marked when it was cut — the tell is at the END of a turn-ending message. */
function tail(s: string, n: number): string {
  const t = s.trim()
  return t.length > n ? `…${t.slice(-n)}` : t
}

/** What the judge reads: the standing mandate, what was just asked, and the message that ends the turn. */
export function judgeState(request: string, message: string, ctx?: JudgeContext): string {
  const parts: string[] = []
  if (ctx?.standing) parts.push("THE USER'S STANDING MANDATE (typed by the user, still in force):", tail(ctx.standing, MANDATE_CHARS), '')
  if (ctx?.latestTyped) parts.push("THE USER'S LATEST TYPED MESSAGE:", tail(ctx.latestTyped, TYPED_CHARS), '')
  parts.push(ctx ? 'THE NEWEST REQUEST (may be an automated wake-up, not the user):' : "THE USER'S LATEST REQUEST:", tail(request, REQUEST_CHARS), '')
  if (ctx?.standing) {
    parts.push(
      'FACTS READ FROM THE TRANSCRIPT:',
      `- A recurring heartbeat cron is ${ctx.heartbeatAlive ? 'ALIVE: it will wake this session' : 'NOT alive: nothing will wake this session'}.`,
      `- This turn ${ctx.deletedThisTurn ? 'DELETED a cron job' : 'did not delete a cron job'}.`,
    )
    if (ctx.hoursSinceTyped !== null)
      parts.push(`- The user's last typed message was ${ctx.hoursSinceTyped.toFixed(1)} hours before this stop.`)
    parts.push('')
  }
  parts.push("THE ASSISTANT'S FINAL MESSAGE, which ENDS the turn:", tail(message, MESSAGE_CHARS))
  return parts.join('\n')
}

/** The question. Both halves matter: a legitimate ending must not read as one of the four. */
export const INSTRUCTIONS =
  'The assistant message below ends the turn. This is true: the assistant ends its turn while work ' +
  'the user asked for is still owed, in one of these four ways — (1) a summary that announces the ' +
  'next step instead of taking it; (2) an offer to carry on unless the user would prefer otherwise; ' +
  '(3) a list of decisions, none of which blocks the rest of the work; (4) stopping because a ' +
  'milestone felt like a good place to report. It is FALSE when the assistant asks a genuinely ' +
  'blocking question, reports work that is actually finished, is waiting on a background job that is ' +
  'still running, or when the message is a plan approval or an AskUserQuestion hand-off. The newest ' +
  'request may be an automated wake-up (a cron tick, a plugin or task notification), not the user. ' +
  'When a STANDING MANDATE is shown, the user typed an autonomous or overnight instruction ("do ' +
  'whatever you think is best", "don\'t ask me questions") and that mandate, not the wake-up, is the ' +
  'work the user asked for. Then ending the turn is early when the final message leaves queued or ' +
  'next items unfinished, even though the newest request is only a tick or a wake-up, and even when ' +
  'the message says it is idle, says nothing is running, or parks work as waiting on the user ' +
  'without a question only the user can answer. The FACTS say whether the heartbeat cron that would ' +
  're-enter the session is alive or was just deleted.'

/** The CLAUDE.md rule in two sentences, then what to do instead of stopping. */
export const BLOCK_REASON =
  'Do not end a turn while work the user asked for is still owed. A message with no tool call stops ' +
  'the work until they come back. Take the next step now; if nothing can move without the user, say ' +
  'what blocks and use AskUserQuestion.'

/** The block reason for `noWakeUnderMandate`. */
export const NO_WAKE_REASON =
  'Under a standing overnight/autonomous instruction this session has no wake left (no heartbeat, no ' +
  'running job), so ending now idles until the user returns. Take the next queued item, or CronCreate a ' +
  'heartbeat that names the standing objective; if nothing at all is left, say so and ask with AskUserQuestion.'

/** Under an armed afk hold the user is asleep until the ceiling, so no reason sends them a question. */
const AFK_NO_QUESTIONS =
  'if nothing can move without the user, write the open questions into the morning report and take the ' +
  'next item you can move; do not use AskUserQuestion until the ceiling.'

/** `BLOCK_REASON` under an armed afk hold. */
export const AFK_BLOCK_REASON =
  'Do not end a turn while work the user asked for is still owed. A message with no tool call stops ' +
  'the work until they come back. Take the next step now; ' + AFK_NO_QUESTIONS

/** `NO_WAKE_REASON` under an armed afk hold. */
export const AFK_NO_WAKE_REASON =
  'Under the afk mandate this session has no wake left (no heartbeat, no running job), so ending now ' +
  'idles until the user returns. Take the next queued item, or CronCreate a heartbeat that names the ' +
  'standing objective; ' + AFK_NO_QUESTIONS

interface Counter {
  turn: string
  blocks: number
}

/**
 * What the counter file says — with ABSENT and UNREADABLE told apart, because only one of them is
 * evidence of anything.
 *
 * A missing file is the ordinary first stop of a turn: nothing has been spent, and blocking is safe
 * because the write that follows will record it. A file that EXISTS and cannot be read or parsed is
 * the opposite — the cap is already broken, and treating it as zero would block, fail to record it,
 * and arrive at the next stop reading zero again. That is the unbounded loop
 * `teammate-idle-report-check.sh` measured at 2,2,2,2,2,2 and fixed by failing open instead.
 */
export type CounterRead =
  | { kind: 'absent' }
  | { kind: 'spent'; blocks: number }
  | { kind: 'unreadable'; reason: string }

export function readCounter(path: string, turn: string): CounterRead {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (e) {
    // ONLY ENOENT is "nothing spent yet". EACCES, EISDIR, EIO and the rest all mean a counter is
    // there and this hook cannot see it, so it cannot cap itself.
    const code = (e as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') return { kind: 'absent' }
    return { kind: 'unreadable', reason: code || 'read failed' }
  }
  let c: Counter
  try {
    c = JSON.parse(raw) as Counter
  } catch {
    return { kind: 'unreadable', reason: 'not parsable json' }
  }
  if (typeof c?.blocks !== 'number' || typeof c?.turn !== 'string')
    return { kind: 'unreadable', reason: 'no {turn, blocks} in the counter' }
  // A counter for an EARLIER turn parsed fine; it simply says nothing about this one.
  return { kind: 'spent', blocks: c.turn === turn ? c.blocks : 0 }
}

/** The probability Jev gave, off `parseNoul`'s own sentence — the first percentage is the answer. */
function pctOf(reason: string): string {
  return reason.match(/(\d+)%/)?.[1] ?? '-'
}

function audit(session: string, turn: string, p: string, verdict: string, note: string): void {
  try {
    appendFileSync(
      auditPath(),
      `${new Date().toISOString()}\t${session || '-'}\t${turn}\t${p}\t${verdict}\t${note}\n`,
    )
  } catch {
    /* an audit line is a record, never a reason to block or to crash */
  }
}

function main(): void {
  // A child is a no-op. Checked before the payload is even parsed, so there is no path through a
  // parse failure into a judge call for a session nobody is watching.
  if (process.env.FARM_OUT_CHILD === '1')
    return allowNow('-', '-', 'FARM_OUT_CHILD=1: unattended child, instruction not hook')
  if ((process.env.GRIND_ITERATION || '') !== '')
    return allowNow('-', '-', `GRIND_ITERATION=${process.env.GRIND_ITERATION}: grind iteration`)
  if (process.env.EARLY_STOP_HOOK === '0') return allowNow('-', '-', 'EARLY_STOP_HOOK=0: opted out')

  let payload: Record<string, unknown> = {}
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return allowNow('-', '-', 'unparsable hook payload')
  }

  const session =
    (typeof payload.session_id === 'string' && payload.session_id) ||
    process.env.CLAUDE_CODE_SESSION_ID ||
    ''
  // No session id, no per-session counter — and an uncapped block is the loop this must not become.
  if (!session) return allowNow('-', '-', 'no session id: the per-turn cap cannot be keyed')

  const afk = afkHold(session)
  if (workHoldArmed(session) && !afk?.silent)
    return allowNow(session, '-', 'a work-hold is armed: it speaks for this session')

  const live = liveOwnedRuns(session)
  if (live.length && watcherActive(session))
    return allowNow(session, '-', `owned runs live, the watcher wakes the session: ${live.join(', ')}`)

  const message = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : ''
  if (!message.trim()) return allowNow(session, '-', 'empty last_assistant_message')

  const transcriptPath = typeof payload.transcript_path === 'string' ? payload.transcript_path : ''
  let turn: Turn | null = null
  let ctx: JudgeContext | undefined
  try {
    const jsonl = transcriptPath ? readFileSync(transcriptPath, 'utf8') : ''
    turn = jsonl ? latestUserTurn(jsonl) : null
    if (turn) {
      try {
        ctx = judgeContext(jsonl, afk?.goal ?? null)
      } catch {
        /* the old two-part state still judges */
      }
    }
  } catch {
    turn = null
  }
  // Without a boundary there is neither a request to judge against nor a key to cap on.
  if (!turn) return allowNow(session, '-', 'no genuine user request in the transcript')

  const counter = counterPath(session)
  const read = readCounter(counter, turn.marker)
  if (read.kind === 'unreadable')
    return allowNow(session, turn.marker, `counter unreadable (${read.reason}): cannot cap, so not blocking`)
  const spent = read.kind === 'spent' ? read.blocks : 0
  if (spent >= MAX_BLOCKS_PER_TURN)
    return allowNow(session, turn.marker, `cap: ${spent} blocks already this turn`)

  if (noWakeUnderMandate(ctx, live)) {
    try {
      writeFileSync(counter, JSON.stringify({ turn: turn.marker, blocks: spent + 1 } satisfies Counter))
    } catch {
      return allowNow(session, turn.marker, 'counter unwritable: cannot cap, so not blocking')
    }
    audit(session, turn.marker, '-', 'block', `no wake under mandate: ${spent + 1}/${MAX_BLOCKS_PER_TURN} this turn`)
    process.stdout.write(JSON.stringify({ decision: 'block', reason: afk ? AFK_NO_WAKE_REASON : NO_WAKE_REASON }))
    process.exit(0)
  }

  const threshold = Number(process.env.EARLY_STOP_THRESHOLD || DEFAULT_THRESHOLD)
  const r = decisionsCall(judgeState(turn.request, message, ctx), {
    [QUESTION_KEY]: { type: 'noul', instructions: INSTRUCTIONS },
  }, { caller: 'early-stop', session })
  if (r.stdout === null) return allowNow(session, turn.marker, `judge unavailable: ${r.unavailable}`)

  const v = parseNoul(r.stdout, QUESTION_KEY, threshold)
  const p = pctOf(v.reason)
  if (v.verdict !== 'MET')
    return allowNow(
      session,
      turn.marker,
      v.verdict === 'UNAVAILABLE' ? `judge unavailable: ${v.reason}` : `below threshold: ${v.reason}`,
    )

  // The counter is written BEFORE the block. An unwritable counter cannot cap, and an uncapped
  // block is an infinite loop — the lesson `teammate-idle-report-check.sh` paid for.
  try {
    writeFileSync(counter, JSON.stringify({ turn: turn.marker, blocks: spent + 1 } satisfies Counter))
  } catch {
    return allowNow(session, turn.marker, 'counter unwritable: cannot cap, so not blocking')
  }

  audit(session, turn.marker, p, 'block', `${spent + 1}/${MAX_BLOCKS_PER_TURN} this turn`)
  process.stdout.write(JSON.stringify({ decision: 'block', reason: afk ? AFK_BLOCK_REASON : BLOCK_REASON }))
  process.exit(0)
}

/** Every allow goes through here, so every decision leaves a line. */
function allowNow(session: string, turn: string, note: string): never {
  audit(session, turn, '-', 'allow', note)
  process.exit(0)
}

if (import.meta.main) {
  try {
    main()
  } catch (e) {
    // An unexpected throw must not be the one path that ends differently. Nothing on stdout is an
    // allow; the note says what happened for anyone reading the log.
    try {
      audit('-', '-', '-', 'allow', `hook error: ${e instanceof Error ? e.message : String(e)}`)
    } catch {
      /* ignore */
    }
    process.exit(0)
  }
}
