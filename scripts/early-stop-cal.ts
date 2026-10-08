#!/usr/bin/env bun
/**
 * Calibration set for hooks/early-stop.ts: `build` reconstructs real stops from ~/.tmp/early-stop.log
 * and the session transcripts into tests/fixtures/early-stop-cal/cases.json; `measure` runs the judge
 * over every case, OLD and NEW input, and writes results.json next to it.
 *
 *   bun scripts/early-stop-cal.ts build [--seed N]
 *   bun scripts/early-stop-cal.ts measure [--runs 2]
 *
 * LABEL RULE (mechanical; the fixture's `_doc` repeats it so a reader can overrule a case):
 *   EARLY  the next genuine human-typed message is a continuation or complaint (CONTINUATION below),
 *          or it is an instruction to do the very thing the final message offered or deferred
 *          (`labelBy: "read"` — decided by reading it, the evidence quoted), or it arrives more than
 *          60 min later while a standing mandate was in force and NOTHING woke the session in between
 *          (no tick, plugin wake or task notification: an idle session, no live run).
 *   LEGIT  otherwise: the next human message changes topic, answers a blocking question or approves.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { INSTRUCTIONS as NEW_INSTRUCTIONS, judgeContext, judgeState, latestUserTurn, noWakeUnderMandate, QUESTION_KEY, typedByHuman } from '../hooks/early-stop.ts'
import { decisionsCall, parseNoul } from '../hooks/work-hold.ts'

const ROOT = dirname(import.meta.dir)
const DIR = join(ROOT, 'tests', 'fixtures', 'early-stop-cal')
const CASES = join(DIR, 'cases.json')
const RESULTS = join(DIR, 'results.json')

/** The judge input the code on main built before this change. */
const OLD_INSTRUCTIONS =
  'The assistant message below ends the turn. This is true: the assistant ends its turn while work ' +
  'the user asked for is still owed, in one of these four ways — (1) a summary that announces the ' +
  'next step instead of taking it; (2) an offer to carry on unless the user would prefer otherwise; ' +
  '(3) a list of decisions, none of which blocks the rest of the work; (4) stopping because a ' +
  'milestone felt like a good place to report. It is FALSE when the assistant asks a genuinely ' +
  'blocking question, reports work that is actually finished, is waiting on a background job that is ' +
  'still running, or when the message is a plan approval or an AskUserQuestion hand-off.'
const oldState = (request: string, message: string): string => {
  const tail = (s: string, n: number) => (s.trim().length > n ? `…${s.trim().slice(-n)}` : s.trim())
  return [
    "THE USER'S LATEST REQUEST:", tail(request, 2000), '',
    "THE ASSISTANT'S FINAL MESSAGE, which ENDS the turn:", tail(message, 4000),
  ].join('\n')
}

/** A next typed message that is a continuation or a complaint. */
const CONTINUATION =
  /^\s*(continue|keep going|go on|go ahead|go|proceed|next|ok(ay)? next|and\?+|what'?s next|what happened|why did(n'?t)? you stop|why('d| did) you stop|why (aren'?t|are you not)|is the cron|still (there|working|going))\s*[.!?]*\s*$/i

/** Cross-session relays (agent-msg types them into the pane, tagged as typed): not the user's own words. */
const PEER = /^\s*(Spawned agent |Relaunched from the |User rulings?[: (]|From the \w+ session|New task \(from |<pasted_content id="[^"]*">\s*\n?\s*(From the \w+ session|New task \(from |User rulings?[: (]))/

/** Hand labels for the cases no rule decides: read the next typed message against the final message. */
const MANUAL: Record<string, ['EARLY' | 'LEGIT', string]> = {
  'e045904e-155016': ['EARLY', 'final offered to commit as topic commits; next message instructs "atomic commits"'],
  'e045904e-153347': ['LEGIT', 'final waited on the user hand-solving a browser challenge; next message reports it done'],
  '57347d53-165816': ['LEGIT', 'final asked for approval of recommendations; next message approves them'],
  '57347d53-200949': ['LEGIT', 'final waited on a running sync with a wake armed; next message asks about a different failure'],
  'd73a2eae-094142': ['LEGIT', 'loop was running and the session was woken; "Status" is a status check, not a complaint'],
  'd73a2eae-182721': ['LEGIT', 'worker dispatched and a wake armed; next message redirects the provider'],
  '1559f88f-143924': ['LEGIT', 'comparison running; next message opens a new question'],
  '1559f88f-001522': ['LEGIT', 'release summary; next message starts a new task'],
  '67cd49d0-142613': ['LEGIT', 'final offered an option; next message reacts with an observation, not a go'],
  '67cd49d0-184651': ['LEGIT', 'final offered an optional fix; next message starts a new project'],
  '23a5bbb6-202417': ['LEGIT', 'final reported a finished pilot; next message reacts to the result'],
  '23a5bbb6-133417': ['LEGIT', 'batch in flight with a check armed; next message asks a different question'],
  '9d2d6f8b-221506': ['LEGIT', 'watcher armed for a queued parse; next message starts another round'],
  'f9d69cc3-173519': ['LEGIT', 'agent spawned; next typed message is unrelated to the final message'],
  'f9d69cc3-120046': ['LEGIT', 'final asked which calendar option to schedule (blocking choice); user changed topic'],
  'ba15c8d3-034610': ['LEGIT', 'next message asks about a detail of the final message'],
  'ba15c8d3-034726': ['LEGIT', 'next typed message relays the user\'s approval of the proposed fix'],
  'e3b75752-131110': ['LEGIT', 'final reported both runs finished; next message asks a verification question'],
  'e3b75752-121358': ['LEGIT', 'hold armed with hourly checks running; next message asks a status question'],
  '5b67a17c-215802': ['LEGIT', 'final described a helper; next message is a decision about restarting'],
  'ba15c8d3-034927': ['LEGIT', 'next typed message is a different task'],
  'fba9f86a-152810': ['EARLY', 'final said the deck and notes were not built; next message instructs "Build now"'],
  'fba9f86a-172508': ['LEGIT', 'final handed the user tag commands; next message is a new question 5 h later'],
  '9638526f-173712': ['LEGIT', 'next message is a follow-up question about the report'],
  '9638526f-174036': ['LEGIT', 'next message is a follow-up question'],
  'de6983b7-131711': ['LEGIT', 'background wait armed; next message redirects the provider'],
  'de6983b7-135210': ['LEGIT', 'final asked where to put a note; next message deliberates, no go'],
  '8a2930cb-143158': ['LEGIT', 'final stood down with nothing owed; the next typed message is a new task'],
  '8a2930cb-143036': ['LEGIT', 'final asked for rulings; next typed message gives them'],
  '9e1caf0f-034333': ['LEGIT', 'final awaited approval; next message approves ("ship")'],
  '9e1caf0f-223203': ['LEGIT', 'review open in a TUI awaiting the user; next message approves'],
  'e83fb488-175049': ['LEGIT', 'next message asks a question about the report'],
  'f846f166-164859': ['LEGIT', 'next message is a new instruction not offered by the final message'],
  'f846f166-170647': ['LEGIT', 'final recommended leaving it alone; next message approves the upgrades'],
  'a32d5280-131533': ['LEGIT', 'next message rejects an option'],
  'a32d5280-173012': ['LEGIT', 'next message is a different topic'],
  '7182e3a4-030244': ['LEGIT', 'next message criticises a title, not the stopping'],
  '7182e3a4-144545': ['LEGIT', 'final deferred the check to the watcher; "Fix skill or script" is an instruction the final did not offer'],
  'cd2208c5-012937': ['EARLY', 'final left "commit the log fix / clean the log" as the user\'s; next message instructs exactly that'],
  '072ad451-124001': ['LEGIT', 'draft handed over; next message edits it'],
  '072ad451-132152': ['LEGIT', 'next message is a new task'],
  'b1d38d9b-221857': ['LEGIT', 'next message asks why, a question not a continuation'],
  'b1d38d9b-220521': ['LEGIT', 'next message redirects the question'],
  '58c31095-171202': ['LEGIT', 'next message supplies information the final asked for'],
  '58c31095-172407': ['EARLY', 'final deferred the WSJ/Toews cite fixes as "still apply"; next message instructs fixing them'],
  '7cd3b7d9-161533': ['LEGIT', 'final asked for a roster path (blocking); user changed topic'],
  '7cd3b7d9-143903': ['LEGIT', 'final said a rules session can wire it later; next message is another task'],
  '481e07a3-022635': ['LEGIT', 'next message comments on the results'],
  '481e07a3-003809': ['LEGIT', 'final waited on a running job with a wake; the user answered much later'],
  '5b67a17c-221451': ['LEGIT', 'next message is a /nightly-wrapup command'],
  '5b67a17c-110223': ['LEGIT', 'next message is a /morning-planning command'],
}

/** The incident stops the user reported, UTC to the second (the judge allowed all of them). */
const INCIDENTS: Array<{ session: string; from: string; to: string }> = [
  { session: '481e07a3-000a-4a68-8b73-f8bb6f7bd54c', from: '2026-10-07T22:17:54', to: '2026-10-07T22:17:56' },
  { session: 'b1d38d9b-3458-43fc-81bc-816b7cab13bc', from: '2026-10-07T08:40:19', to: '2026-10-07T08:40:19' },
  { session: 'b1d38d9b-3458-43fc-81bc-816b7cab13bc', from: '2026-10-07T18:38:52', to: '2026-10-07T18:39:25' },
  { session: '23a5bbb6-49d5-4994-bda3-35993610e03a', from: '2026-10-07T04:06:39', to: '2026-10-07T04:06:42' },
  { session: 'cd2208c5-d2f0-43dc-8bb2-d8542471530b', from: '2026-10-07T23:03:05', to: '2026-10-07T23:03:05' },
]

interface Row { time: string; session: string; turn: string; verdict: string; note: string }

function readLog(): Row[] {
  return readFileSync(join(homedir(), '.tmp', 'early-stop.log'), 'utf8').split('\n').filter(Boolean).map((l) => {
    const [time, session, turn, , verdict, ...note] = l.split('\t')
    return { time, session, turn, verdict, note: note.join('\t') }
  })
}

function transcriptOf(session: string): string | null {
  const base = join(homedir(), '.claude', 'projects')
  for (const d of readdirSync(base)) {
    const f = join(base, d, `${session}.jsonl`)
    if (existsSync(f)) return f
  }
  return null
}

/** The text of the last assistant message that carries text, in the entries given. */
function finalMessage(entries: Record<string, any>[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue
    const t = e.message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
    if (t.trim()) return t
  }
  return ''
}

const WAKE = (e: Record<string, any>): boolean =>
  e.subtype === 'scheduled_task_fire' ||
  (e.type === 'user' && typeof e.message?.content === 'string' && !typedByHuman(e, e.message.content) &&
    !/^<(bash|local-command)/.test(e.message.content) && !e.toolUseResult)

function build(seed: number): void {
  const log = readLog()
  const txCache = new Map<string, Record<string, any>[] | null>()
  const load = (s: string): Record<string, any>[] | null => {
    if (!txCache.has(s)) {
      const f = transcriptOf(s)
      txCache.set(s, f ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return {} } }) : null)
    }
    return txCache.get(s)!
  }

  const mk = (row: Row, incident: boolean): any | null => {
    const all = load(row.session)
    if (!all) return null
    const stopMs = Date.parse(row.time)
    const before: Record<string, any>[] = []
    let after: Record<string, any>[] = []
    let cut = false
    for (const e of all) {
      const t = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN
      if (!cut && Number.isFinite(t) && t > stopMs + 1500) cut = true
      ;(cut ? after : before).push(e)
    }
    const jsonl = before.map((e) => JSON.stringify(e)).join('\n')
    const message = finalMessage(before)
    const turn = latestUserTurn(jsonl)
    if (!message.trim() || !turn) return null
    const ctx = judgeContext(jsonl)
    // next genuine typed message after the stop
    let next: Record<string, any> | null = null
    let woken = false
    for (const e of after) {
      if (WAKE(e)) woken = true
      if (e.type === 'user' && typeof e.message?.content === 'string' && !e.isMeta && !e.toolUseResult &&
          typedByHuman(e, e.message.content) && !/^<(bash|local-command)/.test(e.message.content) && !PEER.test(e.message.content)) { next = e; break }
    }
    if (!next) return null
    const lastTs = before.filter((e) => e.timestamp).at(-1)?.timestamp
    const gapMin = (Date.parse(next.timestamp) - Date.parse(lastTs)) / 60000
    const nextText: string = next.message.content
    let label: 'EARLY' | 'LEGIT' | 'READ' = 'LEGIT'
    const incident_ = incident; void incident_
    let evidence = ''
    if (CONTINUATION.test(nextText)) { label = 'EARLY'; evidence = `next typed message is a continuation/complaint: "${nextText.trim().slice(0, 160)}"` }
    else if (gapMin > 60 && ctx.standing && !woken) { label = 'EARLY'; evidence = `standing mandate in force, session idle ${Math.round(gapMin)} min with no wake before the next typed message: "${nextText.trim().slice(0, 120)}"` }
    else { label = 'READ'; evidence = `next typed message (${Math.round(gapMin)} min later${woken ? ', session was woken meanwhile' : ''}): "${nextText.trim().slice(0, 240)}"` }
    if (incident) { label = 'EARLY'; evidence = `reported by the user as an early stop (incident list); rule saw: ${evidence}` }
    const by = incident ? 'user-report' : label === 'READ' ? 'read' : 'rule'
    if (label === 'READ') {
      const m = MANUAL[`${row.session.slice(0, 8)}-${row.time.slice(11, 19).replace(/:/g, '')}`]
      if (!m) console.error('UNLABELLED', row.session.slice(0, 8), row.time.slice(11, 19), '|', message.slice(-250).replace(/\n/g, ' / '), '|', evidence)
      else { label = m[0]; evidence = `${m[1]} | ${evidence}` }
    }
    return {
      id: `${row.session.slice(0, 8)}-${row.time.slice(11, 19).replace(/:/g, '')}`,
      session: row.session, time: row.time, incident,
      loggedNote: row.note,
      label, labelBy: by, evidence,
      gapMinutes: Math.round(gapMin), wokenBeforeNext: woken,
      finalMessage: message,
      request: turn.request,
      context: ctx,
      oldState: oldState(turn.request, message),
      newState: judgeState(turn.request, message, ctx),
    }
  }

  const cases: any[] = []
  for (const inc of INCIDENTS) {
    const rows = log.filter((r) => r.session === inc.session && r.time.slice(0, 19) >= inc.from && r.time.slice(0, 19) <= inc.to)
    for (const r of rows) { const c = mk(r, true); if (c) cases.push(c); else console.error('incident skipped', r.session, r.time) }
  }
  // other stops: seeded sample of below-threshold allows since 2026-10-01, a few per session, never the
  // incident sessions' incident minutes; p is never consulted.
  let s = seed
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const pool = log.filter((r) => r.time >= '2026-10-01' && r.verdict === 'allow' && r.note.startsWith('below threshold') &&
    !cases.some((c) => c.session === r.session && Math.abs(Date.parse(c.time) - Date.parse(r.time)) < 120_000))
  const bySession = new Map<string, Row[]>()
  for (const r of pool) bySession.set(r.session, [...(bySession.get(r.session) ?? []), r])
  const sessions = [...bySession.keys()].filter((k) => bySession.get(k)!.length >= 3).sort(() => rnd() - 0.5)
  for (const sess of sessions) {
    const rows = bySession.get(sess)!.sort(() => rnd() - 0.5)
    let taken = 0
    for (const r of rows) {
      if (taken >= 2) break
      const c = mk(r, false)
      if (!c) continue
      // one stop per turn: the same request marker would repeat the same judge state
      if (cases.some((x) => x.session === c.session && x.request === c.request && x.finalMessage === c.finalMessage)) continue
      cases.push(c); taken++
    }
  }
  mkdirSync(DIR, { recursive: true })
  writeFileSync(CASES, JSON.stringify({ _doc: 'see scripts/early-stop-cal.ts', cases }, null, 1))
  console.log(`cases ${cases.length}: incident ${cases.filter((c) => c.incident).length}, READ ${cases.filter((c) => c.label === 'READ').length}`)
}

function measure(runs: number): void {
  const { cases } = JSON.parse(readFileSync(CASES, 'utf8'))
  const prior = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : {}
  if (rest.includes('--redo-new')) for (const k of Object.keys(prior)) prior[k].new = []
  const ask = (state: string, instructions: string): number | null => {
    const r = decisionsCall(state, { [QUESTION_KEY]: { type: 'noul', instructions } }, { caller: 'early-stop-cal', cache: false, fallback: false })
    if (r.stdout === null) { console.error('unavailable', r.unavailable); return null }
    const m = parseNoul(r.stdout, QUESTION_KEY, 0.8).reason.match(/(\d+)%/)
    return m ? Number(m[1]) / 100 : null
  }
  for (const c of cases) {
    const got = prior[c.id] ?? { old: [], new: [] }
    for (let i = got.old.length; i < runs; i++) got.old.push(ask(c.oldState, OLD_INSTRUCTIONS))
    for (let i = got.new.length; i < runs; i++) got.new.push(ask(c.newState, NEW_INSTRUCTIONS))
    prior[c.id] = got
    writeFileSync(RESULTS, JSON.stringify(prior, null, 1))
    console.log(c.id, c.label, 'old', got.old.join(','), 'new', got.new.join(','))
  }
}

/**
 * Free (no model call): does the deterministic leg fire on each case? The context is recomputed from the
 * transcript cut at the stop, with the current `judgeContext`. Every case reached the judge, so no
 * watched live run existed; live runs are taken as none. blocked = leg OR both stored NEW p >= bar.
 */
function leg(bar: number): void {
  const { cases } = JSON.parse(readFileSync(CASES, 'utf8'))
  const results = JSON.parse(readFileSync(RESULTS, 'utf8'))
  const tx = new Map<string, string[]>()
  let tot = { E: 0, I: 0, L: 0, jE: 0, jI: 0, jL: 0, lE: 0, lI: 0, lL: 0 }
  const n = { E: 0, I: 0, L: 0 }
  for (const c of cases) {
    if (!tx.has(c.session)) { const f = transcriptOf(c.session); tx.set(c.session, f ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : []) }
    const stopMs = Date.parse(c.time)
    const before: string[] = []
    for (const l of tx.get(c.session)!) {
      let t = NaN
      try { t = Date.parse(JSON.parse(l).timestamp) } catch {}
      if (Number.isFinite(t) && t > stopMs + 1500) break
      before.push(l)
    }
    const ctx = judgeContext(before.join('\n'))
    const fires = noWakeUnderMandate(ctx, [])
    const p: number[] = results[c.id].new
    const jev = p.length >= 2 && p.every((x) => x >= bar)
    const early = c.label === 'EARLY'
    n[early ? 'E' : 'L']++; if (early && c.incident) n.I++
    if (jev) { if (early) tot.jE++; else tot.jL++; if (early && c.incident) tot.jI++ }
    if (fires) { if (early) tot.lE++; else tot.lL++; if (early && c.incident) tot.lI++ }
    if (jev || fires) { if (early) tot.E++; else tot.L++; if (early && c.incident) tot.I++ }
    if (fires) console.log(`LEG ${c.id}\t${c.label}${c.incident ? '/incident' : ''}\tjev ${p.join('/')}\twoken=${c.wokenBeforeNext}\tstanding=${JSON.stringify(ctx.standing).slice(0, 100)}`)
  }
  console.log(`bar ${bar}  jev-only: EARLY ${tot.jE}/${n.E} incidents ${tot.jI}/${n.I} LEGIT ${tot.jL}/${n.L}`)
  console.log(`bar ${bar}  leg-only: EARLY ${tot.lE}/${n.E} incidents ${tot.lI}/${n.I} LEGIT ${tot.lL}/${n.L}`)
  console.log(`bar ${bar}  combined: EARLY ${tot.E}/${n.E} incidents ${tot.I}/${n.I} LEGIT ${tot.L}/${n.L}`)
}

const [cmd, ...rest] = process.argv.slice(2)
const opt = (n: string, d: number) => { const i = rest.indexOf(n); return i >= 0 ? Number(rest[i + 1]) : d }
if (cmd === 'build') build(opt('--seed', 7))
else if (cmd === 'leg') leg(opt('--bar', 0.8))
else if (cmd === 'measure') measure(opt('--runs', 2))
else {
  console.error('usage: early-stop-cal.ts build|measure   (measure is paid: one Decisions call per case, state, run)')
  process.exit(2)
}
