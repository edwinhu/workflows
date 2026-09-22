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
 *   arm:     hound-arm.sh '<check command>' [--rounds N] [--minutes M]
 *   release: the check passes, a ceiling is reached, or the USER confirms `--disarm` at a
 *            terminal. Deleting the state file is not a release: the ledger beside it records
 *            the arm, and this hook restores a hold that vanished without one.
 */

import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

interface State {
  check: string
  goal?: string
  authority?: string
  continuation?: string
  goalPrompted?: boolean
  checkFiles?: Record<string, string>
  startedAt: number      // epoch seconds
  ceilingMinutes: number
  maxRounds: number
  rounds: number
  history?: RoundRecord[]
}

/** One round of the hold, as the hook observed it. */
export interface RoundRecord {
  round: number
  at: number             // epoch seconds
  exit: number           // the check's exit code
  note?: string          // the judge's verdict, when there was one
}

export function statePath(session: string): string {
  return join(process.env.TMPDIR || tmpdir(), `hound-${session}.json`)
}

/**
 * The ledger beside the state file. `hound-arm.sh` appends `armed` here when it arms and
 * `released by user` / `declined` / `refused` when release is attempted; this hook appends
 * `passed` and `expired`. It exists because the state file alone made the hold `rm`-able: a
 * session that could not argue its way out could still delete its way out. If the state file is
 * gone while the ledger's last word is `armed`, the hold was removed by something other than the
 * two sanctioned exits, and it is RESTORED rather than honoured.
 */
export function ledgerPath(session: string): string {
  return join(process.env.TMPDIR || tmpdir(), `hound-${session}.releases.log`)
}

function lastLedgerVerb(ledger: string): string | null {
  if (!existsSync(ledger)) return null
  const lines = readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean)
  const last = lines[lines.length - 1]
  if (!last) return null
  return (last.split('\t')[1] || '').trim() || null
}

/** What the hook decides, separated from the IO so it can be tested. */
export function decide(
  s: State,
  checkExit: number,
  nowSeconds: number,
): { action: 'pass' | 'block' | 'expired'; reason?: string } {
  if (checkExit === 0) return { action: 'pass' }

  const minutes = Math.floor((nowSeconds - s.startedAt) / 60)
  if (minutes >= s.ceilingMinutes) {
    return {
      action: 'expired',
      reason: `held for ${minutes} min, at or past the ${s.ceilingMinutes} min ceiling`,
    }
  }
  if (s.rounds >= s.maxRounds) {
    return { action: 'expired', reason: `${s.rounds} rounds, at the ${s.maxRounds} ceiling` }
  }
  return {
    action: 'block',
    reason:
      `\`${s.check}\` exits ${checkExit}, so the objective is NOT met. Take the next action ` +
      `now rather than proposing it — and judge from the command, not from this conversation. ` +
      `Round ${s.rounds + 1} of ${s.maxRounds}; ${s.ceilingMinutes - minutes} min left of the ` +
      `ceiling. Nothing is loosened to make it pass: fix the cause, or record why the rule does ` +
      `not apply, with the reason on the line.`,
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
 * hound replaced it with a command because a transcript judge can be satisfied by saying the right
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

function judgeViaDecisions(
  state: string,
  goal: string,
): { verdict: 'MET' | 'UNMET' | 'UNAVAILABLE'; reason: string } {
  const url = process.env.HOUND_DECISIONS_URL || 'https://openrouter.ai/api/alpha/decisions'
  const model = process.env.HOUND_DECISIONS_MODEL || 'typesafe/jev-1.13'
  // The threshold is DELIBERATELY high. Releasing a hold ends the work, so "probably done" is not
  // done: an uncertain answer should keep the session working, which is the failure this whole
  // mechanism exists to prevent.
  const threshold = Number(process.env.HOUND_DECISIONS_THRESHOLD || 0.8)

  let token = process.env.HOUND_JUDGE_TOKEN || ''
  if (!token) {
    const runtime = process.env.XDG_RUNTIME_DIR || '/run/user/1000'
    try {
      token = readFileSync(`${runtime}/agenix/openrouter-api-key`, 'utf8').trim()
    } catch {
      return { verdict: 'UNAVAILABLE', reason: 'no openrouter key (agenix secret not present)' }
    }
  }
  if (!token) return { verdict: 'UNAVAILABLE', reason: 'empty openrouter key' }

  const body = {
    state,
    model,
    questions: {
      met: {
        type: 'noul',
        instructions: `This goal has been fully met, with nothing outstanding, blocked or only partly done: ${goal}`,
      },
    },
  }
  const r = spawnSync(
    'curl',
    ['-sS', '--max-time', '60', '-X', 'POST', url,
     '-H', `Authorization: Bearer ${token}`,
     '-H', 'Content-Type: application/json',
     '--data-binary', '@-'],
    { encoding: 'utf8', input: JSON.stringify(body), timeout: 90_000 },
  )
  if (r.error || r.status !== 0) return { verdict: 'UNAVAILABLE', reason: 'decisions endpoint unreachable' }
  return parseNoul(r.stdout || '', 'met', threshold)
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
  const TAIL_CHARS = Number(process.env.HOUND_JUDGE_TAIL_CHARS || 4000)
  const SUMMARY_CHARS = Number(process.env.HOUND_JUDGE_SUMMARY_CHARS || 3000)
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
    `You are judging whether a coding session has MET its stated goal. You are not the session; ` +
    `judge only from the evidence below.\n\nGOAL: ${goal}\n\n` +
    `A command called the check already exits 0: ${check}\nThat is a floor, not proof the goal is met.\n\n` +
    `${evidence}\n\n` +
    `Set met=false if the goal names work that is still outstanding, blocked, or only partly done. ` +
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
  // AS that agent -- the same prompt returned "UNMET" from /tmp and "Craft run abandoned..." from
  // a repo carrying craft context. An HTTP call has no cwd and no persona to inherit.
  const url = process.env.HOUND_JUDGE_URL || 'http://127.0.0.1:8317/v1/chat/completions'
  const token = process.env.HOUND_JUDGE_TOKEN || 'sk-local-claude-proxy'
  const model = process.env.HOUND_JUDGE_MODEL || 'gpt-5.6-luna'

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
    const verb = lastLedgerVerb(ledger)
    const armed = verb !== null && verb.startsWith('armed')
    if (!armed) process.exit(0)                   // never armed, or properly released: inert
    const record = (verb.split('\u0000')[0] || '').slice(0)
    void record
    const saved = (readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).pop() || '')
    const json = saved.split('\t')[2] || ''
    try {
      const restored = JSON.parse(json) as State
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
    // the session on terms that cannot be read.
    rmSync(path, { force: true })
    process.exit(0)
  }

  const r = spawnSync('bash', ['-lc', s.check], { encoding: 'utf8', timeout: 900_000 })
  const exit = r.status ?? 2
  const d = decide(s, exit, Math.floor(Date.now() / 1000))

  if (d.action === 'pass') {
    // THE CHECK IS THE FLOOR, THE GOAL IS THE OBJECTIVE. `/goal` stated a broad objective and the
    // loop kept asking it; that half was lost when the self-send transport was deleted for landing
    // 127 of 163 (bbad18d4), and what remained was a single command that goes green after one fix.
    // The state file and this hook need no transport, so the goal travels here instead. On green
    // with a goal set, block ONCE and restate it: the session must say the goal is met or re-arm on
    // what is left. Bounded to one extra round by goalPrompted, so it cannot become its own trap.
    if (s.goal) {
      const j = judgeGoal(String(payload.transcript_path || ''), s.goal, s.check, s.history)
      if (j.verdict === 'UNMET') {
        s.rounds += 1
        // The judge's reason is the one fact a compaction destroys and nothing else holds: the
        // check is green, so no later round can rediscover why this one was refused.
        pushRound(s, { round: s.rounds, at: Math.floor(Date.now() / 1000), exit: 0, note: `judge UNMET: ${j.reason}` })
        writeFileSync(path, JSON.stringify(s))
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason:
            `\`${s.check}\` exits 0, so the CHECK is met — that is the floor, not the objective. ` +
            `An independent judge read the transcript and says the GOAL is NOT met: ${j.reason} ` +
            `THE GOAL: ${s.goal} ${[s.authority, s.continuation].filter(Boolean).join(' ')} (state: ${path})`,
        }))
        process.exit(0)
      }
      if (j.verdict === 'UNAVAILABLE')
        process.stderr.write(`until: goal judge unavailable (${j.reason}); releasing on the check alone.\n`)
    }
    appendFileSync(ledger, `${new Date().toISOString()}\tpassed\t${s.check}\n`)
    rmSync(path, { force: true })
    const moved = rubricDrift(s)
    const note = moved.length
      ? ` The check's own files changed while armed (${moved.join(', ')}) — the objective moved during the hold, so say what it says now.`
      : ''
    process.stderr.write(`until: \`${s.check}\` exits 0 — objective met, hold released.${note}\n`)
    process.exit(0)
  }
  if (d.action === 'expired') {
    appendFileSync(ledger, `${new Date().toISOString()}\texpired\t${s.check}\n`)
    rmSync(path, { force: true })
    const movedX = rubricDrift(s)
    const noteX = movedX.length ? ` (the check's own files also changed while armed: ${movedX.join(', ')})` : ''
    process.stderr.write(`until: ${d.reason}. Hold released UNMET — say so.${noteX}\n`)
    process.exit(0)
  }

  s.rounds += 1
  pushRound(s, { round: s.rounds, at: Math.floor(Date.now() / 1000), exit })
  writeFileSync(path, JSON.stringify(s))
  const movedB = rubricDrift(s)
  const goalB = s.goal ? ` THE GOAL: ${s.goal}` : ''
  // compose-goal.sh put AUTHORITY and CONTINUATION in the goal because the goal was "the one text
  // it re-reads every turn". Here that text is this message, so they belong here or nowhere.
  const clausesB = [s.authority, s.continuation].filter(Boolean).join(' ')
  const noteB = movedB.length
    ? ` The check's own files changed since it was armed (${movedB.join(', ')}): that is the objective moving, not the work — justify it on the line or restore them.`
    : ''
  process.stdout.write(JSON.stringify({ decision: 'block', reason: `${d.reason}${goalB}${noteB}${clausesB ? ' ' + clausesB : ''} (state: ${path})` }))
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
  const rounds = renderHistory(s.history)
  const out = [
    '# HOUND — this session is under an armed hold',
    `Read from ${path}, not remembered: the context this was in has just been summarised or cleared.`,
    s.goal ? `GOAL: ${s.goal}` : '',
    `CHECK: \`${s.check}\` — the hold releases when this exits 0${s.goal ? ' AND an independent judge agrees the goal is met' : ''}.`,
    `BUDGET: ${s.rounds} of ${s.maxRounds} rounds used; ${left} min left of the ${s.ceilingMinutes} min ceiling.`,
    [s.authority, s.continuation].filter(Boolean).join(' '),
    rounds ? `ROUNDS SO FAR — do not repeat these:\n${rounds}` : '',
  ].filter(Boolean)
  process.stdout.write(out.join('\n') + '\n')
  process.exit(0)
}

if (import.meta.main) (process.argv.includes('--brief') ? brief : main)()
