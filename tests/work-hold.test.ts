import { describe, expect, test, setDefaultTimeout } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, renameSync, appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import {
  decide, statePath, parseJudgeVerdict, parseNoul,
  transcriptContext, renderHistory, pushRound,
  lastLedgerEntry, ledgerPath, ABANDONED, inFlight, ceilingReached, redispatchLine,
  PASSED_GOAL_MET, PASSED_UNJUDGED, unevaluatedNote, UNEVALUATED_AFTER_SECONDS,
} from '../hooks/work-hold'

// Tests in this file drive work-dispatch.sh as a real bash subprocess. Bun's 5s per-test default
// is a budget for that subprocess plus whatever else the machine is doing, so under parallel load
// these go red at exactly [5000.xx ms] — contention reported as a defect in the code under test.
// 60s does not hide a hang (a hang never returns and is caught by any finite ceiling); it stops
// standing in for a latency budget this suite never had. Set per file because bun 1.4.0 ignores
// `[test] timeout` in bunfig.toml and applies a preload's setDefaultTimeout to the first file only.
setDefaultTimeout(60_000)

const HOOK = join(import.meta.dir, '..', 'hooks', 'work-hold.ts')

const state = (o: Partial<Parameters<typeof decide>[0]> = {}) => ({
  check: 'false', startedAt: 1_000_000, ceilingMinutes: 720, maxRounds: 8, rounds: 0, ...o,
})

// ---------------------------------------------------------------- the decision

describe('the decision, separated from the IO so every branch is reachable', () => {
  test('a check that exits 0 releases the hold', () => {
    expect(decide(state(), 0, 1_000_060).action).toBe('pass')
  })

  test('a check that fails blocks, and the reason names the command and the exit', () => {
    const d = decide(state({ check: 'my-check' }), 1, 1_000_060)
    expect(d.action).toBe('block')
    expect(d.reason).toContain('my-check')
    expect(d.reason).toContain('exits 1')
    // The instruction that makes a hold useful rather than a nag.
    expect(d.reason).toContain('Act now')
    // ONE LINE, and it carries the two facts that change: the exit and the budget.
    expect(d.reason).toContain('Round 1/8')
    expect(d.reason).toContain('min left')
    expect(d.reason.split('\n').length).toBe(1)
  })

  // A hold that cannot expire is a session someone has to kill.
  test('the wall clock expires the hold even while the check still fails', () => {
    const d = decide(state({ ceilingMinutes: 10 }), 1, 1_000_000 + 11 * 60)
    expect(d.action).toBe('expired')
    expect(d.reason).toContain('ceiling')
  })

  test('the round counter expires it too — a clock stops a stuck run, a counter a losing one', () => {
    expect(decide(state({ maxRounds: 3, rounds: 3 }), 1, 1_000_060).action).toBe('expired')
  })

  test('a could-not-run exit blocks like any other failure, never passes', () => {
    // exit 2 is "could not look" everywhere in this codebase; it must not release a hold.
    expect(decide(state(), 2, 1_000_060).action).toBe('block')
    expect(decide(state(), 127, 1_000_060).action).toBe('block')
  })
})

// ---------------------------------------------------------------- the hook end to end

function run(payload: object, st?: object) {
  const dir = mkdtempSync(join(tmpdir(), 'work-hold-'))
  const sid = 'test-session'
  if (st) writeFileSync(join(dir, `work-hold-${sid}.json`), JSON.stringify(st))
  const r = spawnSync('bun', [HOOK], {
    input: JSON.stringify({ session_id: sid, ...payload }),
    encoding: 'utf8', env: { ...HERMETIC_ENV, TMPDIR: dir },
  })
  return { ...r, dir, path: join(dir, `work-hold-${sid}.json`) }
}

describe('the hook', () => {
  test('is INERT when no state file exists — it must not touch an unarmed session', () => {
    const r = run({})
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('')
  })

  // Blocking a stop causes another stop. Without this the session can never end.
  test('respects stop_hook_active, or it blocks its own block forever', () => {
    const r = run({ stop_hook_active: true },
      { check: 'false', startedAt: 1, ceilingMinutes: 720, maxRounds: 8, rounds: 0 })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('')
  })

  test('blocks with a decision the harness understands, and records the round', () => {
    const r = run({}, { check: 'exit 1', startedAt: Math.floor(Date.now() / 1000),
                        ceilingMinutes: 720, maxRounds: 8, rounds: 0 })
    const out = JSON.parse(r.stdout)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('exit 1')
    expect(JSON.parse(readFileSync(r.path, 'utf8')).rounds).toBe(1)
  })

  test('SELF-CLEARS when the check passes, so the normal ending needs no human', () => {
    const r = run({}, { check: 'true', startedAt: Math.floor(Date.now() / 1000),
                        ceilingMinutes: 720, maxRounds: 8, rounds: 0 })
    expect(r.stdout.trim()).toBe('')
    expect(existsSync(r.path)).toBe(false)
    // With NO goal armed there is nobody to judge the objective, so the release says the check is
    // green and says so of the goal that it is not confirmed — it does not claim "objective met".
    expect(r.stderr).toContain('hold released')
    expect(r.stderr).toContain('GOAL IS NOT CONFIRMED')
  })

  test('an unreadable state file releases rather than holds on unreadable terms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-hold-'))
    writeFileSync(join(dir, 'work-hold-test-session.json'), '{not json')
    const r = spawnSync('bun', [HOOK], {
      input: JSON.stringify({ session_id: 'test-session' }),
      encoding: 'utf8', env: { ...HERMETIC_ENV, TMPDIR: dir },
    })
    expect(r.status).toBe(0)
    expect(existsSync(join(dir, 'work-hold-test-session.json'))).toBe(false)
  })

  // A session that cannot argue its way out could still `rm` its way out, so a state file that
  // vanished while the ledger's last word is `armed` is RESTORED. The cap bookkeeping now appends a
  // `capped` line AFTER the arm, and that must not read as the ledger's last word.
  test('a deleted state file is restored, even with a `capped` line after the arm', () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-hold-'))
    const armedState = {
      check: 'exit 1', startedAt: Math.floor(Date.now() / 1000),
      ceilingMinutes: 720, maxRounds: 8, rounds: 0,
    }
    writeFileSync(join(dir, 'work-hold-test-session.releases.log'),
      `2026-09-25T00:00:00\tarmed\t${JSON.stringify(armedState)}\n` +
      `2026-09-25T00:00:01\tcapped\t${JSON.stringify({ path: '/x', window: 250000, prior: null, created: true })}\n`)
    const r = spawnSync('bun', [HOOK], {
      input: JSON.stringify({ session_id: 'test-session' }),
      encoding: 'utf8', env: { ...HERMETIC_ENV, TMPDIR: dir },
    })
    expect(JSON.parse(r.stdout).decision).toBe('block')
    expect(JSON.parse(r.stdout).reason).toContain('restored')
    expect(existsSync(join(dir, 'work-hold-test-session.json'))).toBe(true)
  })

  test('statePath is per SESSION, so arming one does not hold another', () => {
    expect(statePath('a')).not.toBe(statePath('b'))
  })
})

// ------------------------------------------------- the liveness stamp: is this hook running at all?
//
// A hold is armed by a script and enforced by a hook, registered independently. Measured 2026-09-28:
// a session predating v6.25 kept its Stop registration on the DELETED hooks/hound.ts while running
// the current work-dispatch.sh, so it armed a hold nothing ever evaluated — rounds 0 forever, no
// release after a PASS — while cron-delete-guard.ts, whose path never changed, went on refusing every
// CronDelete of the heartbeats. Nothing in the state distinguished that from a first round still
// running, so the stamp is written on EVERY Stop this file processes.
describe('lastEvaluatedAt — the hook proving it ran', () => {
  const now = () => Math.floor(Date.now() / 1000)

  test('a BLOCK stamps it', () => {
    const r = run({}, { check: 'exit 1', startedAt: now(), ceilingMinutes: 720, maxRounds: 8, rounds: 0 })
    expect(JSON.parse(r.stdout).decision).toBe('block')
    expect(JSON.parse(readFileSync(r.path, 'utf8')).lastEvaluatedAt).toBeGreaterThan(now() - 120)
  })

  // The quietest path, and so the one most likely to be missed: while a round is worked by a
  // detached process the hook allows the stop and writes nothing else.
  test('an IN-FLIGHT allow stamps it too — the path that used to write nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-hold-'))
    const runDir = join(dir, 'run')
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, 'args.json'), '{}')
    const path = join(dir, 'work-hold-test-session.json')
    writeFileSync(path, JSON.stringify({
      check: 'exit 1', run: runDir, startedAt: now(), ceilingMinutes: 720, maxRounds: 8, rounds: 0,
    }))
    const r = spawnSync('bun', [HOOK], {
      input: JSON.stringify({ session_id: 'test-session' }),
      encoding: 'utf8', env: { ...HERMETIC_ENV, TMPDIR: dir },
    })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('')                       // allowed, no round counted
    const s = JSON.parse(readFileSync(path, 'utf8'))
    expect(s.rounds).toBe(0)
    expect(s.lastEvaluatedAt).toBeGreaterThan(now() - 120)
  })

  test('a RESTORE stamps it — the ledger payload is arm-time state and would read as never evaluated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-hold-'))
    const armed = { check: 'exit 1', startedAt: 1, ceilingMinutes: 720, maxRounds: 8, rounds: 0 }
    writeFileSync(join(dir, 'work-hold-test-session.releases.log'),
      `2026-09-28T00:00:00\tarmed\t${JSON.stringify(armed)}\n`)
    const r = spawnSync('bun', [HOOK], {
      input: JSON.stringify({ session_id: 'test-session' }),
      encoding: 'utf8', env: { ...HERMETIC_ENV, TMPDIR: dir },
    })
    expect(JSON.parse(r.stdout).decision).toBe('block')
    expect(JSON.parse(readFileSync(join(dir, 'work-hold-test-session.json'), 'utf8')).lastEvaluatedAt)
      .toBeGreaterThan(now() - 120)
  })

  test('unevaluatedNote is silent once the stamp exists, whatever its age', () => {
    expect(unevaluatedNote({ startedAt: 1, lastEvaluatedAt: 1 }, 9_999_999)).toBeNull()
  })

  // A hold armed seconds ago has legitimately not been evaluated yet; firing there would make the
  // diagnosis noise on every arm.
  test('unevaluatedNote is silent inside the window, and names the remedy outside it', () => {
    expect(unevaluatedNote({ startedAt: 1_000_000 }, 1_000_000 + UNEVALUATED_AFTER_SECONDS - 1)).toBeNull()
    const note = unevaluatedNote({ startedAt: 1_000_000 }, 1_000_000 + 45 * 60)
    expect(note).toContain('never evaluated since arm 45m ago')
    expect(note).toContain("this session's Stop hook is not running work-hold.ts")
    expect(note).toContain('/reload-plugins')
  })
})

// -------------------------------------------------------------- what a block repeats, and what it does not
//
// The clauses and the state path are identical on every round, so repeating them buried the one
// thing that changes -- the exit and the budget -- in a paragraph the session had already read. They
// are said ONCE, on the first counted block, and again by --brief when a compaction has taken them
// out of context.

describe('the block message carries the news, not the boilerplate', () => {
  const AUTHORITY = 'You may decide alone, without asking: which finding to fix first.'
  const CONTINUATION = 'A failing check is not a stopping point: fix it and re-run in the same turn.'
  const held = (o: object = {}) => ({
    check: 'exit 1', startedAt: Math.floor(Date.now() / 1000),
    ceilingMinutes: 720, maxRounds: 8, rounds: 0,
    authority: AUTHORITY, continuation: CONTINUATION, ...o,
  })

  test('the FIRST counted block states the authority and the continuation rule', () => {
    const r = run({}, held())
    const reason = JSON.parse(r.stdout).reason
    expect(reason).toContain(AUTHORITY)
    expect(reason).toContain(CONTINUATION)
    // and it still leads with the news
    expect(reason.split('\n')[0]).toBe(
      'hold: `exit 1` exits 1 — not met. Round 1/8, 720 min left. Act now: fix the cause; do not loosen the check.',
    )
  })

  test('a LATER block omits both clauses and the state path', () => {
    const r = run({}, held({ rounds: 1 }))
    const reason = JSON.parse(r.stdout).reason
    expect(reason).not.toContain(AUTHORITY)
    expect(reason).not.toContain(CONTINUATION)
    expect(reason).not.toContain('work-hold-test-session.json')
    expect(reason).not.toContain('Read tool')
    expect(reason).toContain('Round 2/8')
  })

  test('the goal is the only other line on a normal block, and only when one is set', () => {
    expect(JSON.parse(run({}, held({ rounds: 1 })).stdout).reason.split('\n').length).toBe(1)
    const withGoal = JSON.parse(run({}, held({ rounds: 1, goal: 'ship the thing' })).stdout).reason
    expect(withGoal.split('\n')).toEqual([
      expect.stringContaining('Round 2/8'),
      'Goal: ship the thing',
    ])
  })
})

describe('--brief — where the clauses and the path DO belong', () => {
  test('SessionStart re-injects the path, the authority and the continuation rule', () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-hold-brief-'))
    const path = join(dir, 'work-hold-test-session.json')
    writeFileSync(path, JSON.stringify({
      check: 'exit 1', goal: 'ship the thing', startedAt: Math.floor(Date.now() / 1000),
      ceilingMinutes: 720, maxRounds: 8, rounds: 3,
      authority: 'AUTHORITY CLAUSE', continuation: 'CONTINUATION CLAUSE',
    }))
    const r = spawnSync('bun', [HOOK, '--brief'], {
      input: JSON.stringify({ session_id: 'test-session' }),
      encoding: 'utf8', env: { ...HERMETIC_ENV, TMPDIR: dir },
    })
    expect(r.stdout).toContain(path)
    expect(r.stdout).toContain('Read tool')
    expect(r.stdout).toContain('AUTHORITY CLAUSE')
    expect(r.stdout).toContain('CONTINUATION CLAUSE')
    expect(r.stdout).toContain('GOAL: ship the thing')
    expect(r.stdout).toContain('3 of 8 rounds used')
  })

  // EVERY heartbeat tick re-enters this brief, so the record is paid for on each one. The state
  // keeps 20 rounds for the judge; the brief shows the last 5.
  test('ROUNDS SO FAR renders only the last five, however many the state holds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-hold-brief-'))
    writeFileSync(join(dir, 'work-hold-test-session.json'), JSON.stringify({
      check: 'exit 1', startedAt: Math.floor(Date.now() / 1000),
      ceilingMinutes: 720, maxRounds: 20, rounds: 12,
      history: Array.from({ length: 12 }, (_, i) => ({ round: i + 1, at: 1_700_000_000, exit: 1 })),
    }))
    const r = spawnSync('bun', [HOOK, '--brief'], {
      input: JSON.stringify({ session_id: 'test-session' }),
      encoding: 'utf8', env: { ...HERMETIC_ENV, TMPDIR: dir },
    })
    const rounds = r.stdout.split('\n').filter((l) => /^ {2}round \d+ /.test(l))
    expect(rounds.length).toBe(5)
    expect(rounds[0]).toContain('round 8 ')
    expect(rounds[4]).toContain('round 12 ')
    expect(r.stdout).not.toContain('round 7 ')
  })
})

// ------------------------------------------------- every red Stop is a round, and there is no idle mode
//
// `--background` / "no news, no round" was DROPPED (AGK 2026-09-27). It existed for a hold whose
// objective was a run this session does not drive -- which is exactly the shape that belongs to
// grind, with fresh context per iteration, rather than to a heartbeat re-entering the whole session.

describe('a hold counts and blocks every red Stop', () => {
  const armed = (o: object = {}) => ({
    check: 'exit 1', startedAt: Math.floor(Date.now() / 1000),
    ceilingMinutes: 720, maxRounds: 8, rounds: 0, ...o,
  })

  test('an unchanged exit and an unchanged fingerprint still block, and still cost a round', () => {
    const r = run({}, armed())
    expect(JSON.parse(r.stdout).decision).toBe('block')
    const s = JSON.parse(readFileSync(r.path, 'utf8'))
    expect(s.rounds).toBe(1)
    expect(s.history).toEqual([{ round: 1, at: expect.any(Number), exit: 1 }])
    expect(r.stderr).not.toContain('no news')
  })

  test('a state file left over with background: true is ignored, not honoured', () => {
    const r = run({}, armed({ background: true }))
    expect(JSON.parse(r.stdout).decision).toBe('block')
    expect(JSON.parse(readFileSync(r.path, 'utf8')).rounds).toBe(1)
  })

  test('the minutes ceiling expires the hold', () => {
    const r = run({}, armed({ startedAt: Math.floor(Date.now() / 1000) - 40 * 60, ceilingMinutes: 30 }))
    expect(r.stderr).toContain('Hold released UNMET')
    expect(existsSync(r.path)).toBe(false)
  })
})

describe('work-hold.sh no longer takes --background', () => {
  const ARM = join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'work-hold.sh')
  const arm = (args: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'work-hold-'))
    const sid = `arm-${Math.random().toString(36).slice(2)}`
    const r = spawnSync('bash', [ARM, 'exit 1', ...args], {
      encoding: 'utf8',
      env: { ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: sid, WORK_HOLD_COMPACT_WINDOW: '0' },
    })
    return { r, dir, sid }
  }

  test('the flag is refused, and nothing is armed under it', () => {
    const { r } = arm(['--background'])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('unknown flag --background')
  })

  test('the state records no background key at all', () => {
    const { dir, sid } = arm([])
    const st = JSON.parse(readFileSync(join(dir, `work-hold-${sid}.json`), 'utf8'))
    expect('background' in st).toBe(false)
  })

  test('the defaults are the SHORT ceilings a hold is for: 4 rounds, 120 minutes', () => {
    const { dir, sid } = arm([])
    const st = JSON.parse(readFileSync(join(dir, `work-hold-${sid}.json`), 'utf8'))
    expect(st.maxRounds).toBe(4)
    expect(st.ceilingMinutes).toBe(120)
  })
})

const envelope = (content: string) =>
  JSON.stringify({ choices: [{ message: { content } }] })

test("a schema'd verdict parses to UNMET with its evidence", () => {
  const v = parseJudgeVerdict(envelope('{"met":false,"why":"3 tests are still failing."}'))
  expect(v.verdict).toBe("UNMET")
  expect(v.reason).toContain("3 tests")
})

test("met=true parses to MET", () => {
  expect(parseJudgeVerdict(envelope('{"met":true,"why":"suite is green"}')).verdict).toBe("MET")
})

test("a PROSE answer still parses, because structured output may not survive every route", () => {
  // response_format is an API feature and the OAuth-proxied routes may ignore or reject it, so the
  // parser accepts a plain MET/UNMET line as well. It must still ignore the wrapper's own warning
  // lines, which sit ahead of the answer.
  const prose = ["Permission ask rule (...): Write(...) is not matched", "UNMET", "three tests fail"].join("\n")
  expect(parseJudgeVerdict(envelope(prose)).verdict).toBe("UNMET")
  expect(parseJudgeVerdict(prose).verdict).toBe("UNMET")
})

test("a malformed judge reply fails OPEN, never UNMET", () => {
  // A hook that traps a session because a judge was unreachable or answered badly is worse than one
  // that lets a turn end on the check alone. UNAVAILABLE releases; UNMET would block.
  expect(parseJudgeVerdict("the model rambled and never answered").verdict).toBe("UNAVAILABLE")
  expect(parseJudgeVerdict(JSON.stringify({ choices: [] })).verdict).toBe("UNAVAILABLE")
})

const noulReply = (p: number) =>
  JSON.stringify({ model: "typesafe/jev-1.13", answers: { met: { type: "noul", noul: p } }, usage: {} })

test("the noul probability is thresholded, not trusted as a word", () => {
  // Measured against the live model 2026-09-22: suite green + flake green -> 0.92; three tests
  // failing -> 0.01; TWO OF THREE FIXED -> 0.02. "Partly done" sits near zero, which is what keeps
  // a hold working rather than releasing on "probably".
  expect(parseNoul(noulReply(0.92), "met", 0.8).verdict).toBe("MET")
  expect(parseNoul(noulReply(0.02), "met", 0.8).verdict).toBe("UNMET")
  expect(parseNoul(noulReply(0.79), "met", 0.8).verdict).toBe("UNMET")
  expect(parseNoul(noulReply(0.8), "met", 0.8).verdict).toBe("MET")
})

test("the noul verdict states the probability it acted on", () => {
  // A bare MET/UNMET hides whether it was 0.81 or 0.99, which is the whole value of a calibrated
  // answer; the reason carries both the number and the threshold.
  expect(parseNoul(noulReply(0.92), "met", 0.8).reason).toContain("92%")
  expect(parseNoul(noulReply(0.92), "met", 0.8).reason).toContain("80%")
})

test("a missing or malformed decision reply fails OPEN", () => {
  expect(parseNoul(JSON.stringify({ answers: {} }), "met", 0.8).verdict).toBe("UNAVAILABLE")
  expect(parseNoul("not json", "met", 0.8).verdict).toBe("UNAVAILABLE")
  expect(parseNoul(JSON.stringify({ answers: { met: { type: "noul" } } }), "met", 0.8).verdict).toBe("UNAVAILABLE")
})

// ---------------------------------------------------------------- the run's own memory

/** A transcript line as the harness writes it. */
const turn = (text: string) => JSON.stringify({ type: 'assistant', message: { content: text } })
const summaryLine = (text: string) =>
  JSON.stringify({ type: 'user', isCompactSummary: true, message: { content: text } })

describe('transcriptContext — the window the judge actually reads', () => {
  test('a transcript with NO compaction behaves exactly as a bare tail did', () => {
    const jsonl = [turn('one'), turn('two'), turn('three')].join('\n')
    const c = transcriptContext(jsonl, 4000, 3000)
    expect(c.summary).toBe('')
    expect(c.tail).toBe('one\ntwo\nthree')
  })

  test('the LAST summary wins when a long run has compacted more than once', () => {
    const jsonl = [
      turn('ancient'), summaryLine('FIRST SUMMARY'), turn('middle'),
      summaryLine('SECOND SUMMARY'), turn('recent'),
    ].join('\n')
    const c = transcriptContext(jsonl, 4000, 3000)
    expect(c.summary).toBe('SECOND SUMMARY')
    expect(c.tail).toBe('recent')
  })

  // THE BUG THIS EXISTS FOR. A boundary further back than the last 120 lines is precisely the long
  // unattended run the summary is the memory of; a reader that only looks at the recent window
  // finds no summary exactly when one matters.
  test('a boundary FURTHER BACK than 120 lines is still found', () => {
    const lines = [turn('pre-boundary'), summaryLine('DEEP SUMMARY')]
    for (let i = 0; i < 400; i++) lines.push(turn(`t${i}`))
    const c = transcriptContext(lines.join('\n'), 100_000, 3000)
    expect(c.summary).toBe('DEEP SUMMARY')
    expect(c.tail).toContain('t399')
  })

  test('turns BEFORE the boundary are excluded — they are what the summary replaced', () => {
    const jsonl = [turn('BEFORE-MARKER'), summaryLine('S'), turn('after')].join('\n')
    const c = transcriptContext(jsonl, 4000, 3000)
    expect(c.tail).not.toContain('BEFORE-MARKER')
    expect(c.tail).toBe('after')
  })

  test('the summary does not leak into the tail, where it would eat the whole tail budget', () => {
    const big = 'S'.repeat(5000)
    const jsonl = [summaryLine(big), turn('after')].join('\n')
    const c = transcriptContext(jsonl, 4000, 3000)
    expect(c.tail).toBe('after')
  })

  test('both halves are capped, and each keeps the end that carries its information', () => {
    // HEAD of the summary (it opens with intent), TAIL of the turns (they carry recent evidence).
    const jsonl = [summaryLine('HEAD' + 'x'.repeat(5000) + 'SUMTAIL'),
                   turn('OLDEST' + 'y'.repeat(5000) + 'NEWEST')].join('\n')
    const c = transcriptContext(jsonl, 100, 50)
    expect(c.summary.length).toBe(50)
    expect(c.summary.startsWith('HEAD')).toBe(true)
    expect(c.tail.length).toBe(100)
    expect(c.tail.endsWith('NEWEST')).toBe(true)
  })

  test('unparsable lines are skipped rather than losing the whole transcript', () => {
    const jsonl = ['{not json', summaryLine('S'), 'also not json', turn('after')].join('\n')
    const c = transcriptContext(jsonl, 4000, 3000)
    expect(c.summary).toBe('S')
    expect(c.tail).toBe('after')
  })

  test('content blocks are read as well as plain strings', () => {
    const jsonl = JSON.stringify({ message: { content: [{ type: 'text', text: 'block text' }] } })
    expect(transcriptContext(jsonl, 4000, 3000).tail).toBe('block text')
  })
})

describe('the round record — no new file, and bounded on write', () => {
  test('is empty when nothing has been recorded', () => {
    expect(renderHistory(undefined)).toBe('')
    expect(renderHistory([])).toBe('')
  })

  test('renders the exit code and the judge reason a compaction would destroy', () => {
    const out = renderHistory([
      { round: 1, at: 1_700_000_000, exit: 1 },
      { round: 2, at: 1_700_003_600, exit: 0, note: 'judge UNMET: two suites still red' },
    ])
    expect(out).toContain('round 1')
    expect(out).toContain('check exit 1')
    expect(out).toContain('two suites still red')
  })

  test('is BOUNDED on write, so a long hold cannot grow the state file without limit', () => {
    const s: any = { history: [] }
    for (let i = 1; i <= 50; i++) pushRound(s, { round: i, at: i, exit: 1 }, 20)
    expect(s.history.length).toBe(20)
    expect(s.history[0].round).toBe(31)       // the OLDEST are dropped, not the newest
    expect(s.history[19].round).toBe(50)
  })

  test('starts a history on a state file that has none', () => {
    const s: any = {}
    pushRound(s, { round: 1, at: 1, exit: 1 })
    expect(s.history.length).toBe(1)
  })
})

// ---------------------------------------------------------------- --status is a position, not a dump

describe('work-hold.sh --status', () => {
  const ARM = join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'work-hold.sh')

  test('prints the hold as labelled lines and only the last 5 ledger events, no JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holdstatus-'))
    const armed = {
      check: 'bun test tests/work-hold.test.ts', goal: 'the suite is green',
      startedAt: Math.floor(Date.now() / 1000) - 30 * 60,
      ceilingMinutes: 720, maxRounds: 8, rounds: 3,
      authority: 'AUTHORITY CLAUSE', continuation: 'CONTINUATION CLAUSE',
      history: [
        { round: 1, at: 1, exit: 1 },
        { round: 2, at: 3, exit: 1 },
        { round: 3, at: 4, exit: 0, note: 'judge UNMET: still red' },
      ],
    }
    writeFileSync(join(dir, 'work-hold-status-test.json'), JSON.stringify(armed))
    const ledger = [
      ...Array.from({ length: 7 }, (_, i) =>
        `2026-09-25T0${i}:00:00-04:00\tarmed\t${JSON.stringify(armed)}`),
      `2026-09-25T09:00:00-04:00\tcapped\t${JSON.stringify({ path: '/x/settings.local.json', window: 250000, prior: null, created: true })}`,
      '2026-09-25T10:00:00-04:00\tdeclined\tbun test tests/work-hold.test.ts',
    ].join('\n') + '\n'
    writeFileSync(join(dir, 'work-hold-status-test.releases.log'), ledger)

    const r = spawnSync('bash', [ARM, '--status'], {
      encoding: 'utf8',
      env: { ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: 'status-test' },
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('check:   bun test tests/work-hold.test.ts')
    expect(r.stdout).toContain('rounds:  3 of 8 used')
    expect(r.stdout).toMatch(/minutes: 69\d left of 720/)
    // the LAST 3 rounds
    expect(r.stdout).toContain('round 1 exit 1; round 2 exit 1; round 3 exit 0')

    // the armed JSON never appears — neither the state dump nor the ledger's payloads
    expect(r.stdout).not.toContain('maxRounds')
    expect(r.stdout).not.toContain('AUTHORITY CLAUSE')
    expect(r.stdout).not.toContain('{')

    // five ledger events, each timestamp + event + check
    const events = r.stdout.split('\n').filter((l) => /^ {4}2026-09-25T/.test(l))
    expect(events.length).toBe(5)
    expect(events[4]).toBe('    2026-09-25T10:00:00-04:00  declined  bun test tests/work-hold.test.ts')
    expect(events[3]).toBe('    2026-09-25T09:00:00-04:00  capped  /x/settings.local.json')
    // the whole thing stays short enough to read at a glance
    expect(r.stdout.trim().split('\n').length).toBeLessThanOrEqual(14)
  })

  test('says so plainly when nothing is armed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holdstatus-'))
    const r = spawnSync('bash', [ARM, '--status'], {
      encoding: 'utf8',
      env: { ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: 'status-none' },
    })
    expect(r.stdout.trim()).toBe('hold: not armed')
  })

  /** An armed state under a fresh TMPDIR, with whatever liveness stamp the case needs. */
  const statusOf = (extra: Record<string, unknown>) => {
    const dir = mkdtempSync(join(tmpdir(), 'holdstatus-'))
    writeFileSync(join(dir, 'work-hold-status-skew.json'), JSON.stringify({
      check: 'bun test x', startedAt: Math.floor(Date.now() / 1000) - 45 * 60,
      ceilingMinutes: 720, maxRounds: 8, rounds: 0, ...extra,
    }))
    return spawnSync('bash', [ARM, '--status'], {
      encoding: 'utf8',
      env: { ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: 'status-skew' },
    })
  }

  // The user-visible half of the version-skew diagnosis: a hold frozen at rounds 0 looks identical to
  // a first round still running, and --status is where someone goes to find out which it is.
  test('reports an unevaluated hold as the Stop hook not running, with the remedy', () => {
    const r = statusOf({})
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('never evaluated since arm 45m ago')
    expect(r.stdout).toContain('not running work-hold.ts')
    expect(r.stdout).toContain('/reload-plugins')
  })

  test('reports how long ago the hook last checked, when it has', () => {
    const r = statusOf({ lastEvaluatedAt: Math.floor(Date.now() / 1000) - 3 * 60 })
    expect(r.stdout).toContain('checked: 3m ago by the Stop hook')
    expect(r.stdout).not.toContain('/reload-plugins')
  })

  test('a hold armed moments ago is NOT reported as skewed — it has simply not stopped yet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holdstatus-'))
    writeFileSync(join(dir, 'work-hold-status-fresh.json'), JSON.stringify({
      check: 'bun test x', startedAt: Math.floor(Date.now() / 1000),
      ceilingMinutes: 720, maxRounds: 8, rounds: 0,
    }))
    const r = spawnSync('bash', [ARM, '--status'], {
      encoding: 'utf8',
      env: { ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: 'status-fresh' },
    })
    expect(r.stdout).not.toContain('/reload-plugins')
  })
})

// ------------------------------------------------------------------ --disarm on every transport
//
// The tty read reaches only a terminal someone is sitting at. A user on Remote Control or a phone
// could not release a hold they had already decided was finished: the remaining exits were to wait
// out the ceiling or abandon the run. Without a tty the confirmation is the user's `permissions.ask`
// rule `Bash(*work-hold.sh --disarm*)`, which prompts on whatever device they are on and cannot be
// answered by this process. The ledger records WHICH confirmation happened either way.
describe('work-hold.sh --disarm', () => {
  const ARM = join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'work-hold.sh')
  const HOOKPATH = join(import.meta.dir, '..', 'hooks', 'work-hold.ts')

  /** An armed hold under a fresh TMPDIR, ready to be released. */
  function armed() {
    const dir = mkdtempSync(join(tmpdir(), 'holddisarm-'))
    const sid = `disarm-${Math.random().toString(36).slice(2)}`
    const path = join(dir, `work-hold-${sid}.json`)
    const state = {
      check: 'bun test tests/x.test.ts', startedAt: Math.floor(Date.now() / 1000),
      ceilingMinutes: 120, maxRounds: 4, rounds: 2,
    }
    writeFileSync(path, JSON.stringify(state))
    writeFileSync(join(dir, `work-hold-${sid}.releases.log`),
      `2026-09-28T00:00:00\tarmed\t${JSON.stringify(state)}\n`)
    return { dir, sid, path, ledger: join(dir, `work-hold-${sid}.releases.log`) }
  }

  const disarm = (h: ReturnType<typeof armed>, pty = false) => {
    const env = { ...HERMETIC_ENV, TMPDIR: h.dir, CLAUDE_CODE_SESSION_ID: h.sid, WORK_HOLD_COMPACT_WINDOW: '0' }
    // `script` allocates a real pty, which is the only way /dev/tty opens in a test.
    const argv = pty
      ? ['script', ['-qec', `bash ${ARM} --disarm`, '/dev/null']]
      : ['bash', [ARM, '--disarm']]
    return spawnSync(argv[0] as string, argv[1] as string[], { encoding: 'utf8', env, input: pty ? 'y\n' : undefined })
  }

  test('with NO tty it releases, and records the permission-prompt verb', () => {
    const h = armed()
    const r = disarm(h)
    expect(r.status).toBe(0)
    expect(existsSync(h.path)).toBe(false)
    expect(r.stdout).toContain('disarmed')
    expect(readFileSync(h.ledger, 'utf8')).toContain('released by user (permission prompt)')
    // The refusal it replaces must be gone: an agent-facing lecture where the user asked to release.
    expect(r.stderr).not.toContain('needs the USER to confirm at a terminal')
  })

  test('with a tty the interactive confirm is unchanged, and y releases under the plain verb', () => {
    const h = armed()
    const r = disarm(h, true)
    expect(r.stdout).toContain('release the hold on')   // the prompt still happened
    expect(existsSync(h.path)).toBe(false)
    const log = readFileSync(h.ledger, 'utf8')
    expect(log).toContain('\treleased by user\t')
    expect(log).not.toContain('permission prompt')
  })

  test('with a tty, declining still keeps the hold armed', () => {
    const h = armed()
    const env = { ...HERMETIC_ENV, TMPDIR: h.dir, CLAUDE_CODE_SESSION_ID: h.sid, WORK_HOLD_COMPACT_WINDOW: '0' }
    const r = spawnSync('script', ['-qec', `bash ${ARM} --disarm`, '/dev/null'],
      { encoding: 'utf8', env, input: 'n\n' })
    expect(r.stdout).toContain('still armed')
    expect(existsSync(h.path)).toBe(true)
    expect(readFileSync(h.ledger, 'utf8')).toContain('\tdeclined\t')
  })

  test('an unarmed session says so rather than releasing nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holddisarm-'))
    const r = spawnSync('bash', [ARM, '--disarm'],
      { encoding: 'utf8', env: { ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: 'none' } })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('hold: not armed')
  })

  // The hook restores a state file that vanished while the ledger's last word is `armed`. A new
  // release verb has to land on the released side of that test, or a sanctioned release is undone on
  // the very next Stop — and the session is trapped with no way out at all.
  test('the new verb is a SANCTIONED release: the hook does not restore the hold after it', () => {
    const h = armed()
    expect(disarm(h).status).toBe(0)
    const r = spawnSync('bun', [HOOKPATH], {
      input: JSON.stringify({ session_id: h.sid }),
      encoding: 'utf8', env: { ...HERMETIC_ENV, TMPDIR: h.dir },
    })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('')
    expect(existsSync(h.path)).toBe(false)
  })

  // The restore test is `verb.startsWith('armed')`, so an unknown verb reads as RELEASED. That is the
  // safe direction — the opposite would trap a session on a ledger line nobody anticipated — and it
  // is asserted here so a future verb cannot silently flip it.
  test('an unrecognised verb reads as released, not as armed', () => {
    const h = armed()
    appendFileSync(h.ledger, `2026-09-28T00:00:01\tsome-verb-from-the-future\t${'x'}\n`)
    rmSync(h.path)
    const r = spawnSync('bun', [HOOKPATH], {
      input: JSON.stringify({ session_id: h.sid }),
      encoding: 'utf8', env: { ...HERMETIC_ENV, TMPDIR: h.dir },
    })
    expect(r.stdout.trim()).toBe('')
    expect(existsSync(h.path)).toBe(false)
  })
})

// ------------------------------------------------- arming warns when the ceilings say "use grind"

/**
 * A hold whose ceiling is hours pays this session's whole context on every heartbeat tick, and the
 * cheaper mechanism on the same check is grind, which gets a fresh process per iteration. The
 * warning exists so that cost is visible at the moment the ceilings are chosen; it never refuses,
 * because the ceilings are the user's.
 */
describe('work-hold.sh warns on a LONG hold and hands over the grind command', () => {
  const ARM = join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'work-hold.sh')

  const arm = (extra: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'holdlong-'))
    const sid = `long-${Math.random().toString(36).slice(2)}`
    // A check that RUNS and exits 1 — arming refuses anything else, so the warning is never reached.
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'measure.sh'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 })
    const r = spawnSync('bash', [ARM, 'bash scripts/measure.sh --rate-below 0.01', ...extra], {
      encoding: 'utf8',
      cwd: dir,
      env: { ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: sid, WORK_HOLD_COMPACT_WINDOW: '0' },
    })
    return { ...r, dir, sid, state: join(dir, `work-hold-${sid}.json`) }
  }

  for (const extra of [['--minutes', '480'], ['--rounds', '15'], ['--rounds', '15', '--minutes', '600']]) {
    test(`warns above the thresholds: ${extra.join(' ')}`, () => {
      const r = arm(extra)
      expect(r.stderr).toContain('WARNING: this is a LONG hold')
      expect(r.stderr).toContain('re-enters THIS session')
      // the ready-to-run replacement, in the form grind's SKILL.md documents
      expect(r.stderr).toContain('setsid nohup bash ')
      expect(r.stderr).toContain('skills/grind/scripts/grind.sh run')
      expect(r.stderr).toContain("--check 'bash scripts/measure.sh --rate-below 0.01'")
      expect(r.stderr).toMatch(/--max-iters \d+/)
      expect(r.stderr).toContain('>grind.log 2>&1 </dev/null &')
      // still armed, exit code unchanged
      expect(r.status).toBe(0)
      expect(existsSync(r.state)).toBe(true)
    })
  }

  for (const extra of [[], ['--minutes', '120'], ['--rounds', '4'], ['--rounds', '4', '--minutes', '120']]) {
    test(`silent at or below the thresholds: ${extra.join(' ') || '(defaults)'}`, () => {
      const r = arm(extra)
      expect(r.stderr).not.toContain('LONG hold')
      expect(r.stderr).not.toContain('grind.sh')
      expect(r.status).toBe(0)
      expect(existsSync(r.state)).toBe(true)
    })
  }

  // --run is work-dispatch.sh arming over a detached run, whose 720-minute ceiling comes from
  // compose-goal.sh rather than from anyone choosing it — so the warning fired on EVERY dispatch,
  // and grind is not the alternative to a run that is already in flight.
  test('is SILENT when the hold was armed with --run, however long the ceilings', () => {
    const r = arm(['--run', '/tmp', '--rounds', '15', '--minutes', '600'])
    expect(r.stderr).not.toContain('LONG hold')
    expect(r.stderr).not.toContain('grind.sh')
    expect(r.status).toBe(0)
    expect(existsSync(r.state)).toBe(true)
  })

  test('still warns on the same ceilings without --run, so the advice is not lost', () => {
    const r = arm(['--rounds', '15', '--minutes', '600'])
    expect(r.stderr).toContain('WARNING: this is a LONG hold')
  })

  test('the grind path it names actually exists', () => {
    const line = /setsid nohup bash (\S+) run/.exec(arm(['--minutes', '480']).stderr)
    expect(line, 'no grind command in the warning').not.toBeNull()
    expect(existsSync(line![1])).toBe(true)
  })
})

// ------------------------------------------------- arming warns about an uncapped context window

describe('work-hold.sh and the auto-compact cap', () => {
  const ARM = join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'work-hold.sh')

  // Neither transport exists here, so the cap cannot reach the session -- which is the point:
  // arming must still succeed and say what to do by hand. Both are pinned to absent values because
  // the suite inherits the REAL session's env, where a live bridge id would make this send for
  // real. The opt-outs are asserted on the line they print.
  function arm(extra: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'holdarm-'))
    const env: Record<string, string> = {
      ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: 'arm-cap-test',
      WORK_HOLD_HERDR: '/nonexistent-herdr', WORK_HOLD_SETTLE_MS: '0',
      CLAUDE_CODE_BRIDGE_SESSION_ID: '', WORK_HOLD_AGENT_MSG: '/nonexistent-agent-msg',
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '', ...extra,
    }
    const r = spawnSync('bash', [ARM, 'exit 1', '--minutes', '720'], { encoding: 'utf8', env })
    return { ...r, dir }
  }

  test('with no pane it arms anyway and names the manual fix', () => {
    const r = arm({})
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('no Herdr pane')
    expect(r.stdout).toContain('settings.local.json')
    expect(existsSync(join(r.dir, 'work-hold-arm-cap-test.json'))).toBe(true)
  })

  test('WORK_HOLD_COMPACT_WINDOW=0 opts out', () => {
    expect(arm({ WORK_HOLD_COMPACT_WINDOW: '0' }).stdout).toContain('not capped')
  })

  test('CLAUDE_CODE_AUTO_COMPACT_WINDOW wins, so the cap stands down', () => {
    const r = arm({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '400000' })
    expect(r.stdout).toContain('CLAUDE_CODE_AUTO_COMPACT_WINDOW is set')
    expect(r.status).toBe(0)
  })
})

// ---------------------------------------------------------- DONE MEANS THE GOAL IS MET
//
// `passed` said only that the check went green, so a run armed with no goal released identically to
// one the classifier had confirmed — and the heartbeat's teardown clause could not tell them apart.
// The verb is what carries the difference, and cron-delete-guard.ts is what enforces it.

/** The Decisions API's shape, out of process — spawnSync would block a server in this one. */
function stubDecisions(port: number, noul: number) {
  const code = `
import json, http.server, socketserver

class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        b = json.dumps({"answers":{"met":{"type":"noul","noul":${noul}}}}).encode()
        self.send_response(200); self.send_header("content-type","application/json")
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(("127.0.0.1", ${port}), H).serve_forever()
`
  return Bun.spawn(['python3', '-c', code], { stdout: 'ignore', stderr: 'ignore' })
}

/** A pass-branch run with its own TMPDIR, a transcript for the judge, and the ledger it wrote. */
function passRun(sid: string, st: object, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'holdverb-'))
  writeFileSync(join(dir, `work-hold-${sid}.json`), JSON.stringify({
    check: 'true', startedAt: Math.floor(Date.now() / 1000),
    ceilingMinutes: 720, maxRounds: 8, rounds: 0, ...st,
  }))
  const transcript = join(dir, 't.jsonl')
  writeFileSync(transcript, JSON.stringify({ message: { content: 'some work happened' } }) + '\n')
  const r = spawnSync('bun', [HOOK], {
    input: JSON.stringify({ session_id: sid, transcript_path: transcript }),
    encoding: 'utf8',
    env: {
      ...HERMETIC_ENV,
      TMPDIR: dir,
      // Both judges DEAD by default, so nothing here makes a billed call and an unstubbed test
      // exercises the UNAVAILABLE path deliberately rather than by accident.
      XDG_RUNTIME_DIR: '/nonexistent-so-no-agenix-key',
      WORK_HOLD_DECISIONS_URL: 'http://127.0.0.1:1/decisions',
      WORK_HOLD_JUDGE_URL: 'http://127.0.0.1:1/v1/chat/completions',
      ...env,
    },
  })
  const log = join(dir, `work-hold-${sid}.releases.log`)
  return { ...r, dir, log, entry: lastLedgerEntry(log) }
}

describe('the pass branch writes DISTINCT verbs, because a green check is not a met goal', () => {
  test('no goal at all releases `passed-unjudged` and tells the session to keep the heartbeat', () => {
    const r = passRun('verb-nogoal', {})
    expect(r.entry?.verb).toBe(PASSED_UNJUDGED)
    expect(r.entry?.payload.trim()).toBe('true')
    expect(r.stderr).toContain('GOAL IS NOT CONFIRMED')
    expect(r.stderr).toContain('Do NOT end the heartbeat with CronDelete')
  })

  test('an UNREACHABLE judge releases `passed-unjudged` too — failing open is not a verdict', () => {
    const r = passRun('verb-down', { goal: 'the estimate lands inside the published interval' })
    expect(r.entry?.verb).toBe(PASSED_UNJUDGED)
    expect(r.stderr).toContain('judge unavailable')
    expect(r.stderr).toContain('GOAL IS NOT CONFIRMED')
  })

  test('a judge that says MET releases `passed-goal-met`, and only then is CronDelete offered', async () => {
    const port = 18791
    const srv = stubDecisions(port, 0.96)
    await Bun.sleep(700)
    const r = passRun('verb-met', { goal: 'the estimate lands inside the published interval' }, {
      WORK_HOLD_JUDGE_TOKEN: 'test-token',
      WORK_HOLD_DECISIONS_URL: `http://127.0.0.1:${port}/decisions`,
    })
    srv.kill()
    expect(r.entry?.verb).toBe(PASSED_GOAL_MET)
    expect(r.stderr).toContain('objective met')
    expect(r.stderr).toContain('classifier judged the goal MET')
    // Conditional, because the cron is now optional: the monitor is the wake and a session may
    // have raised no cron at all.
    expect(r.stderr).toContain('If a heartbeat cron exists, END IT NOW with CronDelete')
  }, 30000)

  test('a judge that says UNMET still blocks — the new verbs did not touch that path', async () => {
    const port = 18792
    const srv = stubDecisions(port, 0.04)
    await Bun.sleep(700)
    const r = passRun('verb-unmet', { goal: 'every suite is green' }, {
      WORK_HOLD_JUDGE_TOKEN: 'test-token',
      WORK_HOLD_DECISIONS_URL: `http://127.0.0.1:${port}/decisions`,
    })
    srv.kill()
    expect(JSON.parse(r.stdout).decision).toBe('block')
    expect(r.entry).toBeNull()          // nothing released, so nothing was written
  }, 30000)
})

// ------------------------------------------------- the run: in flight, and the hold's other modes
//
// A round in flight is worked by a DETACHED process, so a block buys nothing and costs a wake: AGK
// 2026-09-27, a heartbeat woke 14 times inside one round. The rule is a filesystem test — args.json
// with no non-empty result.json — which is also why a REDISPATCH (result.json rotated away) makes the
// run in flight again with no second record of anything.

/** A run dir in `dir`, in whatever state the flags say. */
function runDir(dir: string, opts: { args?: boolean; result?: string | null } = {}) {
  const r = join(dir, 'run')
  mkdirSync(r, { recursive: true })
  if (opts.args !== false) writeFileSync(join(r, 'args.json'), '{}')
  if (opts.result != null) writeFileSync(join(r, 'result.json'), opts.result)
  return r
}

describe('inFlight — the filesystem test, not a belief about the run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'holdflight-'))

  test('no run at all is never in flight', () => {
    expect(inFlight({})).toBe(false)
  })

  test('args.json with no result.json IS the in-flight shape', () => {
    expect(inFlight({ run: runDir(join(dir, 'a')) })).toBe(true)
  })

  test('an EMPTY result.json is still in flight — a truncated write is not a verdict', () => {
    expect(inFlight({ run: runDir(join(dir, 'b'), { result: '' }) })).toBe(true)
  })

  test('a non-empty result.json ends it', () => {
    expect(inFlight({ run: runDir(join(dir, 'c'), { result: '[{"overallPass":true}]' }) })).toBe(false)
  })

  test('a run dir with no args.json is not a run dir', () => {
    expect(inFlight({ run: runDir(join(dir, 'd'), { args: false, result: 'x' }) })).toBe(false)
  })

  test('a REDISPATCH rotates the verdict away, and the run is in flight again', () => {
    const r = runDir(join(dir, 'e'), { result: '[{"overallPass":false}]' })
    expect(inFlight({ run: r })).toBe(false)
    renameSync(join(r, 'result.json'), join(r, 'result.round1.json'))
    expect(inFlight({ run: r })).toBe(true)
  })
})

describe('ceilingReached — the clock binds on the paths decide() never sees', () => {
  const s = { startedAt: 1_000_000, ceilingMinutes: 120, rounds: 0, maxRounds: 4 }

  test('inside both ceilings it is null', () => {
    expect(ceilingReached(s, 1_000_060)).toBeNull()
  })

  test('the wall clock', () => {
    expect(ceilingReached({ ...s, ceilingMinutes: 10 }, 1_000_000 + 11 * 60)).toContain('ceiling')
  })

  test('the round counter', () => {
    expect(ceilingReached({ ...s, rounds: 4 }, 1_000_060)).toContain('4 rounds')
  })
})

describe('the hook allows a stop while the watched run is IN FLIGHT', () => {
  const now = Math.floor(Date.now() / 1000)

  test('no block, no round counted, and the state file is untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holdinflight-'))
    const r = runDir(dir)
    const st = { check: 'exit 1', startedAt: now, ceilingMinutes: 720, maxRounds: 8, rounds: 0, run: r }
    writeFileSync(join(dir, 'work-hold-inflight.json'), JSON.stringify(st))
    const out = spawnSync('bun', [HOOK], {
      input: JSON.stringify({ session_id: 'inflight' }), encoding: 'utf8',
      env: { ...HERMETIC_ENV, TMPDIR: dir },
    })
    expect(out.status).toBe(0)
    expect(out.stdout.trim()).toBe('')                                  // no block
    expect(JSON.parse(readFileSync(join(dir, 'work-hold-inflight.json'), 'utf8')).rounds).toBe(0)
  })

  /** The clock does NOT stop for a run in flight, or an abandoned run would hold a session forever. */
  test('but the MINUTES ceiling still releases it, UNMET', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holdinflight-'))
    const r = runDir(dir)
    writeFileSync(join(dir, 'work-hold-expflight.json'), JSON.stringify({
      check: 'exit 1', startedAt: now - 3600, ceilingMinutes: 10, maxRounds: 8, rounds: 0, run: r,
    }))
    const out = spawnSync('bun', [HOOK], {
      input: JSON.stringify({ session_id: 'expflight' }), encoding: 'utf8',
      env: { ...HERMETIC_ENV, TMPDIR: dir },
    })
    expect(out.stderr).toContain('still in flight')
    expect(out.stderr).toContain('UNMET')
    expect(existsSync(join(dir, 'work-hold-expflight.json'))).toBe(false)
    expect(lastLedgerEntry(join(dir, 'work-hold-expflight.releases.log'))?.verb).toBe('expired')
  })

  test('a run that is NOT in flight blocks on a red check as it always did', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holdinflight-'))
    const r = runDir(dir, { result: '[{"overallPass":false}]' })
    writeFileSync(join(dir, 'work-hold-landed.json'), JSON.stringify({
      check: 'exit 1', startedAt: now, ceilingMinutes: 720, maxRounds: 8, rounds: 0, run: r,
    }))
    const out = spawnSync('bun', [HOOK], {
      input: JSON.stringify({ session_id: 'landed' }), encoding: 'utf8',
      env: { ...HERMETIC_ENV, TMPDIR: dir },
    })
    expect(JSON.parse(out.stdout).decision).toBe('block')
  })
})

/**
 * A CHECK-LESS hold is the judge alone on the goal — what a plan with no `args.goalCheck` gets. It
 * must never fail open: with no check there is no other evidence, so an unavailable judge BLOCKS
 * (bounded by the same two ceilings) rather than releasing on nothing.
 */
describe('a CHECK-LESS hold: Jev alone on the goal', () => {
  test('MET releases passed-goal-met, with no check named', async () => {
    const port = 18795
    const srv = stubDecisions(port, 0.97)
    await Bun.sleep(700)
    const r = passRun('cl-met', { check: '', goal: 'every suite is green' }, {
      WORK_HOLD_JUDGE_TOKEN: 'test-token',
      WORK_HOLD_DECISIONS_URL: `http://127.0.0.1:${port}/decisions`,
    })
    srv.kill()
    expect(r.entry?.verb).toBe(PASSED_GOAL_MET)
    expect(r.stderr).toContain('the classifier judged the goal MET')
    expect(r.stderr).not.toContain('exits 0')
  }, 30000)

  test('UNMET blocks, and the message names no check', async () => {
    const port = 18796
    const srv = stubDecisions(port, 0.03)
    await Bun.sleep(700)
    const r = passRun('cl-unmet', { check: '', goal: 'every suite is green' }, {
      WORK_HOLD_JUDGE_TOKEN: 'test-token',
      WORK_HOLD_DECISIONS_URL: `http://127.0.0.1:${port}/decisions`,
    })
    srv.kill()
    const out = JSON.parse(r.stdout)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('the goal is judged NOT met')
    expect(out.reason).not.toContain('exits 0')
    expect(r.entry).toBeNull()
  }, 30000)

  test('an UNAVAILABLE judge BLOCKS here — there is no check to fail open onto', () => {
    const r = passRun('cl-down', { check: '', goal: 'every suite is green' })
    expect(JSON.parse(r.stdout).decision).toBe('block')
    expect(JSON.parse(r.stdout).reason).toContain('judge unavailable')
    expect(r.entry).toBeNull()
  })

  test('and the ROUND ceiling releases it UNMET rather than blocking forever', () => {
    const r = passRun('cl-capped', { check: '', goal: 'every suite is green', rounds: 8, maxRounds: 8 })
    expect(r.entry?.verb).toBe('expired')
    expect(r.stderr).toContain('never judged')
    expect(r.stderr).toContain('UNMET')
  })

  test('a check-FUL hold still fails open on an unavailable judge', () => {
    const r = passRun('cl-checkful', { goal: 'every suite is green' })
    expect(r.entry?.verb).toBe(PASSED_UNJUDGED)
  })
})

describe('the Jev question asks for the goal AND nothing obvious left open', () => {
  const src = readFileSync(HOOK, 'utf8')

  test('the decision-model instructions carry both clauses', () => {
    expect(src).toContain('This goal is met AND no obvious open work remains that the session should do next')
  })

  test('the chat fallback prompt carries them too, and asks for the next-action case', () => {
    expect(src).toContain('MET its stated goal AND has no obvious open work')
    expect(src).toContain('named an obvious next action it has not taken')
  })
})

describe('--brief names the run and whether it is in flight', () => {
  const now = Math.floor(Date.now() / 1000)
  const brief = (st: object, dir: string) => {
    writeFileSync(join(dir, 'work-hold-b.json'), JSON.stringify({
      check: 'false', startedAt: now, ceilingMinutes: 720, maxRounds: 8, rounds: 0, ...st,
    }))
    return spawnSync('bun', [HOOK, '--brief'], {
      input: JSON.stringify({ session_id: 'b' }), encoding: 'utf8',
      env: { ...HERMETIC_ENV, TMPDIR: dir },
    }).stdout
  }

  test('in flight is said so, with the reason a stop was allowed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holdbrief-'))
    const out = brief({ run: runDir(dir) }, dir)
    expect(out).toContain('RUN: ')
    expect(out).toContain('IN FLIGHT')
    expect(out).toContain('counts no round')
  })

  test('a landed verdict is said so too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holdbrief-'))
    expect(brief({ run: runDir(dir, { result: '[{}]' }) }, dir)).toContain('not in flight')
  })

  test('no run, no RUN line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holdbrief-'))
    expect(brief({}, dir)).not.toContain('RUN: ')
  })

  test('a check-less hold says the judge is the whole hold', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holdbrief-'))
    expect(brief({ check: '', goal: 'g' }, dir)).toContain('CHECK: none')
  })
})

describe('the ledger readers handle the new verbs', () => {
  test('lastLedgerEntry returns them, and still reads `capped` lines through', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holdledger-'))
    const log = join(dir, 'work-hold-x.releases.log')
    writeFileSync(log,
      `2026-09-26T00:00:00\tarmed\t{"check":"false"}\n` +
      `2026-09-26T00:00:01\t${PASSED_GOAL_MET}\tbun test\n` +
      `2026-09-26T00:00:02\tcapped\t{"path":"/x","window":250000}\n`)
    expect(lastLedgerEntry(log)).toEqual({ verb: PASSED_GOAL_MET, payload: 'bun test' })
  })

  test('ledgerPath sits beside statePath, per session', () => {
    expect(ledgerPath('a')).not.toBe(ledgerPath('b'))
    expect(ledgerPath('a')).toBe(statePath('a').replace(/\.json$/, '.releases.log'))
  })

  test('a hold abandoned by the user is INERT, not restored on the next Stop', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holdledger-'))
    writeFileSync(join(dir, 'work-hold-aband.releases.log'),
      `2026-09-27T00:00:00\tarmed\t{"check":"false","startedAt":1,"ceilingMinutes":720,"maxRounds":8,"rounds":0}\n` +
      `2026-09-27T00:00:01\t${ABANDONED}\tthe user walked away\n`)
    const r = spawnSync('bun', [HOOK], {
      input: JSON.stringify({ session_id: 'aband' }), encoding: 'utf8',
      env: { ...HERMETIC_ENV, TMPDIR: dir },
    })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('')
    expect(existsSync(join(dir, 'work-hold-aband.json'))).toBe(false)
  })

  // The restore-on-delete rule reads the last entry's verb: a PASSING verb must not look like an
  // arm, or a released hold would be resurrected on the next Stop.
  test('a state file gone after `passed-goal-met` stays gone — the hook is inert, not restoring', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holdledger-'))
    writeFileSync(join(dir, 'work-hold-gone.releases.log'),
      `2026-09-26T00:00:00\tarmed\t{"check":"false","startedAt":1,"ceilingMinutes":720,"maxRounds":8,"rounds":0}\n` +
      `2026-09-26T00:00:01\t${PASSED_GOAL_MET}\tfalse\n`)
    const r = spawnSync('bun', [HOOK], {
      input: JSON.stringify({ session_id: 'gone' }), encoding: 'utf8',
      env: { ...HERMETIC_ENV, TMPDIR: dir },
    })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('')
    expect(existsSync(join(dir, 'work-hold-gone.json'))).toBe(false)
  })
})

// ------------------------------------------------- how a WATCHED run is advanced after a failed round
//
// `work-dispatch.sh` re-runs EVERY task; `work-redispatch.sh` re-runs only the tasks that flagged
// plus their transitive dependents and carries the rest. A session under a hold reaches for the one
// it was told to run, so the hold says which — once, where the clauses are said.

describe('the redispatch sentence, for a hold armed with --run', () => {
  const landed = (o: object = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'holdrun-'))
    const runDir = join(dir, 'run')
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, 'args.json'), JSON.stringify({ planPath: '/p/PLAN.md', ...o }))
    writeFileSync(join(runDir, 'result.json'), JSON.stringify({ verdict: 'FAIL' }))
    return { dir, runDir }
  }

  test('is empty when the hold watches no run', () => {
    expect(redispatchLine({})).toBe('')
  })

  test('names work-redispatch.sh with the plan from args.json and the run’s own args path', () => {
    const { runDir } = landed()
    const line = redispatchLine({ run: runDir })
    expect(line).toContain(`work-redispatch.sh /p/PLAN.md ${join(runDir, 'args.json')} --dispatch`)
    expect(line).toContain('only the tasks that flagged and their dependents')
    // and it says what NOT to run, which is the reach a session actually has
    expect(line).toContain('not a fresh work-dispatch.sh, which re-runs every task')
    expect(line.split('\n').length).toBe(1)
  })

  test('falls back to a placeholder plan when the args cannot be read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holdrun-'))
    expect(redispatchLine({ run: dir })).toContain('work-redispatch.sh <plan.md>')
  })

  test('the FIRST counted block carries it, and a later block does not', () => {
    const { runDir } = landed()
    const held = (rounds: number) => ({
      check: 'exit 1', run: runDir, startedAt: Math.floor(Date.now() / 1000),
      ceilingMinutes: 720, maxRounds: 8, rounds,
      authority: 'AUTHORITY CLAUSE', continuation: 'CONTINUATION CLAUSE',
    })
    const first = JSON.parse(run({}, held(0)).stdout).reason
    expect(first).toContain('work-redispatch.sh /p/PLAN.md')
    const later = JSON.parse(run({}, held(1)).stdout).reason
    expect(later).not.toContain('work-redispatch.sh')
  })

  test('--brief carries it too, which is where a compacted session re-reads it', () => {
    const { dir, runDir } = landed()
    writeFileSync(join(dir, 'work-hold-test-session.json'), JSON.stringify({
      check: 'exit 1', run: runDir, startedAt: Math.floor(Date.now() / 1000),
      ceilingMinutes: 720, maxRounds: 8, rounds: 3,
      authority: 'AUTHORITY CLAUSE', continuation: 'CONTINUATION CLAUSE',
    }))
    const r = spawnSync('bun', [HOOK, '--brief'], {
      input: JSON.stringify({ session_id: 'test-session' }),
      encoding: 'utf8', env: { ...HERMETIC_ENV, TMPDIR: dir },
    })
    expect(r.stdout).toContain('work-redispatch.sh /p/PLAN.md')
  })

  test('a hold with no run says nothing about redispatching', () => {
    const r = run({}, {
      check: 'exit 1', startedAt: Math.floor(Date.now() / 1000),
      ceilingMinutes: 720, maxRounds: 8, rounds: 0, authority: 'A', continuation: 'C',
    })
    expect(JSON.parse(r.stdout).reason).not.toContain('work-redispatch.sh')
  })
})

// ------------------------------------------------- the continuation clause names the hold's own instrument

describe('work-hold.sh composes the continuation clause per mode', () => {
  const ARM = join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'work-hold.sh')

  const arm = (argv: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'holdcont-'))
    const sid = `cont-${Math.random().toString(36).slice(2)}`
    const r = spawnSync('bash', [ARM, ...argv], {
      encoding: 'utf8', cwd: dir,
      env: { ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: sid, WORK_HOLD_COMPACT_WINDOW: '0' },
    })
    const state = join(dir, `work-hold-${sid}.json`)
    return { ...r, state, json: existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : null }
  }

  test('a check-ful hold still opens on the failing check', () => {
    const a = arm(['exit 1', '--goal', 'ship the thing'])
    expect(a.status).toBe(0)
    expect(a.json.continuation).toStartWith('A failing check is not a stopping point:')
  })

  test('a CHECK-LESS hold speaks about the goal — there is no check to fail', () => {
    const a = arm(['--goal', 'ship the thing'])
    expect(a.status).toBe(0)
    expect(a.json.check).toBe('')
    expect(a.json.continuation).toStartWith('An unmet goal is not a stopping point: take the next action in the same turn.')
    expect(a.json.continuation).not.toContain('failing check')
  })

  test('both modes keep GOAL_CONTINUATION_TAIL', () => {
    const tail = 'Report at the ceiling, not at the first stopping point.'
    expect(arm(['exit 1', '--goal', 'g']).json.continuation).toEndWith(tail)
    expect(arm(['--goal', 'g']).json.continuation).toEndWith(tail)
  })
})
