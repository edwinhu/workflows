import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { decide, statePath, parseJudgeVerdict } from '../hooks/hound'

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
