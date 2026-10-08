#!/usr/bin/env bun
/**
 * Stop hook: hold the session on an objective until a COMMAND says it is met.
 *
 * This is what `/goal` does, done by running the check rather than reading the transcript —
 * and without a transport. The self-send this replaced only QUEUED; its drainer needed the pane
 * IDLE to type into, so a session running back-to-back checks never provided a window and the goal
 * never landed. Measured 2026-09-16: `/goal` landed 127 times and missed 36, `/loop` landed 52 and
 * missed 29, and a `/goal` sat undelivered for hours while the session worked. The transport and
 * its drainer were deleted; this hook and `CronCreate` are what replaced them.
 *
 * The three things that make a Stop hook safe rather than a trap, all copied from
 * ~/.claude/hooks/main-thread-guard.sh, which has been doing this in production:
 *
 *   1. `stop_hook_active` — set when the stop was already blocked once. Ignoring it means
 *      blocking your own block, forever.
 *   2. SELF-CLEARING — the state file is removed the moment the check passes, so the normal
 *      ending needs no human action.
 *   3. BOUNDED — a round counter and a wall clock, both checked here. A hold that cannot expire
 *      is a session someone has to kill.
 *
 * INERT unless armed. The state file is per session, so this fires for exactly one session
 * rather than every session in the project.
 *
 *   arm:     work-hold.sh '<check command>' [--goal '<objective>'] [--run DIR] [--rounds N] [--minutes M]
 *            work-hold.sh --goal '<objective>' [--run DIR] …    a CHECK-LESS hold: the judge alone
 *   release: the check passes AND the judge agrees the goal is met, a ceiling is reached, or the USER
 *            confirms `--disarm` at a terminal. Deleting the state file is not a release: the ledger
 *            beside it records the arm, and this hook restores a hold that vanished without one.
 *
 * The order, every Stop: the watched run is IN FLIGHT (allow, count nothing, clock still runs) ->
 * the check is red (block, count a round) -> the check is green or there is none (ask the judge:
 * MET releases, UNMET blocks) -> a ceiling (release, UNMET).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { holdStateName } from './guards/hold.ts'
import { decisionThreshold } from './jev/rules.ts'
import { liveOwnedRuns, watcherActive } from './early-stop.ts'

export { decisionThreshold }

export interface State {
  /** The goal check. EMPTY means a check-less, Jev-only hold: the goal is the whole objective. */
  check: string
  goal?: string
  /**
   * The work run this hold watches, absolute. While that run is IN FLIGHT the session may stop:
   * the round is being worked by a detached process and blocking buys nothing. Absent on a hold
   * armed outside a work dispatch, which is then never in flight.
   */
  run?: string
  authority?: string
  continuation?: string
  /** `afk` when /afk armed it (`overnight` is the pre-rename spelling, still honored for one release): such a hold yields to this session's live owned runs. */
  origin?: string
  goalPrompted?: boolean
  checkFiles?: Record<string, string>
  startedAt: number      // epoch seconds
  /**
   * The last Stop THIS FILE processed, epoch seconds — the liveness proof for the hook itself.
   *
   * Absent means no Stop has reached `main()` since the hold was armed. A hold is armed by a script
   * and enforced by a hook, and the two are registered independently: a session that started before
   * the hook was renamed keeps its OLD Stop registration while running the CURRENT dispatch script,
   * so it arms state that nothing evaluates. Measured 2026-09-28: a session predating v6.25 had its
   * Stop hook pointed at a hook file that v6.25 deleted, so the hold sat at rounds 0 forever, never
   * released after a PASS, and `cron-delete-guard.ts` — whose path did not change — went on refusing
   * every `CronDelete` of the heartbeats. Nothing in the state distinguished that from a hold whose
   * first round had not ended yet.
   */
  lastEvaluatedAt?: number
  ceilingMinutes: number
  maxRounds: number
  rounds: number
  history?: RoundRecord[]
  compact?: CapRecord
  /**
   * The other holds this session armed, oldest last — one per work run, in THIS object rather than a
   * file per run. The top-level hold is the one evaluated; `activeHold` rotates a queued hold to the
   * top when the top's run is in flight and the queued one's is not, and a release promotes the next.
   */
  queued?: State[]
}

/**
 * An afk mandate with no run: (a0) allows every Stop under it, and it is never in flight. On top of
 * another hold it would keep that hold from ever being evaluated before its 09:00 ceiling, so it
 * waits LAST and is promoted only when nothing else is held.
 */
export function afkMandate(h: { origin?: string; run?: string }): boolean {
  return (h.origin === 'afk' || h.origin === 'overnight') && !h.run
}

const mandatesLast = (hs: State[]): State[] => [...hs.filter(h => !afkMandate(h)), ...hs.filter(afkMandate)]

/** Swap queued hold `i` to the top. The container fields (compact, queued) stay with the top. */
export function promote(s: State, i: number): State {
  const q = [...(s.queued ?? [])]
  const [next] = q.splice(i, 1)
  const { queued: _q, compact, ...prev } = s
  return { ...next, queued: mandatesLast([...q, prev as State]), compact }
}

/** Drop the top hold and promote the first queued one, an afk mandate only when nothing else is left. */
export function nextHold(s: State): State {
  const [next, ...rest] = mandatesLast(s.queued ?? [])
  return { ...next, queued: rest, compact: s.compact }
}

/**
 * The hold this Stop is about: the top one unless its run is in flight while a queued one's is not.
 * A run in flight is being worked elsewhere; a held run with its verdict in is the session's work.
 */
export function activeHold(s: State): State {
  if (!s.queued?.length) return s
  if (afkMandate(s)) {
    const j = s.queued.findIndex(q => !afkMandate(q))
    return j < 0 ? s : promote(s, j)
  }
  if (!inFlight(s)) return s
  const i = s.queued.findIndex(q => !inFlight(q) && !afkMandate(q))
  return i < 0 ? s : promote(s, i)
}

/** Remove the hold watching `run` from the container; null when no hold is left. */
export function dropRun(s: State, run: string): { state: State | null; dropped: boolean } {
  const all = [s, ...(s.queued ?? [])]
  const keep = all.filter(h => h.run !== run)
  if (keep.length === all.length) return { state: s, dropped: false }
  if (!keep.length) return { state: null, dropped: true }
  const [top, ...rest] = mandatesLast(keep.map(({ queued: _q, compact: _c, ...h }) => h as State))
  return { state: { ...top, queued: rest, compact: s.compact }, dropped: true }
}

/** One round of the hold, as the hook observed it. */
export interface RoundRecord {
  round: number
  at: number             // epoch seconds
  exit: number           // the check's exit code
  note?: string          // the judge's verdict, when there was one
}

export function statePath(session: string): string {
  return join(process.env.TMPDIR || tmpdir(), holdStateName(session))
}

/**
 * The ledger beside the state file. `work-hold.sh` appends `armed` here when it arms and
 * `released by user` / `declined` / `refused` when release is attempted; this hook appends
 * the PASSED_GOAL_MET / PASSED_UNJUDGED verbs and `expired`. It exists because the state file alone
 * made the hold `rm`-able: a session that could not argue its way out could still delete its way
 * out. If the state file is gone while the ledger's last word is `armed`, the hold was removed by
 * something other than the two sanctioned exits, and it is RESTORED rather than honoured.
 */
export function ledgerPath(session: string): string {
  return join(process.env.TMPDIR || tmpdir(), `work-hold-${session}.releases.log`)
}

/**
 * The two passing releases, told apart by WHO said the goal was met.
 *
 * A green check is a floor, not the objective — so `passed` alone could not distinguish "the
 * classifier agreed the goal is met" from "there was no goal, or the classifier was unreachable and
 * we failed open". Measured 2026-09-26: a work run armed with no `--goal` released on
 * `work-result.sh` exiting 0, the heartbeat's teardown clause read that as done, and the session
 * ran `CronDelete` while the user's actual objective was untouched. Splitting the verb is what lets
 * the release message and `cron-delete-guard.ts` disagree with each other's optimism.
 */
export const PASSED_GOAL_MET = 'passed-goal-met'
export const PASSED_UNJUDGED = 'passed-unjudged'

// Appended to every release that ends a run. The session's mandate can outlive the run.
const HEARTBEAT_NOTE =
  `Leave the heartbeat cron in place if the session has other open work or a standing ` +
  `(overnight/autonomous) mandate. Retire it only when nothing else is owed, and CronDelete then ` +
  `asks the user to confirm.`

/**
 * A readOnly run's loop ended on a verdict, PASS or FAIL, and that verdict is the answer — no task
 * exists to change it, so holding for another round holds for nothing.
 */
export const VERDICT_REACHED = 'verdict-reached'

/** The verb `work-abandon.sh` appends when the USER retires a run. */
export const ABANDONED = 'abandoned by user'

/** The verb the Stop hook appends when a held run died without a verdict and its hold was dropped. */
export const RUN_DIED = 'run died'

/** Said once, on the Stop that dropped a dead run: in the block's reason, else as a system message. */
let deadNote = ''
const noted = (reason: string) => (deadNote ? `${deadNote}\n${reason}` : reason)
function allowStop(): never {
  if (deadNote) process.stdout.write(JSON.stringify({ systemMessage: deadNote }))
  process.exit(0)
}

/**
 * The ledger's last word about the HOLD — `capped` lines are bookkeeping for the context window and
 * say nothing about whether a hold is armed or released, so they are read through.
 */
export function lastLedgerEntry(ledger: string): { verb: string; payload: string } | null {
  if (!existsSync(ledger)) return null
  let out: { verb: string; payload: string } | null = null
  for (const line of readFileSync(ledger, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const f = line.split('\t')
    const verb = (f[1] || '').trim()
    if (!verb || verb === 'capped') continue
    out = { verb, payload: f[2] || '' }
  }
  return out
}

/**
 * Is the work run this hold watches still IN FLIGHT?
 *
 * The same filesystem test `cron-delete-guard.ts` and `work-abandon.sh` use: args.json exists and
 * no non-empty result.json sits beside it. A round in flight is being worked by a detached process,
 * so blocking the session's stop buys nothing and costs a wake — AGK 2026-09-27, where a heartbeat
 * woke 14 times while one round ran. A redispatch rotates result.json away, which makes the run in
 * flight again by the same test rather than by a second record of it.
 */
export function inFlight(s: { run?: string }): boolean {
  if (!s.run) return false
  if (!existsSync(join(s.run, 'args.json'))) return false
  try {
    return statSync(join(s.run, 'result.json')).size === 0
  } catch {
    return true                                   // absent result.json IS the in-flight shape
  }
}

/**
 * Did the watched run end as a READ-ONLY verdict? Returns `PASS, loop.exit 0` / `FAIL, loop.exit 8`,
 * else null. work-loop.sh exits 0 on ANY accepted PASS and 8 only on a readOnly FAIL, so both are a
 * verdict — secreg 2026-10-03, 1003-slides-18-diag PASSED at exit 0 and its "reach a verdict" goal
 * went to the judge, which put it at 31%. Only when the run's own args.json says `readOnly: true`:
 * on a run that writes, a PASS is a floor and its goal is still judged.
 */
export function verdictReached(s: { run?: string }): string | null {
  if (!s.run) return null
  try {
    const rc = readFileSync(join(s.run, 'loop.exit'), 'utf8').trim()
    if (rc !== '0' && rc !== '8') return null
    if (JSON.parse(readFileSync(join(s.run, 'args.json'), 'utf8')).readOnly !== true) return null
    return `${rc === '0' ? 'PASS' : 'FAIL'}, loop.exit ${rc}`
  } catch {
    return null
  }
}

/**
 * Did the watched run DIE without a verdict? Null when it did not, or when nothing says so.
 *
 * `inFlight` reads "args.json, no result.json" as a round being worked, which is also exactly what a
 * killed loop leaves — secreg 2026-10-03, 1002-slides-18-repair's loop took a SIGTERM and its hold
 * sat queued as "in flight" with nothing alive to write a verdict. The pids are already on disk:
 * work-loop.sh and the round each file `<root>/farm-events/<session>/<pid>.ndjson` with
 * out=<run>/loop.exit or <run>/result.json (farm.sh's percent-encoding, the caller's spelling and
 * its realpath both). Dead means such a record exists and every pid in it is gone; with no record
 * the run keeps its in-flight reading, so a hold never drops a run on missing evidence.
 */
export function runDied(s: { run?: string }, session: string, root?: string): string | null {
  if (!s.run || !session || !inFlight(s)) return null
  const enc = (p: string) => p.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\t/g, '%09').replace(/=/g, '%3D')
  const runs = new Set([s.run.replace(/\/+$/, '')])
  try {
    runs.add(realpathSync(s.run))
  } catch {
    /* the spelling given is all there is */
  }
  const targets = [...runs].flatMap(r => [`${r}/loop.exit`, `${r}/result.json`].map(enc))
  const pids: number[] = []
  for (const base of new Set([root || process.env.TMPDIR || tmpdir(), '/tmp'])) {
    const dir = join(base, 'farm-events', session)
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const pid = Number(name.replace(/\.ndjson$/, ''))
      if (!name.endsWith('.ndjson') || !Number.isInteger(pid) || pid <= 0) continue
      let text: string
      try {
        text = readFileSync(join(dir, name), 'utf8')
      } catch {
        continue
      }
      const cites = (line: string) => targets.some(t => line.includes(` out=${t} `) || line.includes(` path=${t} `) ||
        line.endsWith(` out=${t}`) || line.endsWith(` path=${t}`))
      if (text.split('\n').some(cites)) pids.push(pid)
    }
  }
  if (!pids.length) return null
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'EPERM'
    }
  }
  if (pids.some(alive)) return null
  let rc = ''
  try {
    rc = readFileSync(join(s.run, 'loop.exit'), 'utf8').trim()
  } catch {
    /* absent: killed before the wrapper could write it */
  }
  return rc
    ? `its loop exited ${rc} and no result.json was written`
    : `no process is left (pid ${pids.join(', ')}), and it wrote no loop.exit and no result.json — the loop was killed`
}

// The unevaluated-hold diagnosis lives in guards/hold.ts so the plugin's mod (cron-delete) can
// read it without node imports.
export { UNEVALUATED_AFTER_SECONDS, unevaluatedNote } from './guards/hold.ts'

/**
 * A ceiling reached, as a sentence — or null.
 *
 * Pulled out of `decide` because the clock has to bind on the paths `decide` never sees: a run in
 * flight (where no check is run at all) and a judge that keeps saying UNMET over a green check.
 * A hold that only expires on a red check is a hold with a hole in its clock.
 */
export function ceilingReached(
  s: { startedAt: number; ceilingMinutes: number; rounds: number; maxRounds: number },
  nowSeconds: number,
): string | null {
  const minutes = Math.floor((nowSeconds - s.startedAt) / 60)
  if (minutes >= s.ceilingMinutes)
    return `held for ${minutes} min, at or past the ${s.ceilingMinutes} min ceiling`
  if (s.rounds >= s.maxRounds) return `${s.rounds} rounds, at the ${s.maxRounds} ceiling`
  return null
}

/**
 * The rounds a WATCHED run has actually dispatched — `args.json.rounds`, which work-dispatch.sh sets
 * to 1 and work-redispatch.sh advances only when a round really goes out. Null when the hold watches
 * no run or its args carry no count; such a hold counts its own red Stops instead.
 *
 * A Stop is not a round. Counting Stops drained the budget while work was paused: secreg 2026-10-02,
 * "Round 2/6" and then 3/6 with no dispatch in between, args.json still at rounds 1.
 */
export function runRounds(s: { run?: string }): number | null {
  if (!s.run) return null
  try {
    const n = JSON.parse(readFileSync(join(s.run, 'args.json'), 'utf8')).rounds
    return typeof n === 'number' && Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/** The round clause of a block message: dispatched rounds for a run, the next Stop-round otherwise. */
export function roundLabel(s: { run?: string; rounds: number; maxRounds: number }): string {
  return runRounds(s) === null
    ? `Round ${s.rounds + 1}/${s.maxRounds}`
    : `${s.rounds}/${s.maxRounds} rounds dispatched (a Stop is not a round)`
}

/** What the hook decides, separated from the IO so it can be tested. */
export function decide(
  s: State,
  checkExit: number,
  nowSeconds: number,
): { action: 'pass' | 'block' | 'expired'; reason?: string } {
  if (checkExit === 0) return { action: 'pass' }

  const minutes = Math.floor((nowSeconds - s.startedAt) / 60)
  const ceiling = ceilingReached(s, nowSeconds)
  if (ceiling) return { action: 'expired', reason: ceiling }
  // ONE LINE. The clauses that used to ride along here are repeated verbatim every round, so the
  // two facts that actually change — the exit and the budget — were buried in a paragraph the
  // session had already read five times. They are printed on the first counted block and by
  // `--brief` after a compaction; everything else is conditional.
  return {
    action: 'block',
    reason:
      `\`${s.check}\` exits ${checkExit} — not met. ${roundLabel(s)}, ` +
      `${s.ceilingMinutes - minutes} min left. Act now: fix the cause; do not loosen the check.`,
  }
}

export 
/**
 * Did the RUBRIC move while the hold was armed?
 *
 * The state pins the check STRING, and the session authored the script it invokes — so an
 * inconvenient objective can be edited until it passes while the armed command never changes.
 * Observed 2026-09-22: a red gate's script was rewritten and it went green, with the hold none the
 * wiser. This does not forbid the edit (a broken instrument must be fixable mid-hold); it makes it
 * a recorded fact instead of an invisible one, on every block and on release.
 */
function rubricDrift(s: { checkFiles?: Record<string, string> }): string[] {
  const pinned = s.checkFiles ?? {}
  const moved: string[] = []
  for (const [file, was] of Object.entries(pinned)) {
    let now: string
    try {
      now = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16)
    } catch {
      moved.push(`${file} (gone)`)
      continue
    }
    if (now !== was) moved.push(file)
  }
  return moved
}

/**
 * What the judge reads: the session's own compaction summary, then the turns since it.
 *
 * A fixed tail is the wrong window for a long run. The harness compacts a session by REPLACING its
 * older turns with a summary and writing that summary into the transcript as an entry flagged
 * `isCompactSummary` -- so by round 6 the tail holds the last few minutes and nothing about what
 * the goal meant. That summary is already on disk and already paid for; reading the newest one is
 * the long-term memory this judge was missing, and it costs no record of our own.
 *
 * HEAD of the summary, TAIL of the turns: the summary opens with intent and closes with the state
 * it was written at, which the recent turns already cover better. The scan is over the WHOLE file,
 * because a boundary further back than the last 120 lines is precisely the long run this is for.
 */
export function transcriptContext(
  jsonl: string,
  tailChars: number,
  summaryChars: number,
): { summary: string; tail: string } {
  const lines = jsonl.trim().split('\n')
  const textOf = (c: unknown): string => {
    if (typeof c === 'string') return c
    if (Array.isArray(c))
      return c
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
    return ''
  }

  let boundary = -1
  let summary = ''
  for (let i = 0; i < lines.length; i++) {
    try {
      const e = JSON.parse(lines[i])
      if (e?.isCompactSummary !== true) continue
      const t = textOf(e?.message?.content).trim()
      if (t) {
        boundary = i
        summary = t.slice(0, summaryChars)
      }
    } catch {}
  }

  const texts: string[] = []
  for (const line of lines.slice(boundary + 1).slice(-120)) {
    try {
      const t = textOf(JSON.parse(line)?.message?.content)
      if (t) texts.push(t)
    } catch {}
  }
  return { summary, tail: texts.join('\n').slice(-tailChars) }
}

/**
 * The run's own memory -- and the reason it needs no file of its own.
 *
 * The exit code each round, and the judge's reason when it spoke, are facts the hook already
 * computes and then threw away; by round 6 nothing remembered that round 2 had been released-then-
 * blocked for a reason still outstanding. They go in the EXISTING state file, which is where
 * mutable episode state belongs, rather than in a second file that could disagree with it. Bounded
 * on write, so a long hold cannot grow the record without limit.
 */
export function renderHistory(h: RoundRecord[] | undefined): string {
  if (!h?.length) return ''
  return h
    .map((r) => {
      const t = new Date(r.at * 1000).toISOString().slice(11, 16)
      return `  round ${r.round} (${t}Z): check exit ${r.exit}${r.note ? ` -- ${r.note}` : ''}`
    })
    .join('\n')
}

export function pushRound(s: State, r: RoundRecord, max = 20): void {
  s.history = [...(s.history ?? []), r].slice(-max)
}

/** The leg names check.sh lists under "failing leg(s):", each as printed, e.g. `hierarchy (exit 1)`. */
export function failingLegs(output: string): string[] {
  const lines = String(output || '').split('\n')
  const i = lines.findIndex((l) => /failing leg\(s\):/.test(l))
  if (i < 0) return []
  const out: string[] = []
  for (const l of lines.slice(i + 1)) {
    const m = l.match(/^\s+-\s+(.+?)\s*$/)
    if (!m) break
    out.push(m[1])
  }
  return out
}

/**
 * The watched run's verdict as NAMED FACTS — what a goal is written against.
 *
 * A goal names legs, findings and counts ("check.sh names no failing leg other than hierarchy, and the
 * lens has no surviving critical or major finding"); `overallPass` aggregates every gate in the plan,
 * including the ones the goal excludes. Without these the judge saw only the transcript, where the
 * session had pasted `verdict: FAIL (overallPass=false)`, and put a met goal at 29% (secreg
 * 2026-10-02: the one failing leg was the excluded `hierarchy (exit 1)`, survivingBlocking 0).
 * Empty when the run has no readable result.json. Plain words only: the red verdict's own label
 * (green-not-green) and the flagged-task list cost the met goal ~8 points live and named no
 * condition a goal states.
 */
export function runFacts(run: string | undefined): string {
  if (!run) return ''
  let r: Record<string, any>
  try {
    const raw = JSON.parse(readFileSync(join(run, 'result.json'), 'utf8'))
    r = Array.isArray(raw) ? raw[raw.length - 1] : raw
    if (!r || typeof r !== 'object') return ''
  } catch {
    return ''
  }
  const legsOf = (output: string, exit: unknown): string => {
    const legs = failingLegs(output)
    if (legs.length) return `; failing leg(s), as the check names them: ${legs.join(', ')} — every other leg passed`
    return exit === 0 ? '' : output ? `; output ends: ${String(output).trim().slice(-200)}` : ''
  }
  const out: string[] = []
  for (const m of Array.isArray(r.mechanical) ? r.mechanical : [])
    if (m && typeof m === 'object')
      out.push(`mechanical check ${m.name}: exit ${m.exitCode}${legsOf(m.output, m.exitCode)}`)
  for (const c of Array.isArray(r.red) ? r.red : [])
    if (c && typeof c === 'object')
      out.push(
        `red command ${c.id} (\`${String(c.command || '').slice(0, 200)}\`): exit ${c.afterExit} after ` +
          `the round (it exited ${c.beforeExit} before)${legsOf(c.afterOutput, c.afterExit)}`,
      )
  const t = r.scoreTable && typeof r.scoreTable === 'object' ? r.scoreTable : {}
  if (typeof t.survivingBlocking === 'number')
    out.push(
      `lens: survivingBlocking ${t.survivingBlocking} (critical/major findings that survived the round), ` +
        `survivingMinor ${t.survivingMinor ?? '?'}, lens findings ${t.lensFindings ?? '?'}`,
    )
  const names = (k: string) => (Array.isArray(r[k]) && r[k].length ? r[k].map((x: any) => (typeof x === 'string' ? x : x?.name ?? x?.id ?? JSON.stringify(x))).join(', ') : 'none')
  out.push(`lenses that flagged: ${names('lensesThatFlagged')}`)
  out.push(`rules that failed: ${names('rulesThatFailed')}`)
  // LAST, and labelled: the aggregate is a fact about the plan, not the goal.
  out.push(
    `whole-plan verdict: ${r.verdict ?? '?'} (overallPass=${r.overallPass}) — this aggregates EVERY gate ` +
      `in the plan, including any the goal excludes; it is not the goal`,
  )
  return `RUN FACTS — read from ${join(run, 'result.json')}; judge each condition the goal states against these:\n` +
    out.map((l) => `  - ${l}`).join('\n')
}

/**
 * Ask an INDEPENDENT model whether the goal is met, reading the transcript.
 *
 * `/goal` installed a Stop hook "judged by a model reading the transcript" (compose-goal.sh), and
 * the hold replaced it with a command because a transcript judge can be satisfied by saying the right
 * things. Both halves are real, so this runs IN ADDITION to the check, never instead: the check is
 * the executable floor, and the judge catches the case the floor cannot see — a narrow check going
 * green while the stated objective is untouched. It is a SEPARATE process on a haiku-class model,
 * so it is not the session grading itself.
 *
 * Only invoked when the check already passes, so the ordinary blocked turn costs nothing.
 * Fails OPEN: no judge, no network, no answer it can parse -> release with a note. A hook that
 * traps a session because a model was unreachable is worse than one that lets a turn end.
 */
/**
 * Pull the verdict out of a judge's stdout.
 *
 * SCAN for it; do not assume it is the first line. The wrapper prints its own warnings ahead of the
 * model's answer — permission-rule notices, connector notices, a stdin timeout — so reading line 0
 * returned a warning and every verdict parsed as UNAVAILABLE. The pattern matches a STANDALONE
 * word so a sentence that happens to contain "unmet" cannot masquerade as the verdict.
 */
export function parseJudgeVerdict(
  stdout: string,
): { verdict: 'MET' | 'UNMET' | 'UNAVAILABLE'; reason: string } {
  const text = stdout.trim()
  if (!text) return { verdict: 'UNAVAILABLE', reason: 'empty judge reply' }

  // Preferred: the schema'd envelope. `response_format: json_schema` is an API feature and the
  // OAuth-proxied routes may ignore or reject it, so a prose answer is accepted too rather than
  // depended upon not to happen.
  let content = text
  try {
    const env = JSON.parse(text)
    const c = env?.choices?.[0]?.message?.content
    if (typeof c === 'string') content = c
    else if (env && typeof env === 'object' && 'choices' in env)
      return { verdict: 'UNAVAILABLE', reason: 'no content in judge reply' }
  } catch {
    /* not an envelope: treat the whole thing as the answer */
  }

  try {
    const v = JSON.parse(content)
    if (typeof v?.met === 'boolean') {
      const why = typeof v.why === 'string' ? v.why.slice(0, 400) : ''
      return v.met ? { verdict: 'MET', reason: why } : { verdict: 'UNMET', reason: why }
    }
  } catch {
    /* not json: fall through to the prose scanner */
  }

  // Prose fallback. SCAN for the verdict; the wrapper prints permission and connector notices
  // ahead of the answer, so line 0 is often a warning. Match a STANDALONE word so a sentence
  // mentioning "unmet" cannot masquerade as the verdict.
  const lines = content.split('\n').map((l) => l.trim())
  const idx = lines.findIndex((l) => /^\**(MET|UNMET)\**[.:]?$/i.test(l))
  if (idx === -1) return { verdict: 'UNAVAILABLE', reason: 'judge gave no parsable verdict' }
  const word = lines[idx].toUpperCase().replace(/[^A-Z]/g, '')
  const why = lines.slice(idx + 1).join(' ').trim().slice(0, 400)
  return word === 'UNMET'
    ? { verdict: 'UNMET', reason: why || 'judge said unmet' }
    : { verdict: 'MET', reason: why || 'judge said met' }
}


/**
 * Ask Jev (TypeSafe System One, via OpenRouter's Decisions API) whether the goal is met.
 *
 * This is a DECISION model, not a chat model: it takes state plus typed questions and returns a
 * typed answer. A `noul` question is exactly this judge's shape -- "evaluate a yes/no question and
 * return the PROBABILITY that the answer is yes" -- so the verdict arrives calibrated rather than
 * as a word to be parsed, and the threshold is ours to set in code.
 *
 * It does NOT speak chat completions; the model page is explicit that chat SDKs will not work with
 * it. Request: {state, model, questions:{k:{type:"noul", instructions}}}.
 * Response:    {answers:{k:{type:"noul", noul:0..1}}, usage:{...}}.
 *
 * Priced at $0.042/M in and FREE out (2026-09-22), with a 0.26s P50 -- which suits a judge that
 * runs inside a Stop hook and returns one bit.
 */
export function parseNoul(
  stdout: string,
  key: string,
  threshold: number,
): { verdict: 'MET' | 'UNMET' | 'UNAVAILABLE'; reason: string } {
  try {
    const d = JSON.parse(stdout)
    const a = d?.answers?.[key]
    const p = typeof a?.noul === 'number' ? a.noul : null
    if (p === null) return { verdict: 'UNAVAILABLE', reason: 'no noul answer in the decision reply' }
    const pct = Math.round(p * 100)
    const bar = decisionThreshold(d, threshold)
    const at = `(threshold ${Math.round(bar * 100)}%${d?.provider === 'openai' ? ', luna fallback' : ''})`
    return p >= bar
      ? { verdict: 'MET', reason: `judge put the goal met at ${pct}% ${at}` }
      : { verdict: 'UNMET', reason: `judge put the goal met at only ${pct}% ${at}` }
  } catch {
    return { verdict: 'UNAVAILABLE', reason: 'decision reply was not parsable json' }
  }
}

/**
 * The Decisions transport, and the ONLY place it is spelled: URL, model, token resolution and the
 * curl invocation. `judgeViaDecisions` below asks it one question; `scripts/lib/route.ts` asks it
 * one per routing candidate. A second copy of this would be a second set of env-var names and a
 * second way for the token lookup to go stale.
 *
 * `questions` is the Decisions `questions` map verbatim — each entry {type, instructions} plus, for
 * a `choice`, its `criteria`. `opts.maxTimeSeconds` caps the request (default 60);
 * `opts.model` names the model and beats $WORK_HOLD_DECISIONS_MODEL — a caller that passes one is
 * reading it from a table it owns. Returns raw stdout on success, or an `unavailable` reason. It
 * NEVER throws and never interprets an answer.
 */
/** The reason every OpenRouter caller gives for a 402. The user tops up by hand; there is no auto top-up. */
export const OPENROUTER_OUT_OF_CREDITS =
  'OpenRouter is out of credits — top up at https://openrouter.ai/settings/credits'

/** HTTP 402, or OpenRouter's error body for it (`error.code` 402, "insufficient credits"), under any status. */
export function outOfCredits(status: number, body: string): boolean {
  if (status === 402) return true
  const said = (t: unknown) => /insufficient credits|out of credits|requires more credits/i.test(String(t ?? ''))
  try {
    const err = JSON.parse(body)?.error
    return !!err && (err.code === 402 || said(err.message))
  } catch {
    return status >= 400 && said(body.slice(0, 2000))
  }
}

type Key = { key: string; missing: null } | { key: null; missing: string }

/** A key from $<envVar>, else $XDG_RUNTIME_DIR/agenix/<secret>. Null with the reason. */
function keyFrom(envVar: string, secret: string, name: string): Key {
  let token = process.env[envVar] || ''
  if (!token) {
    const runtime = process.env.XDG_RUNTIME_DIR || '/run/user/1000'
    try {
      token = readFileSync(`${runtime}/agenix/${secret}`, 'utf8').trim()
    } catch {
      return { key: null, missing: `no ${name} key (agenix secret not present)` }
    }
  }
  return token ? { key: token, missing: null } : { key: null, missing: `empty ${name} key` }
}

/** The OpenRouter key every caller uses: $WORK_HOLD_JUDGE_TOKEN, else the agenix secret. Null with the reason. */
export function openrouterKey(): Key {
  return keyFrom('WORK_HOLD_JUDGE_TOKEN', 'openrouter-api-key', 'openrouter')
}

/** The key the OpenAI Decisions fallback uses: $OPENAI_API_KEY, else the agenix secret. Null with the reason. */
export function openaiKey(): Key {
  return keyFrom('OPENAI_API_KEY', 'openai-api-key', 'openai')
}

const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions'

/** Jev pointed anywhere but its real endpoint: a test's stub. */
function jevStubbed(): boolean {
  const u = process.env.WORK_HOLD_DECISIONS_URL
  return !!u && u !== DECISIONS_URL
}

/** Who is spending: opts.caller, else $JEV_CALLER, else the running script's name. */
function callerName(explicit?: string): string {
  if (explicit) return explicit
  if (process.env.JEV_CALLER) return process.env.JEV_CALLER
  const a = (process.argv[1] || '').split('/').pop() || '-'
  return a.replace(/\.(ts|js|mjs)$/, '')
}

/**
 * The append-only call log bin/jev-spend reads: one NDJSON line per decisionsCall, billed or not.
 * $JEV_CALL_LOG names it ('off' = none); unset, it is ${XDG_STATE_HOME:-~/.local/state}/jev/calls.ndjson
 * against the real endpoint and nothing against a stub URL, so a test run outside scripts/test.sh
 * never writes the user's log. Not $TMPDIR: the canary and farm rows give each suite run a fresh one,
 * and their calls would vanish with it.
 */
export function jevCallLogPath(): string | null {
  const v = process.env.JEV_CALL_LOG
  if (v === 'off') return null
  if (v) return v
  if (jevStubbed()) return null
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'jev', 'calls.ndjson')
}

/**
 * The content-addressed reply cache: <dir>/<sha256(url, model, state, questions)>.json, one file per
 * reply (no read-modify-write between concurrent hooks), kept $JEV_CACHE_TTL seconds (default a day).
 * An identical request is answered from it unbilled. The dir is $JEV_CACHE_DIR, else
 * ${XDG_CACHE_HOME:-~/.cache}/jev — machine-wide, because the repeats it exists for (a suite's live
 * tests, a re-run rule leg) come from runs that each get their own $TMPDIR. On against the real
 * endpoint only, unless $JEV_CACHE=on; $JEV_CACHE=off, or opts.cache false, bypasses it.
 */
export function jevCacheDir(): string | null {
  const v = process.env.JEV_CACHE
  if (v === 'off') return null
  if (jevStubbed() && v !== 'on') return null
  return process.env.JEV_CACHE_DIR || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'jev')
}

function cacheTtlMs(): number {
  const n = Number(process.env.JEV_CACHE_TTL)
  return (Number.isFinite(n) && n >= 0 && process.env.JEV_CACHE_TTL !== '' ? n : 86400) * 1000
}

function logCall(rec: Record<string, unknown>): void {
  const path = jevCallLogPath()
  if (!path) return
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, JSON.stringify(rec) + '\n')
  } catch {
    /* a spend record is never a reason to fail a judge call */
  }
}

/** A curl config-file string: quoted, with the escapes curl's config parser undoes. */
function curlQuote(v: string): string {
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"'
}

/** Expired replies go on a write, at most one sweep a minute per process. */
let lastSweep = 0
function sweepCache(dir: string, ttl: number, now: number): void {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  try {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      try {
        if (now - statSync(p).mtimeMs > ttl) rmSync(p, { force: true })
      } catch {}
    }
  } catch {}
}

type Question = { type: string; instructions: string; criteria?: Record<string, string> }
type DecisionResult = { stdout: string; unavailable: null } | { stdout: null; unavailable: string }

/**
 * One POST through curl. The key AND the payload go to curl as one config on stdin (`-K -`), never
 * argv: argv is world-readable in `ps`, and a temp file holding the key outlives a child killed
 * mid-call. curl exits 0 on a 4xx, so the status rides on a trailing line: a 402 body otherwise
 * reaches every caller as a reply with no answers, and the empty account reads as a parse failure.
 * Null when curl itself failed (unreachable, timed out).
 */
function curlPost(url: string, key: string, payload: string, maxTime: number): { status: number; body: string } | null {
  const r = spawnSync(
    'curl',
    ['-sS', '--max-time', String(maxTime), '-X', 'POST', url,
     '-K', '-',
     '-H', 'Content-Type: application/json',
     '-w', '\n%{http_code}'],
    // The spawn timeout is a backstop 30 s behind curl's own cap: 90 s at the default 60.
    {
      encoding: 'utf8',
      input: `header = ${curlQuote(`Authorization: Bearer ${key}`)}\ndata-binary = ${curlQuote(payload)}\n`,
      timeout: (maxTime + 30) * 1000,
    },
  )
  if (r.error || r.status !== 0) return null
  const raw = r.stdout || ''
  const nl = raw.lastIndexOf('\n')
  return { body: nl >= 0 ? raw.slice(0, nl) : raw, status: Number(nl >= 0 ? raw.slice(nl + 1).trim() : 0) }
}

const OPENAI_DECISIONS_URL = 'https://api.openai.com/v1/decisions'
const LUNA_MODEL = 'gpt-6-luna'

/**
 * The fallback when Jev failed: OpenAI's Decisions API on gpt-6-luna, its answer translated to Jev's
 * reply shape and tagged `provider: "openai"` so every reader judges it at decisionThreshold. Each
 * question goes as a predicate — a noul's instructions verbatim, a choice's instructions with its
 * VIOLATED criterion, whose probability becomes probabilities.VIOLATED. Null (the caller keeps Jev's
 * own result) when there is no key, a question it cannot pose, or no complete answer. Never cached.
 *
 * $OPENAI_DECISIONS_URL names the endpoint. A stubbed Jev never falls through to the real OpenAI
 * endpoint: every suite that points Jev at a dead port or a 5xx stub would otherwise spend live calls
 * once the key is on the machine.
 */
function lunaFallback(state: string, questions: Record<string, Question>, rec: Record<string, unknown>, maxTime: number): DecisionResult | null {
  const url = process.env.OPENAI_DECISIONS_URL || (jevStubbed() ? null : OPENAI_DECISIONS_URL)
  if (!url) return null
  const preds: { type: 'predicate'; name: string; instructions: string }[] = []
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === 'noul') preds.push({ type: 'predicate', name, instructions: q.instructions })
    else if (q.type === 'choice' && typeof q.criteria?.VIOLATED === 'string')
      preds.push({ type: 'predicate', name, instructions: `${q.instructions}\n\nAnswer the probability that this is true of the state: ${q.criteria.VIOLATED}` })
    else return null
  }
  const k = openaiKey()
  if (k.key === null) return null

  const started = Date.now()
  const base = { ...rec, ts: new Date(started).toISOString(), provider: 'openai', model: LUNA_MODEL, cache: 'off' }
  const r = curlPost(url, k.key, JSON.stringify({ model: LUNA_MODEL, input: state, questions: preds }), maxTime)
  if (!r) {
    logCall({ ...base, ms: Date.now() - started, unavailable: 'openai decisions endpoint unreachable' })
    return null
  }
  let reply: any = null
  try {
    reply = JSON.parse(r.body)
  } catch {}
  const prob = new Map<string, number>()
  for (const a of Array.isArray(reply?.answers) ? reply.answers : [])
    if (typeof a?.name === 'string' && typeof a.probability === 'number' && a.probability >= 0 && a.probability <= 1)
      prob.set(a.name, a.probability)
  const answers: Record<string, unknown> = {}
  for (const [name, q] of Object.entries(questions)) {
    const p = prob.get(name)
    if (p === undefined) continue
    if (q.type === 'noul') {
      answers[name] = { type: 'noul', noul: p }
    } else {
      const rest = Object.keys(q.criteria!).filter(c => c !== 'VIOLATED')
      const probabilities: Record<string, number> = { VIOLATED: p }
      for (const c of rest) probabilities[c] = (1 - p) / rest.length
      const choice = Object.entries(probabilities).reduce((a, b) => (b[1] > a[1] ? b : a))[0]
      answers[name] = { type: 'choice', choice, probabilities }
    }
  }
  const inTokens = typeof reply?.usage?.input_tokens === 'number' ? reply.usage.input_tokens : null
  const outTokens = typeof reply?.usage?.output_tokens === 'number' ? reply.usage.output_tokens : null
  // gpt-6-luna is priced at $0.10/M in
  const cost = inTokens === null ? null : (inTokens * 0.10) / 1e6
  const complete = r.status >= 200 && r.status < 300 && Object.keys(questions).every(q => q in answers)
  logCall({ ...base, ms: Date.now() - started, status: r.status, inTokens, outTokens, cost, ...(complete ? {} : { unavailable: 'no answers' }) })
  if (!complete) return null
  return {
    stdout: JSON.stringify({ provider: 'openai', model: LUNA_MODEL, answers, usage: { input_tokens: inTokens, output_tokens: outTokens, cost } }),
    unavailable: null,
  }
}

/**
 * When Jev fails — curl failed, HTTP 429, 402 or any 5xx, or a reply that does not answer every
 * question — the OpenAI Decisions fallback (lunaFallback) is asked once, unless opts.fallback is false;
 * without its answer the caller gets Jev's own result unchanged. A Jev that answers is never second-guessed.
 */
export function decisionsCall(
  state: string,
  questions: Record<string, Question>,
  opts: { maxTimeSeconds?: number; model?: string; caller?: string; session?: string; cache?: boolean; fallback?: boolean } = {},
): DecisionResult {
  const url = process.env.WORK_HOLD_DECISIONS_URL || DECISIONS_URL
  const model = opts.model || process.env.WORK_HOLD_DECISIONS_MODEL || 'typesafe/jev-1.13'
  const maxTime =
    typeof opts.maxTimeSeconds === 'number' && Number.isFinite(opts.maxTimeSeconds) && opts.maxTimeSeconds > 0
      ? opts.maxTimeSeconds
      : 60
  const started = Date.now()
  const rec: Record<string, unknown> = {
    ts: new Date(started).toISOString(),
    caller: callerName(opts.caller),
    session: opts.session || process.env.CLAUDE_CODE_SESSION_ID || '-',
    cwd: process.cwd(),
    model,
    stateBytes: Buffer.byteLength(state),
    questions: Object.keys(questions).length,
  }
  const orLuna = (jev: DecisionResult): DecisionResult =>
    (opts.fallback === false ? null : lunaFallback(state, questions, rec, maxTime)) ?? jev

  const payload = JSON.stringify({ state, model, questions })
  const cacheDir = opts.cache === false ? null : jevCacheDir()
  const ttl = cacheTtlMs()
  const cachePath = cacheDir && ttl > 0
    ? join(cacheDir, createHash('sha256').update(url).update('\0').update(payload).digest('hex') + '.json')
    : null
  if (cachePath) {
    try {
      if (started - statSync(cachePath).mtimeMs <= ttl) {
        const body = readFileSync(cachePath, 'utf8')
        const hit = JSON.parse(body)
        if (Object.keys(questions).every(q => hit?.answers?.[q])) {
          // `saved` is what the original ask cost: the cached reply carries its own usage
          const saved = typeof hit?.usage?.cost === 'number' ? hit.usage.cost : null
          logCall({ ...rec, cache: 'hit', inTokens: 0, outTokens: 0, cost: 0, saved, ms: Date.now() - started })
          return { stdout: body, unavailable: null }
        }
      }
    } catch {
      /* no entry, or an unreadable one: ask */
    }
  }

  const k = openrouterKey()
  if (k.key === null) {
    logCall({ ...rec, cache: cachePath ? 'miss' : 'off', unavailable: k.missing })
    return { stdout: null, unavailable: k.missing }
  }

  const r = curlPost(url, k.key, payload, maxTime)
  const done = { ...rec, cache: cachePath ? 'miss' : 'off', ms: 0 }
  if (!r) {
    logCall({ ...done, ms: Date.now() - started, unavailable: 'decisions endpoint unreachable' })
    return orLuna({ stdout: null, unavailable: 'decisions endpoint unreachable' })
  }
  const { body, status } = r
  let reply: any = null
  try {
    reply = JSON.parse(body)
  } catch {}
  const u = reply?.usage ?? {}
  logCall({
    ...done,
    ms: Date.now() - started,
    status,
    inTokens: typeof u.input_tokens === 'number' ? u.input_tokens : null,
    outTokens: typeof u.output_tokens === 'number' ? u.output_tokens : null,
    cost: typeof u.cost === 'number' ? u.cost : null,
    ...(reply?.answers ? {} : { unavailable: outOfCredits(status, body) ? 'out of credits' : 'no answers' }),
  })
  if (outOfCredits(status, body)) return orLuna({ stdout: null, unavailable: OPENROUTER_OUT_OF_CREDITS })
  const answered = Object.keys(questions).every(q => reply?.answers?.[q])
  // Only a reply that answered EVERY question is kept: an error or a partial reply is asked again,
  // never replayed — a caller's retry would otherwise get the same miss back.
  if (cachePath && status < 400 && answered) {
    try {
      mkdirSync(cacheDir!, { recursive: true })
      const tmp = `${cachePath}.${process.pid}.tmp`
      writeFileSync(tmp, body)
      renameSync(tmp, cachePath)
      sweepCache(cacheDir!, ttl, started)
    } catch {}
  }
  const jev: DecisionResult = { stdout: body, unavailable: null }
  return status === 429 || status === 402 || status >= 500 || !answered ? orLuna(jev) : jev
}

function judgeViaDecisions(
  state: string,
  goal: string,
  hasFacts = false,
): { verdict: 'MET' | 'UNMET' | 'UNAVAILABLE'; reason: string } {
  // The threshold is DELIBERATELY high. Releasing a hold ends the work, so "probably done" is not
  // done: an uncertain answer should keep the session working, which is the failure this whole
  // mechanism exists to prevent.
  const threshold = Number(process.env.WORK_HOLD_DECISIONS_THRESHOLD || 0.8)
  const r = decisionsCall(state, {
    met: {
      // TWO CLAUSES, because the stall this exists to stop happens at a moment of legitimate
      // completion: the stated goal reads done and the session has just named the next thing it
      // found. "Met" alone releases there; "met AND nothing obvious left open" does not.
      //
      // A WATCHED RUN is the exception: its goal is written against the run's verdict, so the state
      // is the run's facts and the question is the goal's own conditions against them. Measured live
      // 2026-10-02 on the secreg verdict: the two-clause question scored the met goal 51-67% and the
      // same verdict with a non-excluded leg failing 12-67% — open work elsewhere in the session
      // drowned the goal; this question scored them 83% and 10%.
      type: 'noul',
      instructions: hasFacts
        ? 'Judged ONLY against the RUN FACTS in the state, condition by condition, every condition this ' +
          'goal states holds. A failing leg, rule or verdict the goal excludes or does not name does not ' +
          `count against it, and the whole-plan verdict is not the goal. Goal: ${goal}`
        : `This goal is met AND no obvious open work remains that the session should do next: ${goal}`,
    },
  }, { caller: 'work-hold' })
  if (r.stdout === null) return { verdict: 'UNAVAILABLE', reason: r.unavailable }
  return parseNoul(r.stdout, 'met', threshold)
}

function judgeGoal(
  transcriptPath: string,
  goal: string,
  check: string,
  history?: RoundRecord[],
  run?: string,
): { verdict: 'MET' | 'UNMET' | 'UNAVAILABLE'; reason: string } {
  // The verdict is ONE WORD, so the model does almost no work -- the cost is what we send it.
  // Sending 12000 characters of transcript to get back "MET" is paying for input to produce a bit.
  // 4000 covers the recent turns a verdict rests on, and the compaction summary covers the run they
  // sit in; both are overridable when a goal needs more.
  const TAIL_CHARS = Number(process.env.WORK_HOLD_JUDGE_TAIL_CHARS || 4000)
  const SUMMARY_CHARS = Number(process.env.WORK_HOLD_JUDGE_SUMMARY_CHARS || 3000)
  // A watched run with a readable verdict is judged on its FACTS alone: the transcript paraphrases
  // them (the session had pasted `overallPass=false`) and the hold's own history carries the earlier
  // judge's percentages, both of which pulled a met goal down to 29%.
  const facts = runFacts(run)
  let ctx: { summary: string; tail: string } = { summary: '', tail: '' }
  if (!facts) {
    try {
      ctx = transcriptContext(readFileSync(transcriptPath, 'utf8'), TAIL_CHARS, SUMMARY_CHARS)
    } catch {
      return { verdict: 'UNAVAILABLE', reason: 'no readable transcript' }
    }
    if (!ctx.tail.trim() && !ctx.summary.trim())
      return { verdict: 'UNAVAILABLE', reason: 'empty transcript' }
  }

  const rounds = facts ? '' : renderHistory(history)
  const evidence = [
    facts,
    ctx.summary &&
      `EARLIER IN THIS RUN — the session's own compaction summary of turns since dropped from its context:\n${ctx.summary}`,
    rounds && `WHAT THE HOLD RECORDED, round by round:\n${rounds}`,
    ctx.tail && `MOST RECENT TURNS:\n${ctx.tail}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const prompt = facts
    ? `You are judging whether every condition a goal states holds, ONLY against the run facts below. ` +
      `A failing leg, rule or verdict the goal excludes or does not name does not count against it, and ` +
      `the whole-plan verdict is not the goal.\n\nGOAL: ${goal}\n\n${evidence}\n\n` +
      `Set met=false if any condition the goal states is contradicted or not established by the facts. ` +
      `Put one sentence of evidence in why.`
    : `You are judging whether a coding session has MET its stated goal AND has no obvious open work ` +
      `left to do next. You are not the session; judge only from the evidence below.\n\nGOAL: ${goal}\n\n` +
      (check
        ? `A command called the check already exits 0: ${check}\nThat is a floor, not proof the goal is met.\n\n`
        : `There is no check command: the goal is the whole objective.\n\n`) +
      `${evidence}\n\n` +
      `Set met=false if the goal names work that is still outstanding, blocked, or only partly done, ` +
      `or if the session has itself named an obvious next action it has not taken. ` +
      `Put one sentence of evidence in why.`

  // Jev first: a decision model returns a calibrated probability for one typed question, which is
  // this judge's exact shape and an order of magnitude cheaper than a chat round trip. The chat
  // judge below stays as the fallback for when the key or the endpoint is not there.
  const decided = judgeViaDecisions(evidence, goal, !!facts)
  if (decided.verdict !== 'UNAVAILABLE') return decided
  // An empty OpenRouter account must reach the user through the hold message, whatever the fallback says.
  if (decided.reason === OPENROUTER_OUT_OF_CREDITS) {
    const chat = judgeViaChat(prompt)
    return chat.verdict === 'UNAVAILABLE'
      ? decided
      : { verdict: chat.verdict, reason: `${chat.reason} (chat fallback; Jev skipped: ${OPENROUTER_OUT_OF_CREDITS})` }
  }
  return judgeViaChat(prompt)
}

function judgeViaChat(prompt: string): { verdict: 'MET' | 'UNMET' | 'UNAVAILABLE'; reason: string } {
  // STRUCTURED OUTPUT, not prose parsing. The verdict is a boolean, and asking for it in prose
  // then scanning for a standalone MET/UNMET is guesswork with a fail-open hole: the wrapper's own
  // warning lines sat ahead of the answer, and a judge that cannot be parsed silently stops
  // judging. The proxy speaks OpenAI chat completions with `response_format: json_schema`, so the
  // shape is guaranteed by the server rather than requested politely.
  //
  // Calling the HTTP API also removes the agent CLI entirely, and with it a bug this had: those
  // wrappers load the CLAUDE.md, hooks and skills of whatever directory they start in and answer
  // AS that agent -- the same prompt returned "UNMET" from /tmp and "work run abandoned..." from
  // a repo carrying work context. An HTTP call has no cwd and no persona to inherit.
  const url = process.env.WORK_HOLD_JUDGE_URL || 'http://127.0.0.1:8317/v1/chat/completions'
  const token = process.env.WORK_HOLD_JUDGE_TOKEN || 'sk-local-claude-proxy'
  const model = process.env.WORK_HOLD_JUDGE_MODEL || 'gpt-5.6-luna'

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'verdict',
        strict: true,
        schema: {
          type: 'object',
          properties: { met: { type: 'boolean' }, why: { type: 'string' } },
          required: ['met', 'why'],
          additionalProperties: false,
        },
      },
    },
  }

  const post = (payload: unknown) =>
    spawnSync(
      'curl',
      ['-sS', '--max-time', '90', '-X', 'POST', url,
       '-H', `Authorization: Bearer ${token}`,
       '-H', 'Content-Type: application/json',
       '--data-binary', '@-'],
      { encoding: 'utf8', input: JSON.stringify(payload), timeout: 120_000 },
    )

  let r = post(body)
  if (r.error || r.status !== 0) return { verdict: 'UNAVAILABLE', reason: 'judge endpoint unreachable' }
  let out = parseJudgeVerdict(r.stdout || '')

  // RETRY WITHOUT THE SCHEMA. `response_format` is an API feature and an OAuth-proxied route may
  // reject it -- curl still exits 0 on a 4xx, so the error body arrives as an unparsable verdict
  // and judging would have stopped silently while everything looked healthy. The retry asks in
  // prose and the parser accepts that shape too.
  if (out.verdict === 'UNAVAILABLE') {
    const { response_format: _dropped, ...plain } = body as Record<string, unknown>
    const proseAsk =
      prompt +
      '\n\nAnswer on the first line with exactly one word, MET or UNMET. On the second line give ' +
      'one sentence of evidence.'
    r = post({ ...plain, messages: [{ role: 'user', content: proseAsk }] })
    if (r.error || r.status !== 0) return { verdict: 'UNAVAILABLE', reason: 'judge endpoint unreachable' }
    out = parseJudgeVerdict(r.stdout || '')
  }
  return out
}

/* ------------------------------------------------------------------ the auto-compact window cap
 *
 * A held session keeps working, so every turn bills against the model's FULL window until
 * auto-compact fires there. Capping it is worth roughly a 4x cut in steady-state input — but a
 * RUNNING session reads `autoCompactWindow` once at startup (2.1.280), so editing any settings
 * file mid-session changes nothing for the session already in flight.
 *
 * `/autocompact <X>` is the only live path into a running session, and what it applies is NOT X:
 * it writes X into the user's GLOBAL settings, re-reads the MERGED settings — where the project's
 * `.claude/settings.local.json` outranks global — and applies the merged value. So the cap goes in
 * the PROJECT-LOCAL file and the command is sent with the global file's CURRENT value, which makes
 * the global write a no-op while the session picks up the local cap. Release is the reverse.
 *
 * Verified live 2026-09-22 against 2.1.280: with a local cap present, `/autocompact auto` replied
 * "set to auto in settings, but a higher-priority override is active (300k tokens)" and left the
 * global file alone.
 */

/** The file `/autocompact` writes to. Resolved through symlinks — it is usually stowed. */
export function userSettingsPath(): string {
  const p = process.env.WORK_HOLD_USER_SETTINGS || join(homedir(), '.claude', 'settings.json')
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** The project-local file that outranks global — where the cap actually lives. */
export function localSettingsPath(): string {
  return join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'settings.local.json')
}

const WINDOW_KEY = 'autoCompactWindow'

function readSettings(path: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** What to send so that `/autocompact`'s global write reproduces the value already there. */
export function globalArg(): string {
  const g = readSettings(userSettingsPath())
  const v = g?.[WINDOW_KEY]
  return typeof v === 'number' && Number.isFinite(v) ? String(Math.trunc(v)) : 'auto'
}

export interface CapRecord {
  path: string
  window: number
  prior: number | null
  created: boolean
  /** This session's Remote Control id, resolved at ARM time — the Stop hook's env may lack it. */
  cse?: string
}

/**
 * Evidence that THE HOLD — not the user — is why `WINDOW_KEY` already equals the cap, and what was in
 * the file before the hold first put it there.
 *
 * A cap left behind by a hold that was re-armed or whose release was skipped is indistinguishable,
 * by value alone, from a setting the user chose. Observed 2026-09-25: arming in
 * /home/eh/projects/hidden-figures recorded prior=250000, and the release then "restored" 250000 as
 * though it were the user's, which blocked `/autocompact auto`.
 *
 * Two sources, both already on disk and neither a new file: a LIVE state object still holding a
 * CapRecord for this path and window, and the `capped` lines the hold appends to its own per-session
 * ledgers. The live record wins — it is the hold that still owns the key.
 */
export function capProvenance(path: string, window: number, dir?: string): CapRecord | null {
  const d = dir || process.env.TMPDIR || tmpdir()
  let names: string[]
  try {
    names = readdirSync(d)
  } catch {
    return null
  }
  let fromLedger: CapRecord | null = null
  for (const name of names.sort()) {
    if (!name.startsWith('work-hold-')) continue
    const full = join(d, name)
    if (name.endsWith('.json')) {
      try {
        const c = (JSON.parse(readFileSync(full, 'utf8')) as State).compact
        if (c && c.path === path && c.window === window) return c
      } catch {
        /* an unreadable state file is not evidence */
      }
    } else if (name.endsWith('.releases.log')) {
      try {
        for (const line of readFileSync(full, 'utf8').split('\n')) {
          const [, verb, json] = line.split('\t')
          if (verb?.trim() !== 'capped' || !json) continue
          const c = JSON.parse(json) as CapRecord
          if (c?.path === path && c.window === window) fromLedger = c
        }
      } catch {
        /* an unreadable ledger is not evidence */
      }
    }
  }
  return fromLedger
}

/**
 * Put the cap in the local file, preserving every other key and its order.
 *
 * When the key is ALREADY the cap value, `prior` is only believable if the hold did not write it — so
 * `provenance` (from `capProvenance`) carries the earlier record's prior forward instead. With no
 * provenance the old behaviour stands and the cap value is recorded as the prior: a value that is
 * there for a reason nobody can establish is treated as the user's, which is the safe direction.
 */
export function writeLocalCap(path: string, window: number, provenance?: CapRecord | null): CapRecord {
  const created = !existsSync(path)
  const cur = readSettings(path) ?? {}
  const p = cur[WINDOW_KEY]
  let prior = typeof p === 'number' && Number.isFinite(p) ? Math.trunc(p) : null
  let createdOut = created
  if (prior === window && provenance) {
    prior = provenance.prior
    createdOut = created || provenance.created
  }
  cur[WINDOW_KEY] = window
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(cur, null, 2) + '\n')
  return { path, window, prior, created: createdOut }
}

/**
 * Undo `writeLocalCap` — but only if the key is still OURS.
 *
 * Someone editing the window mid-run is expressing a preference; overwriting it with a value from
 * before the hold would silently discard that. Never throws: a release must not fail on a file.
 */
export function restoreLocal(rec: CapRecord): void {
  try {
    const cur = readSettings(rec.path)
    if (!cur) return
    if (cur[WINDOW_KEY] !== rec.window) return
    if (rec.prior === null) delete cur[WINDOW_KEY]
    else cur[WINDOW_KEY] = rec.prior
    if (rec.created && Object.keys(cur).length === 0) {
      rmSync(rec.path, { force: true })
      return
    }
    writeFileSync(rec.path, JSON.stringify(cur, null, 2) + '\n')
  } catch {
    /* a release must not fail on a settings file */
  }
}

/** This session's own Herdr pane, matched on the agent session id. Null rather than throwing. */
export function selfPane(session: string): string | null {
  try {
    const r = spawnSync(process.env.WORK_HOLD_HERDR || 'herdr', ['agent', 'list'], {
      encoding: 'utf8',
      timeout: 20_000,
    })
    if (r.error || r.status !== 0 || !r.stdout) return null
    const agents = JSON.parse(r.stdout)?.result?.agents
    if (!Array.isArray(agents)) return null
    for (const a of agents) if (a?.agent_session?.value === session) return a?.pane_id ?? null
    return null
  } catch {
    return null
  }
}

/** This session's Remote Control id, which is its bridge session id with the prefix swapped. */
export function selfCse(): string | null {
  const bridge = process.env.CLAUDE_CODE_BRIDGE_SESSION_ID
  return bridge ? bridge.replace(/^session_/, 'cse_') : null
}

// The user permissions.ask matches any Bash command naming a work-hold-*.json path, so a cat of the
// state prompts them; the Read tool and --status do not. BRIEF ONLY — a block message repeats every
// round, and the path does not change, so it is noise there and orientation here.
const stateRef = (path: string) => `(state: ${path} — inspect it with the Read tool, Read(file_path: "${path}"), or \`work-hold.sh --status\`; never name this path in a Bash command, which prompts the user)`

/**
 * The standing authority and the continuation rule — ONCE PER HOLD, on the first counted block.
 *
 * compose-goal.sh put them in the goal because the goal was "the one text it re-reads every turn",
 * and the hold inherited that by printing them on every block. They are long, identical each round, and
 * already on disk: `--brief` re-injects them at SessionStart, which is the one moment the session
 * has actually lost them. `first` is derived from the round counter, so it records no new state.
 */
const clausesFor = (s: State, first: boolean): string =>
  first
    ? [s.authority, s.continuation, redispatchLine(s)].filter(Boolean).join(' ')
    : redispatchBlocked(s)

/**
 * How to advance a WATCHED run after a failed round — or '' when this hold watches none.
 *
 * A session that reads "the round failed" reaches for `work-dispatch.sh`, which re-runs every task;
 * `work-redispatch.sh` re-runs only the tasks that flagged plus their transitive dependents and
 * carries the rest, so it is the only advance that does not throw away a round's verified work.
 * Derived from `s.run` and the plan path already recorded in that run's args.json — no new state.
 */
export function redispatchLine(s: { run?: string }): string {
  if (!s.run) return ''
  let plan = '<plan.md>'
  try {
    const a = JSON.parse(readFileSync(join(s.run, 'args.json'), 'utf8'))
    if (typeof a.planPath === 'string' && a.planPath) plan = a.planPath
  } catch {
    /* the args are the run's, not the hold's: an unreadable one costs the placeholder, not the line */
  }
  const blocked = redispatchBlocked(s)
  if (blocked) return blocked
  return (
    `After a failed round, advance it with \`work-redispatch.sh ${plan} ${join(s.run, 'args.json')} --dispatch\`, ` +
    'which re-runs only the tasks that flagged and their dependents and carries the rest — not a fresh ' +
    'work-dispatch.sh, which re-runs every task.'
  )
}

/**
 * work-redispatch.sh's Tier 1 refusal, computed rather than remembered: the last verdict routed items
 * to the PLAN, NO failure is routed to a task (a task-routed fix runs beside plan items and carries
 * them), and the plan's spec hash still equals the run's — so `--dispatch` exits 3 and spends nothing.
 * Telling the session to redispatch there is telling it to hit a wall (secreg 2026-10-02). Returns
 * what blocks instead, or ''. Mirrors the gate in work-redispatch.sh; tests/work-hold-judge-facts
 * runs the script itself on the same fixtures so the two cannot drift apart unnoticed. Recomputed
 * each time, so amending the plan (a new hash) lifts it with no record of ours.
 */
export function redispatchBlocked(s: { run?: string }): string {
  if (!s.run) return ''
  try {
    const a = JSON.parse(readFileSync(join(s.run, 'args.json'), 'utf8'))
    const raw = JSON.parse(readFileSync(join(s.run, 'result.json'), 'utf8'))
    const r = Array.isArray(raw) ? raw[raw.length - 1] : raw
    const items = Array.isArray(r?.planFindings) ? r.planFindings : []
    if (!items.length || typeof a.planPath !== 'string' || typeof a.specHash !== 'string') return ''
    const tasks = new Set((Array.isArray(a.tasks) ? a.tasks : []).map((t: any) => t?.id))
    const owner = (x: any) => (typeof x?.ownerTask === 'string' ? x.ownerTask.trim() : '')
    const blocking = (Array.isArray(r.findings) ? r.findings : []).filter((f: any) => ['critical', 'major'].includes(f?.severity))
    if ([...(Array.isArray(r.routes) ? r.routes : []), ...blocking].some((x: any) => tasks.has(owner(x)))) return ''
    const script = process.env.WORK_HOLD_DISPATCH || join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'work-dispatch.sh')
    const h = spawnSync('bash', [script, '--spec-hash', a.planPath], { encoding: 'utf8', timeout: 20_000 })
    if (h.status !== 0 || (h.stdout || '').trim() !== a.specHash) return ''
    const named = items
      .slice(0, 5)
      .map((x: any) => (typeof x === 'string' ? x : x?.failure || x?.title || x?.id || '(unlabelled)'))
      .join('; ')
    const pathless = items.some((x: any) => !x?.file)
    return (
      `Do NOT redispatch: work-redispatch.sh refuses this run at its Tier 1 gate — ${items.length} item(s) ` +
      `in the last verdict are routed to the PLAN (${named}), none to a task, and ${a.planPath} is ` +
      `unchanged since it was dispatched. What blocks is the plan: amend it (${pathless
        ? "reword the acceptance, redCommand or mechanical check each item cites"
        : "add the path to a task's writablePaths, or reword the item"}), or take these items to the ` +
      `user; only then is a redispatch possible.`
    )
  } catch {
    return ''
  }
}

const agentMsgBin = () => process.env.WORK_HOLD_AGENT_MSG || 'agent-msg'

/** The Remote Control target, but only when the id AND the binary are both there. */
function agentMsgTarget(cse?: string | null): string | null {
  const target = cse ?? selfCse()
  if (!target) return null
  const r = spawnSync(agentMsgBin(), ['--help'], { encoding: 'utf8', timeout: 10_000 })
  return r.error ? null : target
}

/** Whether `applyWindow` has any way into the running session at all. */
export function hasTransport(session: string, cse?: string | null): boolean {
  return agentMsgTarget(cse) !== null || selfPane(session) !== null
}

/**
 * Make the running session re-read its merged settings, without changing the global file.
 *
 * `agent-msg send --as-user` delivers real user input over Remote Control and the slash command
 * executes mid-turn, so it is preferred: it needs no multiplexer and no idle pane. Herdr is the
 * fallback for sessions with no bridge id, and for an agent-msg that refuses.
 *
 * The sleep is for the settings watcher: the file write and the command must not race, or the
 * session re-reads settings from before the cap landed.
 */
export function applyWindow(session: string, cse?: string | null): string {
  try {
    const target = agentMsgTarget(cse)
    const pane = target ? null : selfPane(session)
    if (!target && !pane) return 'no transport into this session; window unchanged'
    const settle = Number(process.env.WORK_HOLD_SETTLE_MS ?? 2000)
    if (settle > 0) spawnSync('sleep', [String(settle / 1000)])
    // NEVER a bare `/autocompact` — with no argument it opens an interactive picker.
    const arg = globalArg()
    if (target) {
      const r = spawnSync(agentMsgBin(), ['send', '--as-user', target, `/autocompact ${arg}`], {
        encoding: 'utf8',
        timeout: 20_000,
      })
      if (!r.error && r.status === 0) return 'ok:agent-msg'
    }
    const p = pane ?? selfPane(session)
    if (!p) return 'agent-msg refused the /autocompact send and there is no pane; window unchanged'
    const r = spawnSync(
      process.env.WORK_HOLD_HERDR || 'herdr',
      ['agent', 'prompt', p, `/autocompact ${arg}`],
      { encoding: 'utf8', timeout: 20_000 },
    )
    if (r.error || r.status !== 0) return 'herdr refused the /autocompact send; window unchanged'
    return 'ok:herdr'
  } catch {
    return 'window unchanged (unexpected error)'
  }
}

function capCli(): void {
  const say = (m: string) => process.stdout.write(`  window:  ${m}\n`)
  const session = process.env.CLAUDE_CODE_SESSION_ID || ''
  if (!session) return say('no CLAUDE_CODE_SESSION_ID; not capped')
  const path = statePath(session)
  if (!existsSync(path)) return say('no armed hold; not capped')

  if (process.env.WORK_HOLD_COMPACT_WINDOW === '0') return say('WORK_HOLD_COMPACT_WINDOW=0; not capped')
  if (process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW)
    return say('CLAUDE_CODE_AUTO_COMPACT_WINDOW is set; it wins and /autocompact refuses. Not capped')
  // THE PROJECT TREE IS NOT HOLD STATE. The cap's only live path is the project's own settings file,
  // and a hold writes nothing in a project unless asked to — secreg 2026-10-03, every arm wrote
  // `autoCompactWindow` into a course tree other sessions treat as read-only.
  if (!process.env.WORK_HOLD_COMPACT_WINDOW)
    return say(
      `not capped — the only live cap is ${localSettingsPath()}, and a hold writes nothing in a ` +
        'project tree. To cap anyway: WORK_HOLD_COMPACT_WINDOW=250000 at arm time (writes that file, ' +
        'restored at release), or `/autocompact 250000` yourself (writes your global settings)',
    )

  let s: State
  try {
    s = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return say('state unreadable; not capped')
  }

  const local = localSettingsPath()
  const cse = selfCse()
  if (!hasTransport(session, cse))
    return say(
      `no agent-msg id and no Herdr pane for this session; add "${WINDOW_KEY}": 250000 to ` +
        `${local} and run \`/autocompact auto\` yourself. Not capped`,
    )

  const raw = Number(process.env.WORK_HOLD_COMPACT_WINDOW)
  const window = Math.min(1_000_000, Math.max(100_000, Number.isFinite(raw) ? raw : 250_000))

  s.compact = writeLocalCap(local, window, capProvenance(local, window))
  if (cse) s.compact.cse = cse
  writeFileSync(path, JSON.stringify(s))
  // The cap record, in the ledger that already sits beside the state file — so a LATER arm can tell
  // a cap the hold left behind from a window the user chose, even after this state file is gone.
  appendFileSync(ledgerPath(session), `${new Date().toISOString()}\tcapped\t${JSON.stringify(s.compact)}\n`)

  const status = applyWindow(session, cse)
  say(
    status.startsWith('ok:')
      ? `capped at ${window} for this session via ${local} over ${status.slice(3)}; ` +
        'global settings untouched'
      : `cap written to ${local} at ${window}, but not applied live: ${status}`,
  )
}

/** Put the window back. Shared by `--uncap` and by every release inside the Stop hook. */
function uncap(session: string, s: State | null): string | null {
  if (!s?.compact) return null
  restoreLocal(s.compact)
  return applyWindow(session, s.compact.cse)
}

function uncapCli(): void {
  const session = process.env.CLAUDE_CODE_SESSION_ID || ''
  if (!session) return
  let s: State | null = null
  try {
    s = JSON.parse(readFileSync(statePath(session), 'utf8'))
  } catch {
    return
  }
  const status = uncap(session, s)
  if (status) process.stdout.write(`  window:  restored (${status})\n`)
}

function main(): void {
  const payload = JSON.parse(readFileSync(0, 'utf8') || '{}')

  // Blocking a stop causes another stop. Without this the session can never end.
  if (payload.stop_hook_active === true) process.exit(0)

  const session = payload.session_id || process.env.CLAUDE_CODE_SESSION_ID || ''
  if (!session) process.exit(0)
  const path = statePath(session)
  const ledger = ledgerPath(session)

  if (!existsSync(path)) {
    // Gone. Was it one of the sanctioned exits, or did someone delete it?
    const entry = lastLedgerEntry(ledger)
    // never armed, or properly released: inert
    if (!entry || !entry.verb.startsWith('armed')) process.exit(0)
    const json = entry?.payload ?? ''
    try {
      const restored = JSON.parse(json) as State
      // Stamped like every other path: the ledger payload is the ARM-time state, so a restore that
      // carried it back verbatim would reinstate a hold that reads as never evaluated.
      restored.lastEvaluatedAt = Math.floor(Date.now() / 1000)
      writeFileSync(path, JSON.stringify(restored))
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: `the hold on \`${restored.check}\` was removed without a user-confirmed --disarm; it has been restored. Release needs the user to confirm at a terminal, or the check to pass.`,
      }))
      process.exit(0)
    } catch {
      process.exit(0)                             // unparseable ledger: do not invent a hold
    }
  }

  let s: State
  try {
    s = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // An unreadable state file is a hold nobody can reason about; drop it rather than hold
    // the session on terms that cannot be read. No cap record survives it, so nothing to restore.
    rmSync(path, { force: true })
    process.exit(0)
  }

  const now = Math.floor(Date.now() / 1000)
  const checkless = !s.check?.trim()

  // THE LIVENESS STAMP, before any branch. Written here rather than once per exit because every exit
  // below is a Stop this file processed — the in-flight allow, the block, and each release — and a
  // stamp attached to only some of them would make the quietest path look like the dead hook. It
  // costs one write per Stop, on a file this hook already rewrites on most of them.
  // A HELD RUN THAT DIED is dropped here, ONCE: it leaves the state, so no later Stop sees it again.
  // The ledger gets `run died` and then `armed (pruned)` with what is left, so deleting the file still
  // restores the remaining holds; with none left it is a release, and the ledger's last word says so.
  const died = [s, ...(s.queued ?? [])]
    .map(h => ({ run: h.run || '', why: runDied(h, session) }))
    .filter((d): d is { run: string; why: string } => d.why !== null)
  if (died.length) {
    let left: State | null = s
    for (const d of died) left = left ? dropRun(left, d.run).state : null
    const at = new Date().toISOString()
    for (const d of died) appendFileSync(ledger, `${at}\t${RUN_DIED}\t${d.run}\t${d.why}\n`)
    deadNote =
      died.map(d => `hold: dropped ${d.run} — the run died without a verdict: ${d.why}.`).join('\n') +
      ' Nothing holds this session on it; redispatch it if it is still wanted, or tell the user it died.'
    if (!left) {
      uncap(session, s)
      rmSync(path, { force: true })
      allowStop()
    }
    appendFileSync(ledger, `${at}\tarmed (pruned)\t${JSON.stringify(left)}\n`)
    s = left!
  }

  s = activeHold(s)
  s.lastEvaluatedAt = now
  // A watched run's rounds are the ones it DISPATCHED, read from its args.json — never this Stop.
  const dispatched = runRounds(s)
  if (dispatched !== null) s.rounds = dispatched
  writeFileSync(path, JSON.stringify(s))
  // The first block: round 0 for a hold counting its own Stops; for a watched run, whose counter is
  // already past 0 when its first verdict lands, the first block with no round recorded.
  const firstBlock = () => (dispatched === null ? s.rounds === 0 : !(s.history ?? []).length)
  const countRound = () => { if (dispatched === null) s.rounds += 1 }

  /**
   * Every release goes through here: ledger line, window restored, state gone, one message. With
   * other holds queued the next is promoted instead, the window stays capped, and the ledger gets an
   * `armed` line for it, so deleting the file still restores the hold rather than escaping it.
   */
  const release = (verb: string, message: string): void => {
    appendFileSync(ledger, `${new Date().toISOString()}\t${verb}\t${s.check || s.goal || ''}\n`)
    if (s.queued?.length) {
      const next = nextHold(s)
      // Promoted holds keep their own clock; the liveness stamp is the container's.
      next.lastEvaluatedAt = now
      writeFileSync(path, JSON.stringify(next))
      appendFileSync(ledger, `${new Date().toISOString()}\tarmed (promoted)\t${JSON.stringify(next)}\n`)
      process.stderr.write(
        `hold: ${message} ${next.queued!.length + 1} other hold(s) still armed — next: ` +
          `${next.run || next.check || next.goal}.\n`,
      )
      allowStop()
    }
    uncap(session, s)
    rmSync(path, { force: true })
    const moved = rubricDrift(s)
    process.stderr.write(
      `hold: ${message}` +
        (moved.length
          ? ` The check's own files changed while armed (${moved.join(', ')}) — the objective moved during the hold, so say what it says now.`
          : '') +
        '\n',
    )
    allowStop()
  }

  /** Block, count the round, and record what refused it. */
  const block = (reason: string, note: string): void => {
    const first = firstBlock()
    countRound()
    pushRound(s, { round: s.rounds, at: now, exit: 0, note })
    writeFileSync(path, JSON.stringify(s))
    const clauses = clausesFor(s, first)
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: noted(reason + (clauses ? `\n${clauses}` : '')),
    }))
    process.exit(0)
  }

  // (a0) AN AFK HOLD WITH NO --run: the session's own farm/work/grind runs are the work, and the
  // watcher wakes the session when they land. Forcing a round here would only invent busy-work, so
  // allow the stop and count nothing (the clock still runs). Same rule early-stop.ts applies.
  // With no check either, the goal is the afk mandate's prose, which no judge can decide (hidden-figures
  // 2026-10-08: 42 blocks at 1-53%, each one wasted turn). The judge is never asked, no round counts,
  // and the ceiling clock is the only release; early-stop.ts speaks for such a hold instead.
  if ((s.origin === 'afk' || s.origin === 'overnight') && !s.run) {
    const live = liveOwnedRuns(session)
    if ((live.length && watcherActive(session)) || checkless) {
      const c = ceilingReached({ ...s, rounds: 0 }, now)
      if (c)
        release(
          'expired',
          `${c}${live.length ? ', with owned runs still live' : ''}. Hold released UNMET — say so. ${HEARTBEAT_NOTE}`,
        )
      allowStop()
    }
  }

  // (a) THE RUN IS IN FLIGHT: allow the stop, count nothing. A round is being worked by a detached
  // process, so there is nothing for this session to do and nothing a block would achieve — AGK
  // 2026-09-27, 14 wakes inside one round. The CLOCK still runs: an in-flight run is not a licence
  // to outlive the ceiling, so an expired hold releases here rather than waiting for a verdict that
  // may never come.
  if (inFlight(s)) {
    // The CLOCK only: the round in flight is already in the dispatched count, so the round ceiling
    // would expire a hold on the very round it is waiting for.
    const c = ceilingReached(dispatched === null ? s : { ...s, rounds: 0 }, now)
    if (c)
      release(
        'expired',
        `${c}, with the run still in flight. Hold released UNMET — say so. ${HEARTBEAT_NOTE}`,
      )
    allowStop()
  }

  // (b) A READ-ONLY RUN REACHED ITS VERDICT: PASS or FAIL is its answer, and the loop has stopped
  // because no round can change it. Asking the judge here would hold the session for a round that
  // never comes — secreg 2026-10-02, a readOnly "reach a verdict" run held after its FAIL.
  const verdict = verdictReached(s)
  if (verdict)
    release(
      VERDICT_REACHED,
      `the read-only run ${s.run} reached its verdict (${verdict}) — hold released. Report that ` +
        `verdict and what it found; fixing it is a separate writing run. ${HEARTBEAT_NOTE}`,
    )

  const exit = checkless
    ? 0
    : (spawnSync('bash', ['-lc', s.check], { encoding: 'utf8', timeout: 900_000 }).status ?? 2)
  const d: { action: 'pass' | 'block' | 'expired'; reason?: string } =
    checkless ? { action: 'pass' } : decide(s, exit, now)

  // (c) THE CHECK IS THE FLOOR, THE GOAL IS THE OBJECTIVE — and on a check-less hold the goal is the
  // whole of it. Jev is asked the same question either way: is the goal met AND is nothing obvious
  // left open. A green check with a met goal is the only release that says the objective closed.
  if (d.action === 'pass') {
    // The classifier's own words when it said MET; null means nobody confirmed the goal.
    let judged: string | null = null
    if (s.goal) {
      const j = judgeGoal(String(payload.transcript_path || ''), s.goal, s.check, s.history, s.run)
      if (j.verdict === 'UNMET') {
        // (d) The ceilings bind here too. A judge that keeps answering UNMET over a green check is a
        // hold with no clock unless this is asked before the block.
        const c = ceilingReached(s, now)
        if (c)
          release(
            'expired',
            `${c}, with the goal last judged NOT met (${j.reason}). Hold released UNMET — say so. ` +
              HEARTBEAT_NOTE,
          )
        block(
          (checkless
            ? `hold: the goal is judged NOT met: ${j.reason}`
            : `hold: \`${s.check}\` exits 0 but the goal is judged NOT met: ${j.reason}`) +
            `\nGoal: ${s.goal}\n${roundLabel(s)}.`,
          `judge UNMET: ${j.reason}`,
        )
      }
      if (j.verdict === 'UNAVAILABLE') {
        // A check-ful hold FAILS OPEN — the check is real evidence and a hook that traps a session
        // because a model was unreachable is worse than one that lets a turn end. A CHECK-LESS hold
        // has no other evidence at all, so failing open there would release on nothing; it blocks
        // instead, bounded by the same ceilings.
        if (checkless) {
          const c = ceilingReached(s, now)
          if (c)
            release(
              'expired',
              `${c}, with the goal never judged (${j.reason}). Hold released UNMET — say so. ` +
                HEARTBEAT_NOTE,
            )
          block(
            `hold: judge unavailable (${j.reason}), and this hold has no check — nothing has ` +
              `confirmed the goal, so the session keeps working.\nGoal: ${s.goal}\n` +
              `${roundLabel(s)}.`,
            `judge unavailable: ${j.reason}`,
          )
        }
        process.stderr.write(`hold: goal judge unavailable (${j.reason}); releasing on the check alone.\n`)
      }
      if (j.verdict === 'MET') judged = j.reason
    }
    // TWO VERBS, because a release says two different things. PASSED_GOAL_MET is the classifier
    // agreeing the goal is met; PASSED_UNJUDGED is the check alone, with nobody having confirmed
    // the objective.
    if (judged === null)
      release(
        PASSED_UNJUDGED,
        `\`${s.check}\` exits 0 — hold released, but the GOAL IS NOT CONFIRMED` +
          `${s.goal ? '' : ' (no goal was armed)'}: no classifier verdict, so a green check is all ` +
          `that happened. Do NOT end the heartbeat with CronDelete; it must stay until the goal is ` +
          `judged met.`,
      )
    release(
      PASSED_GOAL_MET,
      (checkless ? `the classifier judged the goal MET (${judged})` : `\`${s.check}\` exits 0 and the classifier judged the goal MET (${judged})`) +
        ` — the run's objective met, hold released. ` + HEARTBEAT_NOTE,
    )
  }
  // (d) A ceiling on a red check: released, and the verdict is UNMET.
  if (d.action === 'expired')
    release(
      'expired',
      `${d.reason}. Hold released UNMET — say so. ${HEARTBEAT_NOTE}`,
    )

  const firstB = firstBlock()
  countRound()
  pushRound(s, { round: s.rounds, at: now, exit })
  writeFileSync(path, JSON.stringify(s))
  const movedB = rubricDrift(s)
  const goalB = s.goal ? `\nGoal: ${s.goal}` : ''
  const clausesB = clausesFor(s, firstB)
  const noteB = movedB.length
    ? `\nThe check's own files changed since it was armed (${movedB.join(', ')}): that is the objective moving, not the work — justify it on the line or restore them.`
    : ''
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: noted(`hold: ${d.reason}${goalB}${noteB}${clausesB ? `\n${clausesB}` : ''}`),
  }))
  process.exit(0)
}

/**
 * SessionStart entry: put the hold back in context after the harness has taken it out.
 *
 * Compaction, `/clear` and a resume all leave the session with a context that no longer contains
 * the goal, the budget, or what the earlier rounds tried -- while the hold itself is untouched,
 * because it lives in a file. The Stop hook restates the goal, but only once the session stops, so
 * a whole round can be spent working on a reconstruction. Everything printed here is READ from the
 * state file; nothing is recorded for it, and it is silent on a session that is not armed.
 */
function brief(): void {
  const payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
  const session = payload.session_id || process.env.CLAUDE_CODE_SESSION_ID || ''
  if (!session) process.exit(0)
  const path = statePath(session)
  if (!existsSync(path)) process.exit(0)
  let s: State
  try {
    s = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    process.exit(0)
  }

  const left = s.ceilingMinutes - Math.floor((Date.now() / 1000 - s.startedAt) / 60)
  // LAST FIVE ONLY. Every heartbeat tick re-enters this brief, so the record is paid for again on
  // each one; the state keeps 20 rounds for the judge, but what a session needs on re-entry is what
  // the recent rounds tried, not the whole run.
  const rounds = renderHistory((s.history ?? []).slice(-5))
  const out = [
    '# WORK HOLD — this session is under an armed hold',
    `Read this hold rather than remembering it — the context it was in has just been summarised or cleared. ${stateRef(path)}`,
    s.goal ? `GOAL: ${s.goal}` : '',
    s.check
      ? `CHECK: \`${s.check}\` — the hold releases when this exits 0${s.goal ? ' AND an independent judge agrees the goal is met' : ''}.`
      : 'CHECK: none — this hold is the judge alone on the goal above.',
    // The run, and whether a round is in flight: while it is, a stop is ALLOWED and costs no round,
    // so a session that reads this knows the block it did not get was not a bug.
    s.run
      ? `RUN: ${s.run} — ${runDied(s, session) ? 'DIED without a verdict (the next Stop drops this hold)' : inFlight(s) ? 'IN FLIGHT (a stop is allowed and counts no round; the clock still runs)' : 'not in flight (a verdict is on disk)'}`
      : '',
    `BUDGET: ${runRounds(s) ?? s.rounds} of ${s.maxRounds} rounds ${runRounds(s) === null ? 'used' : 'dispatched'}; ${left} min left of the ${s.ceilingMinutes} min ceiling.`,
    ...(s.queued ?? []).map(q =>
      `ALSO HELD: ${q.run || q.check || q.goal} — ${runDied(q, session) ? 'DIED without a verdict (the next Stop drops it)' : q.run && inFlight(q) ? 'in flight' : 'evaluated once this hold releases or goes in flight'}.`),
    [s.authority, s.continuation, redispatchLine(s)].filter(Boolean).join(' '),
    rounds ? `ROUNDS SO FAR — do not repeat these:\n${rounds}` : '',
  ].filter(Boolean)
  process.stdout.write(out.join('\n') + '\n')
  process.exit(0)
}

/**
 * `--drop-run DIR`: release only the hold watching DIR — work-abandon.sh's half. Prints `released`
 * when no hold is left (the caller then restores the window and removes the state), `kept` when other
 * holds remain, `absent` when no hold watches DIR.
 */
function dropRunCli(): void {
  const session = process.env.CLAUDE_CODE_SESSION_ID || ''
  const run = process.argv[process.argv.indexOf('--drop-run') + 1] || ''
  let s: State
  try {
    s = JSON.parse(readFileSync(statePath(session), 'utf8'))
  } catch {
    process.stdout.write('absent\n')
    return
  }
  const d = dropRun(s, run)
  if (!d.dropped) return void process.stdout.write('absent\n')
  if (d.state) {
    writeFileSync(statePath(session), JSON.stringify(d.state))
    appendFileSync(ledgerPath(session), `${new Date().toISOString()}\tarmed (remaining)\t${JSON.stringify(d.state)}\n`)
    return void process.stdout.write('kept\n')
  }
  process.stdout.write('released\n')
}

if (import.meta.main)
  (process.argv.includes('--drop-run')
    ? dropRunCli
    : process.argv.includes('--brief')
    ? brief
    : process.argv.includes('--cap')
      ? capCli
      : process.argv.includes('--uncap')
        ? uncapCli
        : main)()
