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
 * STALE TICKS (`idleTicks`) is the second deterministic leg, after `noWakeUnderMandate`: STALE_TICKS
 * heartbeat ticks in a row in which the session changed nothing block the stop, before the judge, which
 * reads each tick alone and let nevada e83fb488 answer eight hourly ticks with "no change" (2026-10-12).
 * Its budget is STALE_BLOCKS_PER_TICK per tick, not the per-turn cap: ticks are meta and never rotate the
 * turn, so a per-turn budget would run dry in the first idle hour. Rules 1, 3 and 4 hold unchanged, and
 * any live owned run, watched or not, means the tick is waiting on it and is not idle. So does a job the
 * session launched by hand (`progressingJobs`), but only while it is alive AND has written since the
 * previous tick: a silent live job is a hang, which is what the nudge is for.
 *
 * The judge is the one `work-hold.ts` already uses — Jev, through the Decisions API — reached
 * through that file's exported `decisionsCall`/`parseNoul`. There is exactly one Decisions transport
 * in this plugin and this hook does not add a second.
 *
 * Opt out for a session with `EARLY_STOP_HOOK=0`. Tune the bar with `EARLY_STOP_THRESHOLD` (default 0.8); an
 * answer from the luna fallback is held to at least 0.95 (`decisionThreshold`, applied in `parseNoul`).
 */

import { appendFileSync, existsSync, readdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
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

/**
 * When a typed mandate lapses: the ceiling `skills/afk/scripts/arm.sh` gives an afk hold armed at the
 * same local minute — 18:00 when typed in [09:00, 18:00), else the next 09:00, never under 60 minutes
 * after 05:00. arm.sh is bash, so the rule is mirrored here and pinned to it by tests/early-stop.test.ts.
 */
export function mandateCeilingMs(typedAtMs: number, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(typedAtMs))
  const part = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const cur = part('hour') * 60 + part('minute')
  let ceiling = cur >= 540 && cur < 1080 ? 1080 - cur : (540 - cur + 1440) % 1440 || 1440
  if (cur >= 300 && ceiling < 60) ceiling = 60
  return typedAtMs + ceiling * 60_000
}

export interface JudgeContext {
  /**
   * The newest typed message that carries a standing instruction, if it is still live: no typed message
   * after it (the user came back) and the end of the transcript before `mandateCeilingMs`.
   */
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
export function judgeContext(jsonl: string, holdGoal?: string | null, timeZone?: string): JudgeContext {
  const lines = jsonl.split('\n')
  let standing: string | null = null
  let standingAt = ''
  let latest: string | null = null
  let latestAt = ''
  let latestIdx = -1
  let standingIdx = -1
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
      latestIdx = i
    }
    if (STANDING.test(text) && !isQuestion(text)) {
      standing = text
      standingAt = typeof e.timestamp === 'string' ? e.timestamp : ''
      standingIdx = i
      break
    }
  }
  // A typed mandate is live only until the user types again or its ceiling passes. An unreadable
  // timestamp cannot be placed before the ceiling, so it fails open like everything else here.
  if (standing !== null) {
    const typedMs = Date.parse(standingAt)
    const endMs = Date.parse(lastAt)
    if (
      latestIdx !== standingIdx ||
      !Number.isFinite(typedMs) || !Number.isFinite(endMs) ||
      endMs >= mandateCeilingMs(typedMs, timeZone)
    ) standing = null
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
 * Trailing idle heartbeat ticks that block a stop. Two hourly ticks is an hour of nothing; one is a
 * wait that may be right, since the judge reads each tick alone and put the incident's at 42-68%.
 */
export const STALE_TICKS = 2

/** Stale-leg blocks per tick: one delivers the instruction, and the next idle tick blocks again. */
export const STALE_BLOCKS_PER_TICK = 1

/** Tools whose successful call changes state outside the conversation. */
const ACTING_TOOLS = new Set([
  'Edit', 'Write', 'NotebookEdit', 'CronCreate', 'CronDelete', 'Agent', 'Task', 'SendMessage', 'TaskStop', 'Workflow', 'AskUserQuestion',
])

/** A Bash command that commits, merges, dispatches, launches, sends or kills. Read-only look-alikes stay out. */
const ACTING_BASH = new RegExp([
  String.raw`\bgit\b[^|;&\n]*\s(commit|merge|cherry-pick|rebase|revert|push|am)(?![\w-])`,
  String.raw`\bwork-(re)?dispatch\b`,
  String.raw`\bfarm\.sh\b[^\n]*--(tasks|workflow)\b`,
  String.raw`(^|[\s;&|(])(setsid|nohup)\s`,
  String.raw`\bagent-msg\s+send\b`,
  String.raw`(^|[\s;&|(])(kill|pkill|killall)\s`,
].join('|'))

/** A cron or wakeup tick: the harness tags it scheduled; older transcripts carry only the prompt shape. */
function isScheduled(e: Record<string, unknown>, text: string): boolean {
  return e.turnOrigin === 'scheduled' || typeof e.scheduledTaskId === 'string' || /^and\? \(/.test(text)
}

/**
 * A heartbeat asks the session to move an objective: the plugin's `and? (…)` (afk, work-dispatch,
 * farm.sh, hold templates) or a prompt that calls itself one. A self-contained scheduled job ("AFK
 * re-audit (12h, read-only)") can be fully answered by "nothing new", so it is not counted.
 */
const HEARTBEAT = /^\s*and\? \(|\bheartbeat\b/i

/** Injections the harness marks meta that still carry news from outside: they end a run like a typed prompt. */
const NEWS_ORIGINS = new Set(['human', 'peer', 'plugin', 'task-notification'])

/**
 * The trailing run of heartbeat ticks in which the assistant changed nothing, counting the tick this
 * stop ends, and that tick's uuid. A tick turn runs to the next scheduled prompt or reset; any other
 * non-meta string prompt, or a meta one from a NEWS_ORIGINS sender (typed, peer, plugin or task wake),
 * ends the run, while other meta injections (hook feedback, skill text) are neither. A turn is idle unless a call in it matched ACTING_TOOLS or
 * ACTING_BASH and its result was not an error: a failed commit or an unanswered question moved
 * nothing. A stop outside a tick turn has a run of 0.
 */
export function idleTicks(jsonl: string): { run: number; tick: string | null; since?: string | null } {
  type T = { uuid: string; at: string; acted: boolean }
  const turns: T[] = []
  let cur: T | null = null
  const pending = new Map<string, T>()
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let e: Record<string, unknown>
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.isSidechain) continue
    const content = (e.message as { content?: unknown } | undefined)?.content
    if (e.type === 'user' && typeof content === 'string' && (e.toolUseResult === undefined || e.toolUseResult === null)) {
      const kind = (e.origin as { kind?: unknown } | undefined)?.kind
      if (isScheduled(e, content)) {
        cur = { uuid: typeof e.uuid === 'string' ? e.uuid : '', at: typeof e.timestamp === 'string' ? e.timestamp : '', acted: false }
        // Another scheduled job neither counts nor resets: its turn is held apart from the run.
        if (HEARTBEAT.test(content)) turns.push(cur)
      } else if (!e.isMeta || (typeof kind === 'string' && NEWS_ORIGINS.has(kind))) {
        turns.length = 0
        cur = null
      }
      continue
    }
    if (!cur || !Array.isArray(content)) continue
    for (const b of content as Array<Record<string, unknown>>) {
      if (e.type === 'assistant' && b?.type === 'tool_use') {
        const name = String(b.name ?? '')
        const cmd = String((b.input as { command?: unknown } | undefined)?.command ?? '')
        if (ACTING_TOOLS.has(name) || (name === 'Bash' && ACTING_BASH.test(cmd))) pending.set(String(b.id ?? ''), cur)
      } else if (e.type === 'user' && b?.type === 'tool_result') {
        const id = String(b.tool_use_id ?? '')
        const t = pending.get(id)
        if (t && b.is_error !== true) t.acted = true
        pending.delete(id)
      }
    }
  }
  // A call with no result yet counts as acting: the uncertain case never blocks.
  for (const t of pending.values()) t.acted = true
  if (!cur || turns.at(-1) !== cur) return { run: 0, tick: null }
  let run = 0
  for (let i = turns.length - 1; i >= 0 && !turns[i].acted; i--) run++
  return { run, tick: run ? cur.uuid : null, since: run >= 2 ? turns.at(-2)!.at || null : null }
}

/**
 * A job the session started itself outside farm.sh: a `setsid`/`nohup` launch (argv and redirect
 * targets parsed from the command) or a `run_in_background` call (its harness output file) whose task
 * has not reported done. `outs` are the files the transcript names as the job's output.
 */
export type Launch =
  | { kind: 'setsid'; argv: string[]; outs: string[] }
  | { kind: 'bg'; cmd: string; outs: string[] }

type Word = { w: string; bad?: boolean; op?: string }

/**
 * Shell words, enough to read a launch line: quotes, `$NAME`/`${NAME}` from `vars`, `~`, operators and
 * redirections. Any other expansion (`$(…)`, backticks, `$!`) marks the word unresolvable. A generator,
 * so a `NAME=value` segment the consumer applies is seen by the words after it.
 */
function* shellWords(cmd: string, vars: Map<string, string>): Generator<Word> {
  let w = ''
  let bad = false
  let has = false
  const word = (): Word | null => {
    const t = has ? (bad ? { w, bad } : { w }) : null
    w = ''
    bad = false
    has = false
    return t
  }
  const dollar = (i: number): number => {
    const m = /^\$(?:\{(\w+)\}|([A-Za-z_]\w*))/.exec(cmd.slice(i))
    if (m) {
      const name = m[1] ?? m[2]
      const v = vars.get(name) ?? (name === 'HOME' ? homedir() : undefined)
      if (v === undefined) bad = true
      else w += v
      return i + m[0].length
    }
    bad = true
    if (cmd[i + 1] === '(') {
      let depth = 0
      for (let j = i + 1; j < cmd.length; j++) {
        if (cmd[j] === '(') depth++
        else if (cmd[j] === ')' && --depth === 0) return j + 1
      }
      return cmd.length
    }
    return i + 2
  }
  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]
    if (c === ' ' || c === '\t') {
      const t = word()
      if (t) yield t
      i++
      continue
    }
    if (c === '#' && !has) {
      while (i < cmd.length && cmd[i] !== '\n') i++
      continue
    }
    const op = /^(?:\d*(?:>>|>\||>&|>|<<<|<<|<&|<)|&>>?|&&|\|\||[;&|()\n])/.exec(cmd.slice(i))
    if (op && !(has && /^\d/.test(op[0]))) {
      const t = word()
      if (t) yield t
      yield { w: '', op: op[0] === '\n' ? ';' : op[0] }
      i += op[0].length
      continue
    }
    has = true
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1)
      w += cmd.slice(i + 1, j < 0 ? cmd.length : j)
      i = j < 0 ? cmd.length : j + 1
    } else if (c === '"') {
      i++
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '\\' && '"\\$`'.includes(cmd[i + 1] ?? '')) {
          w += cmd[i + 1]
          i += 2
        } else if (cmd[i] === '$') i = dollar(i)
        else if (cmd[i] === '`') {
          bad = true
          i++
        } else w += cmd[i++]
      }
      i++
    } else if (c === '\\') {
      w += cmd[i + 1] ?? ''
      i += 2
    } else if (c === '$') {
      i = dollar(i)
    } else if (c === '`') {
      bad = true
      const j = cmd.indexOf('`', i + 1)
      i = j < 0 ? cmd.length : j + 1
    } else if (c === '~' && w === '' && (i + 1 === cmd.length || cmd[i + 1] === '/' || cmd[i + 1] === ' ')) {
      w += homedir()
      i++
    } else {
      w += c
      i++
    }
  }
  const t = word()
  if (t) yield t
}

const ASSIGN = /^([A-Za-z_]\w*)=(.*)$/s

/** The setsid/nohup launches in one Bash command, with `NAME=value` and `cd` segments applied in order. */
function setsidLaunches(cmd: string, cwd: string): Launch[] {
  const vars = new Map<string, string>([['PWD', cwd]])
  const found: Launch[] = []
  let seg: Word[] = []
  const segment = () => {
    const plain: Word[] = []
    const outs: string[] = []
    for (let k = 0; k < seg.length; k++) {
      const t = seg[k]
      if (!t.op) {
        plain.push(t)
        continue
      }
      const target = seg[++k]
      // Only a write to a named file: not an input, not a dup like `2>&1`, not /dev/null.
      if (!target || target.bad || target.op || !t.op.includes('>') || t.op.endsWith('&') || target.w === '/dev/null') continue
      outs.push(resolve(cwd, target.w))
    }
    seg = []
    if (!plain.length) return
    if (plain.every((t) => ASSIGN.test(t.w))) {
      for (const t of plain) {
        const m = ASSIGN.exec(t.w)!
        if (t.bad) vars.delete(m[1])
        else vars.set(m[1], m[2])
      }
      return
    }
    if (plain[0].w === 'cd' && plain[1] && !plain[1].bad) {
      cwd = resolve(cwd, plain[1].w)
      vars.set('PWD', cwd)
      return
    }
    let k = 0
    while (k < plain.length && ASSIGN.test(plain[k].w)) k++
    let launched = false
    for (;;) {
      const w = plain[k]?.w
      if (w === 'setsid') {
        launched = true
        k++
        while (plain[k]?.w.startsWith('-')) k++
      } else if (w === 'nohup') {
        launched = true
        k++
      } else if (w === 'exec') k++
      else break
    }
    const argv = plain.slice(k)
    if (launched && argv.length && argv.every((t) => !t.bad)) found.push({ kind: 'setsid', argv: argv.map((t) => t.w), outs })
  }
  for (const t of shellWords(cmd, vars)) {
    if (t.op && !/[<>]/.test(t.op)) segment()
    else seg.push(t)
  }
  segment()
  return found
}

/** The harness's output file for a backgrounded Bash call, from its tool_result. */
const BG_OUTPUT = /Output is being written to: (\S+?)\.?(?:\s|$)/
const TASK_DONE = /<tool-use-id>([^<]+)<\/tool-use-id>[\s\S]*?<status>(completed|failed|killed|stopped)<\/status>/

/**
 * Every job the transcript shows this session launching by hand. Read from the transcript because it is
 * the only record of what was launched, where its output goes, and (for a background call) whether the
 * harness has already reported it done; `/proc` then says whether it is alive and writing.
 */
export function handLaunches(jsonl: string, fallbackCwd = process.cwd()): Launch[] {
  const calls = new Map<string, { cmd: string; bg: boolean; cwd: string }>()
  const order: string[] = []
  const bgOut = new Map<string, string>()
  const done = new Set<string>()
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    if (line.includes('<tool-use-id>')) for (const m of line.replace(/\\n/g, '\n').matchAll(new RegExp(TASK_DONE, 'g'))) done.add(m[1])
    if (!line.includes('"Bash"') && !line.includes('Output is being written to')) continue
    let e: Record<string, unknown>
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.isSidechain) continue
    const content = (e.message as { content?: unknown } | undefined)?.content
    if (!Array.isArray(content)) continue
    for (const b of content as Array<Record<string, unknown>>) {
      if (e.type === 'assistant' && b?.type === 'tool_use' && b.name === 'Bash') {
        const input = (b.input ?? {}) as { command?: unknown; run_in_background?: unknown }
        const cmd = typeof input.command === 'string' ? input.command : ''
        const bg = input.run_in_background === true
        if (!bg && !/(^|[\s;&|(])(setsid|nohup)\s/.test(cmd)) continue
        const id = String(b.id ?? '')
        calls.set(id, { cmd, bg, cwd: typeof e.cwd === 'string' ? e.cwd : fallbackCwd })
        order.push(id)
      } else if (e.type === 'user' && b?.type === 'tool_result') {
        const text = typeof b.content === 'string' ? b.content
          : Array.isArray(b.content) ? (b.content as Array<{ text?: unknown }>).map((x) => String(x?.text ?? '')).join('\n') : ''
        const m = BG_OUTPUT.exec(text)
        if (m) bgOut.set(String(b.tool_use_id ?? ''), m[1])
      }
    }
  }
  const found: Launch[] = []
  for (const id of order) {
    const c = calls.get(id)!
    found.push(...setsidLaunches(c.cmd, c.cwd))
    if (c.bg && !done.has(id)) found.push({ kind: 'bg', cmd: c.cmd, outs: bgOut.has(id) ? [bgOut.get(id)!] : [] })
  }
  return found
}

/** What `progressingJobs` reads from the system: injectable so a replay can stand in for a past `/proc`. */
export interface JobProbe {
  procs(): Array<{ pid: number; ppid: number; argv: string[] }>
  /** The process's `CLAUDE_CODE_SESSION_ID`, which the harness exports into every Bash tool process. */
  owner(pid: number): string | null
  /** Regular files the process holds open for writing. */
  writing(pid: number): string[]
  /** Null for a missing or EMPTY file: the harness creates a background task's output file at launch, so a
   *  fresh mtime on 0 bytes is a creation, not progress. */
  mtimeMs(path: string): number | null
}

const SNAPSHOT_EVAL = "&& eval '"

/** The command a harness snapshot shell evals, as the model wrote it (`bgjobs.py shown`); else null. */
function evalBody(argv: string[]): string | null {
  const s = argv.join(' ')
  if (!s.includes('shell-snapshots/snapshot-')) return null
  const at = s.indexOf(SNAPSHOT_EVAL)
  const end = s.lastIndexOf("' < /dev/null")
  if (at < 0 || end <= at) return null
  return s.slice(at + SNAPSHOT_EVAL.length, end).replaceAll(`'"'"'`, "'")
}

export const PROC_PROBE: JobProbe = {
  procs() {
    const out: Array<{ pid: number; ppid: number; argv: string[] }> = []
    for (const d of readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue
      try {
        const rest = readFileSync(`/proc/${d}/stat`, 'utf8').split(') ').at(-1)!.split(' ')
        if (rest[0] === 'Z') continue
        const argv = readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0')
        if (argv.at(-1) === '') argv.pop()
        out.push({ pid: Number(d), ppid: Number(rest[1]), argv })
      } catch {}
    }
    return out
  },
  owner(pid) {
    try {
      const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')
      return env.find((x) => x.startsWith('CLAUDE_CODE_SESSION_ID='))?.slice(23) ?? null
    } catch {
      return null
    }
  },
  writing(pid) {
    const out: string[] = []
    let fds: string[] = []
    try {
      fds = readdirSync(`/proc/${pid}/fd`)
    } catch {
      return out
    }
    for (const fd of fds) {
      try {
        const target = readlinkSync(`/proc/${pid}/fd/${fd}`)
        if (!target.startsWith('/') || /^\/(dev|proc|sys)\//.test(target) || target.endsWith(' (deleted)')) continue
        const flags = /flags:\s*([0-7]+)/.exec(readFileSync(`/proc/${pid}/fdinfo/${fd}`, 'utf8'))?.[1]
        if (flags && (parseInt(flags, 8) & 3) !== 0) out.push(target)
      } catch {}
    }
    return out
  },
  mtimeMs(path) {
    try {
      const st = statSync(path)
      return st.isFile() && st.size > 0 ? st.mtimeMs : null
    } catch {
      return null
    }
  },
}

/**
 * The hand-launched jobs (`handLaunches`) that are this session's, alive, and wrote since `sinceMs`.
 *
 * Alive: a live process whose argv is the launch's (a `setsid`/`nohup` argv, argv[0] compared by
 * basename) or whose snapshot shell evals the launch's command, and whose `CLAUDE_CODE_SESSION_ID` is this
 * session — the same command run by another session is not this one's job. Progress: the newest mtime
 * over the files the transcript names and every regular file the process or a descendant holds open for
 * writing. The second set is what makes the check work: e83fb488's `> driver2.out` stayed 0 bytes for the
 * whole run while the job's own `>> lookup.log` grew.
 */
export function progressingJobs(jsonl: string, session: string, sinceMs: number, probe: JobProbe = PROC_PROBE): string[] {
  const launches = handLaunches(jsonl)
  if (!launches.length || !Number.isFinite(sinceMs)) return []
  const procs = probe.procs().filter((p) => p.pid !== process.pid)
  const kids = new Map<number, number[]>()
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p.pid])
  const sameArgv = (a: string[], b: string[]) =>
    a.length === b.length && a.length > 0 && basename(a[0]) === basename(b[0]) && a.every((x, i) => i === 0 || x === b[i])
  const found: string[] = []
  for (const l of launches) {
    const roots = procs.filter((p) => (l.kind === 'bg' ? evalBody(p.argv) === l.cmd : sameArgv(l.argv, p.argv)) && probe.owner(p.pid) === session)
    if (!roots.length) continue
    const files = new Set(l.outs)
    const stack = roots.map((p) => p.pid)
    const seen = new Set<number>()
    while (stack.length) {
      const pid = stack.pop()!
      if (seen.has(pid)) continue
      seen.add(pid)
      for (const f of probe.writing(pid)) files.add(f)
      stack.push(...(kids.get(pid) ?? []))
    }
    if ([...files].some((f) => (probe.mtimeMs(f) ?? -Infinity) > sinceMs))
      found.push(l.kind === 'bg' ? `bg: ${l.cmd.slice(0, 60)}` : l.argv.join(' ').slice(0, 80))
  }
  return found
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

/**
 * The block reason for `idleTicks`, in the order the model must work: the count, the blocker tested
 * live, the action, and the question only when nothing can move.
 */
export function staleTickReason(ticks: number, afk: boolean): string {
  return (
    `${ticks} heartbeat ticks in a row changed nothing: no edit, commit, dispatch, message or new heartbeat. ` +
    'Name what blocks you and test that it is still live with concrete evidence — file mtimes, its owner\'s ' +
    '`agent-msg list` status, the last commit time — not your previous answer. Then act: when the blocker is ' +
    'the user\'s own session, message it with `agent-msg send --as-user`; otherwise route around it or start ' +
    'the next open item. "No change" is not an answer. ' +
    (afk
      ? 'If truly nothing can move, write the blocker into the morning report and take the next item you can ' +
        'move; do not use AskUserQuestion until the ceiling.'
      : 'If truly nothing can move, ask the user with AskUserQuestion, naming the blocker.')
  )
}

/**
 * One file per session. `blocks` is counted per user turn; `tickBlocks` per heartbeat tick, because
 * ticks are meta and never rotate `turn`, so a per-turn budget would be spent by the first idle hour
 * of an afternoon of ticks. Each leg writes both fields back so neither resets the other.
 */
interface Counter {
  turn: string
  blocks: number
  tick?: string
  tickBlocks?: number
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
  | { kind: 'spent'; blocks: number; tickBlocks: number }
  | { kind: 'unreadable'; reason: string }

export function readCounter(path: string, turn: string, tick: string | null = null): CounterRead {
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
  return {
    kind: 'spent',
    blocks: c.turn === turn ? c.blocks : 0,
    tickBlocks: tick !== null && c.tick === tick && typeof c.tickBlocks === 'number' ? c.tickBlocks : 0,
  }
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
  let idle: ReturnType<typeof idleTicks> = { run: 0, tick: null }
  let jsonl = ''
  try {
    jsonl = transcriptPath ? readFileSync(transcriptPath, 'utf8') : ''
    turn = jsonl ? latestUserTurn(jsonl) : null
    if (turn) {
      try {
        ctx = judgeContext(jsonl, afk?.goal ?? null)
      } catch {
        /* the old two-part state still judges */
      }
      try {
        idle = idleTicks(jsonl)
      } catch {
        /* no count, no stale block */
      }
    }
  } catch {
    turn = null
  }
  // Without a boundary there is neither a request to judge against nor a key to cap on.
  if (!turn) return allowNow(session, '-', 'no genuine user request in the transcript')

  const counter = counterPath(session)
  const read = readCounter(counter, turn.marker, idle.tick)
  if (read.kind === 'unreadable')
    return allowNow(session, turn.marker, `counter unreadable (${read.reason}): cannot cap, so not blocking`)
  const spent = read.kind === 'spent' ? read.blocks : 0
  const tickSpent = read.kind === 'spent' ? read.tickBlocks : 0
  const record = (blocks: number, tickBlocks: number): boolean => {
    try {
      const c: Counter = idle.tick === null ? { turn: turn!.marker, blocks } : { turn: turn!.marker, blocks, tick: idle.tick, tickBlocks }
      writeFileSync(counter, JSON.stringify(c))
      return true
    } catch {
      return false
    }
  }

  // Stale ticks: its own per-tick budget, checked before the per-turn cap, which ticks never rotate.
  // A live owned run is not idle even without a watcher: the tick is waiting on it. Nor is a hand-launched
  // job that wrote since the previous tick; one that cannot be checked fails open, like the rest.
  const handJobs = (): string[] => {
    try {
      return progressingJobs(jsonl, session, Date.parse(idle.since ?? ''))
    } catch {
      return ['(check failed)']
    }
  }
  if (idle.tick !== null && idle.run >= STALE_TICKS && live.length === 0 && tickSpent < STALE_BLOCKS_PER_TICK && handJobs().length === 0) {
    if (!record(spent, tickSpent + 1)) return allowNow(session, turn.marker, 'counter unwritable: cannot cap, so not blocking')
    audit(session, turn.marker, '-', 'block', `stale ticks: ${idle.run} idle in a row, ${tickSpent + 1}/${STALE_BLOCKS_PER_TICK} this tick`)
    process.stdout.write(JSON.stringify({ decision: 'block', reason: staleTickReason(idle.run, !!afk) }))
    process.exit(0)
  }

  if (spent >= MAX_BLOCKS_PER_TURN)
    return allowNow(session, turn.marker, `cap: ${spent} blocks already this turn`)

  if (noWakeUnderMandate(ctx, live)) {
    if (!record(spent + 1, tickSpent)) return allowNow(session, turn.marker, 'counter unwritable: cannot cap, so not blocking')
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
  if (!record(spent + 1, tickSpent)) return allowNow(session, turn.marker, 'counter unwritable: cannot cap, so not blocking')

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
