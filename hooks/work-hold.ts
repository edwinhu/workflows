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

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { holdStateName } from './guards/hold.ts'

interface State {
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

/** Swap queued hold `i` to the top. The container fields (compact, queued) stay with the top. */
export function promote(s: State, i: number): State {
  const q = [...(s.queued ?? [])]
  const [next] = q.splice(i, 1)
  const { queued: _q, compact, ...prev } = s
  return { ...next, queued: [...q, prev as State], compact }
}

/** Drop the top hold and promote the first queued one. */
export function nextHold(s: State): State {
  const [next, ...rest] = s.queued ?? []
  return { ...next, queued: rest, compact: s.compact }
}

/**
 * The hold this Stop is about: the top one unless its run is in flight while a queued one's is not.
 * A run in flight is being worked elsewhere; a held run with its verdict in is the session's work.
 */
export function activeHold(s: State): State {
  if (!s.queued?.length || !inFlight(s)) return s
  const i = s.queued.findIndex(q => !inFlight(q))
  return i < 0 ? s : promote(s, i)
}

/** Remove the hold watching `run` from the container; null when no hold is left. */
export function dropRun(s: State, run: string): { state: State | null; dropped: boolean } {
  const all = [s, ...(s.queued ?? [])]
  const keep = all.filter(h => h.run !== run)
  if (keep.length === all.length) return { state: s, dropped: false }
  if (!keep.length) return { state: null, dropped: true }
  const [top, ...rest] = keep.map(({ queued: _q, compact: _c, ...h }) => h as State)
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

/** The verb `work-abandon.sh` appends when the USER retires a run. */
export const ABANDONED = 'abandoned by user'

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
      `\`${s.check}\` exits ${checkExit} — not met. Round ${s.rounds + 1}/${s.maxRounds}, ` +
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
    return p >= threshold
      ? { verdict: 'MET', reason: `judge put the goal met at ${pct}% (threshold ${Math.round(threshold * 100)}%)` }
      : { verdict: 'UNMET', reason: `judge put the goal met at only ${pct}% (threshold ${Math.round(threshold * 100)}%)` }
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
export function decisionsCall(
  state: string,
  questions: Record<string, { type: string; instructions: string; criteria?: Record<string, string> }>,
  opts: { maxTimeSeconds?: number; model?: string } = {},
): { stdout: string; unavailable: null } | { stdout: null; unavailable: string } {
  const url = process.env.WORK_HOLD_DECISIONS_URL || 'https://openrouter.ai/api/alpha/decisions'
  const model = opts.model || process.env.WORK_HOLD_DECISIONS_MODEL || 'typesafe/jev-1.13'
  const maxTime =
    typeof opts.maxTimeSeconds === 'number' && Number.isFinite(opts.maxTimeSeconds) && opts.maxTimeSeconds > 0
      ? opts.maxTimeSeconds
      : 60

  let token = process.env.WORK_HOLD_JUDGE_TOKEN || ''
  if (!token) {
    const runtime = process.env.XDG_RUNTIME_DIR || '/run/user/1000'
    try {
      token = readFileSync(`${runtime}/agenix/openrouter-api-key`, 'utf8').trim()
    } catch {
      return { stdout: null, unavailable: 'no openrouter key (agenix secret not present)' }
    }
  }
  if (!token) return { stdout: null, unavailable: 'empty openrouter key' }

  const r = spawnSync(
    'curl',
    ['-sS', '--max-time', String(maxTime), '-X', 'POST', url,
     '-H', `Authorization: Bearer ${token}`,
     '-H', 'Content-Type: application/json',
     '--data-binary', '@-'],
    // The spawn timeout is a backstop 30 s behind curl's own cap: 90 s at the default 60.
    { encoding: 'utf8', input: JSON.stringify({ state, model, questions }), timeout: (maxTime + 30) * 1000 },
  )
  if (r.error || r.status !== 0) return { stdout: null, unavailable: 'decisions endpoint unreachable' }
  return { stdout: r.stdout || '', unavailable: null }
}

function judgeViaDecisions(
  state: string,
  goal: string,
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
      type: 'noul',
      instructions:
        `This goal is met AND no obvious open work remains that the session should do next: ${goal}`,
    },
  })
  if (r.stdout === null) return { verdict: 'UNAVAILABLE', reason: r.unavailable }
  return parseNoul(r.stdout, 'met', threshold)
}

function judgeGoal(
  transcriptPath: string,
  goal: string,
  check: string,
  history?: RoundRecord[],
): { verdict: 'MET' | 'UNMET' | 'UNAVAILABLE'; reason: string } {
  // The verdict is ONE WORD, so the model does almost no work -- the cost is what we send it.
  // Sending 12000 characters of transcript to get back "MET" is paying for input to produce a bit.
  // 4000 covers the recent turns a verdict rests on, and the compaction summary covers the run they
  // sit in; both are overridable when a goal needs more.
  const TAIL_CHARS = Number(process.env.WORK_HOLD_JUDGE_TAIL_CHARS || 4000)
  const SUMMARY_CHARS = Number(process.env.WORK_HOLD_JUDGE_SUMMARY_CHARS || 3000)
  let ctx: { summary: string; tail: string }
  try {
    ctx = transcriptContext(readFileSync(transcriptPath, 'utf8'), TAIL_CHARS, SUMMARY_CHARS)
  } catch {
    return { verdict: 'UNAVAILABLE', reason: 'no readable transcript' }
  }
  if (!ctx.tail.trim() && !ctx.summary.trim())
    return { verdict: 'UNAVAILABLE', reason: 'empty transcript' }

  const rounds = renderHistory(history)
  const evidence = [
    ctx.summary &&
      `EARLIER IN THIS RUN — the session's own compaction summary of turns since dropped from its context:\n${ctx.summary}`,
    rounds && `WHAT THE HOLD RECORDED, round by round:\n${rounds}`,
    ctx.tail && `MOST RECENT TURNS:\n${ctx.tail}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const prompt =
    `You are judging whether a coding session has MET its stated goal AND has no obvious open work ` +
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
  const decided = judgeViaDecisions(evidence, goal)
  if (decided.verdict !== 'UNAVAILABLE') return decided

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
  first ? [s.authority, s.continuation, redispatchLine(s)].filter(Boolean).join(' ') : ''

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
  return (
    `After a failed round, advance it with \`work-redispatch.sh ${plan} ${join(s.run, 'args.json')} --dispatch\`, ` +
    'which re-runs only the tasks that flagged and their dependents and carries the rest — not a fresh ' +
    'work-dispatch.sh, which re-runs every task.'
  )
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

  const raw = Number(process.env.WORK_HOLD_COMPACT_WINDOW || 250_000)
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
  s = activeHold(s)
  s.lastEvaluatedAt = now
  writeFileSync(path, JSON.stringify(s))

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
      process.exit(0)
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
    process.exit(0)
  }

  /** Block, count the round, and record what refused it. */
  const block = (reason: string, note: string): void => {
    const first = s.rounds === 0
    s.rounds += 1
    pushRound(s, { round: s.rounds, at: now, exit: 0, note })
    writeFileSync(path, JSON.stringify(s))
    const clauses = clausesFor(s, first)
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: reason + (clauses ? `\n${clauses}` : ''),
    }))
    process.exit(0)
  }

  // (a) THE RUN IS IN FLIGHT: allow the stop, count nothing. A round is being worked by a detached
  // process, so there is nothing for this session to do and nothing a block would achieve — AGK
  // 2026-09-27, 14 wakes inside one round. The CLOCK still runs: an in-flight run is not a licence
  // to outlive the ceiling, so an expired hold releases here rather than waiting for a verdict that
  // may never come.
  if (inFlight(s)) {
    const c = ceilingReached(s, now)
    if (c)
      release(
        'expired',
        `${c}, with the run still in flight. Hold released UNMET — say so, and if a heartbeat cron ` +
          `exists, end it with CronDelete now: a cron outlives the work and nothing else can end it.`,
      )
    process.exit(0)
  }

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
      const j = judgeGoal(String(payload.transcript_path || ''), s.goal, s.check, s.history)
      if (j.verdict === 'UNMET') {
        // (d) The ceilings bind here too. A judge that keeps answering UNMET over a green check is a
        // hold with no clock unless this is asked before the block.
        const c = ceilingReached(s, now)
        if (c)
          release(
            'expired',
            `${c}, with the goal last judged NOT met (${j.reason}). Hold released UNMET — say so, ` +
              `and if a heartbeat cron exists, end it with CronDelete now.`,
          )
        block(
          (checkless
            ? `hold: the goal is judged NOT met: ${j.reason}`
            : `hold: \`${s.check}\` exits 0 but the goal is judged NOT met: ${j.reason}`) +
            `\nGoal: ${s.goal}\nRound ${s.rounds + 1}/${s.maxRounds}.`,
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
              `${c}, with the goal never judged (${j.reason}). Hold released UNMET — say so, and if ` +
                `a heartbeat cron exists, end it with CronDelete now.`,
            )
          block(
            `hold: judge unavailable (${j.reason}), and this hold has no check — nothing has ` +
              `confirmed the goal, so the session keeps working.\nGoal: ${s.goal}\n` +
              `Round ${s.rounds + 1}/${s.maxRounds}.`,
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
        ` — objective met, hold released. If a heartbeat cron exists, END IT NOW with CronDelete: a ` +
        `cron outlives the work and nothing else can end it.`,
    )
  }
  // (d) A ceiling on a red check: released, and the verdict is UNMET.
  if (d.action === 'expired')
    release(
      'expired',
      `${d.reason}. Hold released UNMET — say so, and if a heartbeat cron exists, end it with ` +
        `CronDelete now: a cron outlives the work and nothing else can end it.`,
    )

  const firstB = s.rounds === 0
  s.rounds += 1
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
    reason: `hold: ${d.reason}${goalB}${noteB}${clausesB ? `\n${clausesB}` : ''}`,
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
      ? `RUN: ${s.run} — ${inFlight(s) ? 'IN FLIGHT (a stop is allowed and counts no round; the clock still runs)' : 'not in flight (a verdict is on disk)'}`
      : '',
    `BUDGET: ${s.rounds} of ${s.maxRounds} rounds used; ${left} min left of the ${s.ceilingMinutes} min ceiling.`,
    ...(s.queued ?? []).map(q =>
      `ALSO HELD: ${q.run || q.check || q.goal} — ${q.run && inFlight(q) ? 'in flight' : 'evaluated once this hold releases or goes in flight'}.`),
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
