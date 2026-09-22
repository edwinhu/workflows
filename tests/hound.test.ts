import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  decide, statePath, parseJudgeVerdict, parseNoul,
  transcriptContext, renderHistory, pushRound,
} from '../hooks/hound'

const HOOK = join(import.meta.dir, '..', 'hooks', 'hound.ts')

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
    expect(d.reason).toContain('rather than proposing it')
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
  const dir = mkdtempSync(join(tmpdir(), 'hound-'))
  const sid = 'test-session'
  if (st) writeFileSync(join(dir, `hound-${sid}.json`), JSON.stringify(st))
  const r = spawnSync('bun', [HOOK], {
    input: JSON.stringify({ session_id: sid, ...payload }),
    encoding: 'utf8', env: { ...process.env, TMPDIR: dir },
  })
  return { ...r, dir, path: join(dir, `hound-${sid}.json`) }
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
    expect(r.stderr).toContain('objective met')
  })

  test('an unreadable state file releases rather than holds on unreadable terms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hound-'))
    writeFileSync(join(dir, 'hound-test-session.json'), '{not json')
    const r = spawnSync('bun', [HOOK], {
      input: JSON.stringify({ session_id: 'test-session' }),
      encoding: 'utf8', env: { ...process.env, TMPDIR: dir },
    })
    expect(r.status).toBe(0)
    expect(existsSync(join(dir, 'hound-test-session.json'))).toBe(false)
  })

  test('statePath is per SESSION, so arming one does not hold another', () => {
    expect(statePath('a')).not.toBe(statePath('b'))
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

// ------------------------------------------------- arming warns about an uncapped context window

describe('hound-arm.sh and the auto-compact cap', () => {
  const ARM = join(import.meta.dir, '..', 'skills', 'hound', 'scripts', 'hound-arm.sh')

  // No herdr on PATH here, so the cap cannot reach a pane -- which is the point: arming must still
  // succeed and say what to do by hand. The opt-outs are asserted on the line they print.
  function arm(extra: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'houndarm-'))
    const env: Record<string, string> = {
      ...process.env, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: 'arm-cap-test',
      HOUND_HERDR: '/nonexistent-herdr', HOUND_SETTLE_MS: '0',
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
    expect(existsSync(join(r.dir, 'hound-arm-cap-test.json'))).toBe(true)
  })

  test('HOUND_COMPACT_WINDOW=0 opts out', () => {
    expect(arm({ HOUND_COMPACT_WINDOW: '0' }).stdout).toContain('not capped')
  })

  test('CLAUDE_CODE_AUTO_COMPACT_WINDOW wins, so the cap stands down', () => {
    const r = arm({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '400000' })
    expect(r.stdout).toContain('CLAUDE_CODE_AUTO_COMPACT_WINDOW is set')
    expect(r.status).toBe(0)
  })
})
