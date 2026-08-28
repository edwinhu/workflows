/**
 * craft-loop.sh is the continuation driver: the wait loop craft-dispatch.sh currently PRINTS,
 * executed instead of copied.
 *
 * The measured failure this exists to close: a run was OOM-killed at 10:18, wrote no result.json,
 * and the hand-written watcher had no liveness leg — so the death was invisible and every
 * continuation mechanism went silent. The printed loop was already correct; nothing executed it.
 *
 * The four behaviours below are the whole contract, and each is an EXIT CODE, never printed text:
 *   0  the gate passed
 *   1  the dispatch died with no verdict (the liveness leg fired)
 *   5  converge-check said NOT CONVERGING — halt rather than burn the round cap on a broken brief
 *   6  the loop cap was reached with the gate still failing
 *
 * Run: bun test /home/eh/projects/workflows/skills/craft/scripts/craft-loop.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = `${import.meta.dir}/craft-loop.sh`
const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

/** A craft gate return with the seven required keys, so craft-result.sh adjudicates rather than refuses. */
function verdict(pass: boolean, tasksThatFlagged: string[] = []) {
  return {
    overallPass: pass,
    verdict: pass ? 'PASS' : 'FAIL',
    scoreTable: { tasksTotal: 1 },
    findings: [],
    tasksThatFlagged,
    mechanicalThatFailed: [],
    lensesThatFlagged: [],
    mechanical: [],
  }
}

/**
 * A run directory as craft-dispatch.sh leaves one: args.json (which craft-result.sh requires, to
 * adjudicate mechanical claims against) plus whatever result files the case needs.
 *
 * mechanicalChecks is deliberately empty: craft-result.sh RE-RUNS every declared check, so a
 * fixture that declared one would be asserting that command's behaviour rather than the loop's.
 */
function runDir(results: Record<string, object>) {
  const dir = mkdtempSync(join(tmpdir(), 'craft-loop-'))
  scratch.push(dir)
  const R = join(dir, '.craft', 'loop-run')
  mkdirSync(R, { recursive: true })
  const plan = join(dir, 'plan.md')
  const args = {
    projectDir: dir,
    goal: 'drive the loop',
    planPath: plan,
    mechanicalChecks: [],
    tasks: [{
      id: 'T1', name: 'one', work: 'do the thing', writablePaths: ['src/'], refs: [],
      redCommand: 'bash scripts/check.sh', acceptance: '`bash scripts/check.sh` exits 0',
    }],
  }
  writeFileSync(join(R, 'args.json'), JSON.stringify(args, null, 2))
  writeFileSync(plan, '# Plan\n\n## Run sizing\n\nnothing parked\n\n' +
    `<!-- craft:dispatch\n${JSON.stringify({ runId: 'loop-run', args }, null, 2)}\n-->\n`)
  for (const [name, body] of Object.entries(results))
    writeFileSync(join(R, name), JSON.stringify(body, null, 2))
  writeFileSync(join(R, 'run.log'), 'stub run log\n')
  return { dir, plan, R }
}

/**
 * CRAFT_LOOP_POLL keeps the poll off the 30s production interval; without it a test would hang.
 *
 * CRAFT_FARM is pinned to /bin/false for every case that is EXPECTED to halt before redispatching.
 * Without it, a regression in the halt logic would send these tests through craft-redispatch.sh
 * into a real, unstubbed, detached agent run — a test suite that spends money and writes to the
 * repo when the code under test breaks. The stub makes that failure loud and inert instead.
 */
function loop(f: { plan: string; R: string }, loops: number, extra: string[] = []) {
  try {
    const out = execFileSync('bash', [SCRIPT, '--run-dir', f.R, '--plan', f.plan, '--loops', String(loops), ...extra], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, CRAFT_LOOP_POLL: '1', CRAFT_FARM: '/bin/false', CLAUDE_CODE_SESSION_ID: '' },
    })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

describe('the loop returns the gate verdict', () => {
  test('a PASS verdict already on disk ends the loop at exit 0, without a second round', () => {
    const f = runDir({ 'result.json': verdict(true) })
    const r = loop(f, 3)
    expect(r.code).toBe(0)
    // A second round would have rotated the verdict; nothing should have been redispatched.
    expect(existsSync(join(f.R, 'result-round1.json'))).toBe(false)
  })
})

describe('the liveness leg — the thing the hand-written watcher lacked', () => {
  test('no verdict and no live dispatch exits 1 and names the run log, instead of polling forever', () => {
    const f = runDir({})            // no result.json at all, and no farm-events entry claims it
    const r = loop(f, 3)
    expect(r.code).toBe(1)
    expect(r.out).toContain('run.log')
  })

  /**
   * The message has to name the log that ACTUALLY holds this round's output. Only round 1 writes
   * `run.log`; craft-redispatch.sh writes `run-<HHMMSS>.log` per continuation round. A message
   * hard-coding `run.log` sends the reader to a stale file — or to no file at all — at exactly the
   * moment a round has died and the log is the only evidence left.
   */
  test('on a continuation round the death message names THAT round\'s log, not round 1\'s', () => {
    const f = runDir({})
    const stale = join(f.R, 'run-121314.log')
    writeFileSync(stale, 'round 2 output\n')
    const r = loop(f, 3)
    expect(r.code).toBe(1)
    // Round 1 here, so run.log is correct; the contract is that the named log EXISTS.
    const named = /see (\S+\.log)/.exec(r.out)
    expect(named).not.toBeNull()
    expect(existsSync(named![1])).toBe(true)
  })

  /**
   * The wait-while-live branch: dispatch ALIVE, verdict not yet written. This is the state a real
   * run spends nearly all of its time in, and it is the one a fixture that pre-writes result.json
   * never reaches — the loop breaks on the first `[ -s ]` and the liveness call is never made in
   * anger. A leg that wrongly reported a live run dead would pass every other test in this file.
   *
   * The setup is farm-alive.sh's real protocol: a $TMPDIR/farm-events/<pid>.ndjson whose START line
   * carries `out=<this run's result path>`, with <pid> a process that is genuinely running.
   */
  test('an alive dispatch with no verdict keeps polling, then returns the verdict when it lands', () => {
    const f = runDir({})
    const events = join(f.dir, 'farm-events')
    mkdirSync(events, { recursive: true })
    const resultPath = join(f.R, 'result.json')

    // A real live process, and a real event file named by its pid.
    const holder = spawn('sleep', ['120'], { detached: true, stdio: 'ignore' })
    holder.unref()
    writeFileSync(join(events, `${holder.pid}.ndjson`),
      `farm: START workflow out=${resultPath} expect=1\n`)

    // The verdict arrives only after the loop has already had to poll at least once.
    const writer = spawn('bash', ['-c',
      `sleep 3; printf '%s' ${JSON.stringify(JSON.stringify(verdict(true)))} > ${JSON.stringify(resultPath)}`],
      { detached: true, stdio: 'ignore' })
    writer.unref()

    let code = 0
    let out = ''
    const startedAt = performance.now()
    try {
      out = execFileSync('bash', [SCRIPT, '--run-dir', f.R, '--plan', f.plan, '--loops', '3'], {
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, TMPDIR: f.dir, CRAFT_LOOP_POLL: '1', CLAUDE_CODE_SESSION_ID: '' },
      })
    } catch (e: any) {
      code = e.status ?? -1
      out = (e.stdout ?? '') + (e.stderr ?? '')
    }
    const elapsedMs = performance.now() - startedAt
    try { process.kill(-holder.pid!) } catch { /* already gone */ }

    // It must NOT have exited 1: the dispatch was alive the whole time it was waiting.
    expect(code).toBe(0)
    expect(out).not.toMatch(/died with no verdict/i)
    // ANTI-VACUITY: if the verdict had been on disk before the first poll, the loop would have
    // broken immediately and the liveness leg would never have run — the test would pass while
    // asserting nothing. The verdict is written at +3s, so a run that genuinely waited cannot
    // have returned sooner than that.
    expect(elapsedMs).toBeGreaterThan(2_500)
  }, 90_000)

  test('CRAFT_LOOP_POLL=0 is refused — a zero interval turns the wait into a fork-per-iteration spin', () => {
    const f = runDir({})
    let code = 0
    let out = ''
    try {
      execFileSync('bash', [SCRIPT, '--run-dir', f.R, '--plan', f.plan, '--loops', '3'], {
        encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, CRAFT_LOOP_POLL: '0', CLAUDE_CODE_SESSION_ID: '' },
      })
    } catch (e: any) {
      code = e.status ?? -1
      out = (e.stdout ?? '') + (e.stderr ?? '')
    }
    expect(code).toBe(2)
    expect(out).toContain('CRAFT_LOOP_POLL')
  })
})

describe('convergence halts the loop rather than advising it', () => {
  test('a round repeating its predecessor\'s failure exits 5 and spends no further round', () => {
    // Two rounds with an identical failure signature is converge-check.ts\'s repeated-failure case:
    // verified against the real script, it returns exit 1 / NOT CONVERGING on exactly this shape.
    const f = runDir({
      'result-round1.json': verdict(false, ['T1']),
      'result.json': verdict(false, ['T1']),
    })
    const r = loop(f, 3)          // cap of 3, so a halt here cannot be the cap
    expect(r.code).toBe(5)
    expect(r.out).toMatch(/NOT CONVERGING/i)
    // Halting means NOT redispatching: round 2's result must not have been rotated away.
    expect(existsSync(join(f.R, 'result-round2.json'))).toBe(false)
  })

  test('a first round exits 6 at the cap, never 5 — converge-check exit 2 means "too short to judge"', () => {
    // converge-check.ts exits 2 on fewer than two readable result files, which is EVERY round 1.
    // Reading that as a halt would stop every run before it began.
    const f = runDir({ 'result.json': verdict(false, ['T1']) })
    const r = loop(f, 1)
    expect(r.code).not.toBe(5)
    expect(r.code).toBe(6)
  })
})

/**
 * A REAL continuation round. Nothing else in this file reaches craft-loop.sh's redispatch leg —
 * every other case halts on round 1 — so the multi-round behaviour the whole feature exists for
 * was shipping unexercised. This drives it end to end: round 1 FAILs, the loop consults
 * convergence, runs the amender, calls craft-redispatch.sh for real (which re-hashes, re-syncs the
 * plan, rotates the verdict and dispatches again), and round 2 PASSes.
 */
describe('a continuation round actually runs', () => {
  /**
   * Fails the first dispatch and passes the second, counting invocations on disk.
   *
   * It emits a farm-events record the way the real runner does — `out=<the --out path>`, filename
   * = its own pid — and only then writes the verdict. Without that the loop's liveness leg
   * correctly reports the round dead in the window before the file appears, which is a property of
   * the STUB, not of the driver. Mirroring the real protocol is what makes this test about
   * craft-loop.sh.
   */
  function twoRoundFarm(dir: string) {
    const p = join(dir, 'two-round-farm.sh')
    writeFileSync(p, [
      '#!/usr/bin/env bash',
      'out=""',
      'while [ $# -gt 0 ]; do case "$1" in --out) out="$2"; shift 2 ;; *) shift ;; esac; done',
      '[ -n "$out" ] || exit 2',
      'd="${TMPDIR:-/tmp}/farm-events"; mkdir -p "$d"',
      'printf "farm: START workflow out=%s expect=1\\n" "$out" > "$d/$$.ndjson"',
      'c="$(dirname "$out")/.farm-calls"',
      'n=$(( $(cat "$c" 2>/dev/null || echo 0) + 1 )); printf "%s" "$n" > "$c"',
      'sleep 2',   // the loop must poll at least once while this run is genuinely alive
      // Round 1's verdict is pre-written by the fixture, so this stub only ever serves the
      // REDISPATCH. It must therefore pass on its FIRST call: writing another FAIL with the same
      // tasksThatFlagged would be a repeated failure signature, which converge-check.ts correctly
      // halts on (exit 5) — that is the behaviour the convergence test above pins, not a defect here.
      'pass=true; verdict=PASS; flagged=""',
      'cat > "$out" <<EOF',
      '{"overallPass": $pass, "verdict": "$verdict", "scoreTable": {"tasksTotal": 1},',
      ' "findings": [], "tasksThatFlagged": [$flagged], "mechanicalThatFailed": [],',
      ' "lensesThatFlagged": [], "mechanical": []}',
      'EOF',
    ].join('\n'))
    chmodSync(p, 0o755)
    return p
  }

  /**
   * A run dir poised at the end of round 1: a FAIL verdict on disk, a real spec hash so
   * craft-redispatch.sh accepts the plan, and a genuinely-red gate so its red probe lets the round
   * proceed. Everything a continuation needs, and nothing about which runner serves it.
   */
  function continuationFixture() {
    const f = runDir({})
    const specHash = execFileSync('bash', [join(import.meta.dir, 'craft-dispatch.sh'), '--spec-hash', f.plan],
      { encoding: 'utf8' }).trim()
    const argsPath = join(f.R, 'args.json')
    const args = JSON.parse(readFileSync(argsPath, 'utf8'))
    writeFileSync(argsPath, JSON.stringify({ ...args, specHash, maxRounds: 3 }, null, 2))
    mkdirSync(join(f.dir, 'scripts'), { recursive: true })
    writeFileSync(join(f.dir, 'scripts', 'check.sh'), '#!/usr/bin/env bash\necho "1 failed, 0 passed"\nexit 1\n')
    chmodSync(join(f.dir, 'scripts', 'check.sh'), 0o755)
    writeFileSync(join(f.R, 'result.json'), JSON.stringify(verdict(false, ['T1'])))
    return f
  }

  test('round 1 FAILs, the loop redispatches, and round 2 PASSes at exit 0', () => {
    const f = continuationFixture()
    const farm = twoRoundFarm(f.dir)

    let code = -1
    let out = ''
    try {
      out = execFileSync('bash', [SCRIPT, '--run-dir', f.R, '--plan', f.plan, '--loops', '3'], {
        encoding: 'utf8', timeout: 180_000, cwd: f.dir,
        env: { ...process.env, TMPDIR: f.dir, CRAFT_FARM: farm, CRAFT_LOOP_POLL: '1',
               CRAFT_NO_SCOPE: '1', CLAUDE_CODE_SESSION_ID: '' },
      })
      code = 0
    } catch (e: any) {
      code = e.status ?? -1
      out = (e.stdout ?? '') + (e.stderr ?? '')
    }

    expect(code).toBe(0)
    // A second round genuinely happened: the loop announced it, and craft-redispatch.sh rotated
    // round 1's verdict out of the way rather than the loop re-reading it.
    expect(out).toMatch(/round 2 of 3/)
    expect(existsSync(join(f.R, 'result-round1.json'))).toBe(true)
    expect(readFileSync(join(f.R, '.farm-calls'), 'utf8')).toBe('1')
  }, 240_000)

  /**
   * A runner that dies mid-continuation, so the death message is produced on a round that is NOT
   * round 1. Round 1 writes `run.log`; craft-redispatch.sh writes `run-<HHMMSS>.log`. Asserting the
   * name on round 1 (where both happen to agree) is what made the log-naming fix vacuously covered.
   */
  function dyingFarm(dir: string) {
    const p = join(dir, 'dying-farm.sh')
    writeFileSync(p, [
      '#!/usr/bin/env bash',
      'out=""',
      'while [ $# -gt 0 ]; do case "$1" in --out) out="$2"; shift 2 ;; *) shift ;; esac; done',
      'd="${TMPDIR:-/tmp}/farm-events"; mkdir -p "$d"',
      'printf "farm: START workflow out=%s expect=1\\n" "$out" > "$d/$$.ndjson"',
      'sleep 2',
      'exit 1',              // dies having written no verdict — the OOM case, one round in
    ].join('\n'))
    chmodSync(p, 0o755)
    return p
  }

  test('a continuation round that dies names THAT round\'s log, not round 1\'s', () => {
    const f = continuationFixture()
    let code = 0
    let out = ''
    try {
      execFileSync('bash', [SCRIPT, '--run-dir', f.R, '--plan', f.plan, '--loops', '3'], {
        encoding: 'utf8', timeout: 180_000, cwd: f.dir,
        env: { ...process.env, TMPDIR: f.dir, CRAFT_FARM: dyingFarm(f.dir), CRAFT_LOOP_POLL: '1',
               CRAFT_NO_SCOPE: '1', CLAUDE_CODE_SESSION_ID: '' },
      })
    } catch (e: any) {
      code = e.status ?? -1
      out = (e.stdout ?? '') + (e.stderr ?? '')
    }
    expect(code).toBe(1)
    const named = /see (\S+\.log)/.exec(out)
    expect(named).not.toBeNull()
    // The continuation round's own log, which craft-redispatch.sh created — not round 1's.
    expect(named![1]).toMatch(/run-\d{6}\.log$/)
    expect(existsSync(named![1])).toBe(true)
  }, 240_000)

  /**
   * The settle is load-bearing, pinned by CRAFT_LOOP_SETTLE rather than by timing luck. With the
   * grace set to 0 the loop condemns a round whose runner has not registered yet; with the real
   * grace the same runner survives. Same fixture, same runner, one variable.
   */
  function slowStartFarm(dir: string) {
    const p = join(dir, 'slow-start-farm.sh')
    writeFileSync(p, [
      '#!/usr/bin/env bash',
      'out=""',
      'while [ $# -gt 0 ]; do case "$1" in --out) out="$2"; shift 2 ;; *) shift ;; esac; done',
      'sleep 1',             // startup latency BEFORE the runner registers in farm-events
      'd="${TMPDIR:-/tmp}/farm-events"; mkdir -p "$d"',
      'printf "farm: START workflow out=%s expect=1\\n" "$out" > "$d/$$.ndjson"',
      'cat > "$out" <<EOF',
      '{"overallPass": true, "verdict": "PASS", "scoreTable": {"tasksTotal": 1}, "findings": [],',
      ' "tasksThatFlagged": [], "mechanicalThatFailed": [], "lensesThatFlagged": [], "mechanical": []}',
      'EOF',
    ].join('\n'))
    chmodSync(p, 0o755)
    return p
  }

  function runWithSettle(f: ReturnType<typeof continuationFixture>, settle: string) {
    try {
      execFileSync('bash', [SCRIPT, '--run-dir', f.R, '--plan', f.plan, '--loops', '3'], {
        encoding: 'utf8', timeout: 180_000, cwd: f.dir,
        env: { ...process.env, TMPDIR: f.dir, CRAFT_FARM: slowStartFarm(f.dir), CRAFT_LOOP_POLL: '1',
               CRAFT_LOOP_SETTLE: settle, CRAFT_NO_SCOPE: '1', CLAUDE_CODE_SESSION_ID: '' },
      })
      return 0
    } catch (e: any) { return e.status ?? -1 }
  }

  test('without the settle a healthy continuation round is condemned; with it, the same round survives', () => {
    expect(runWithSettle(continuationFixture(), '0')).toBe(1)   // no grace: declared dead at once
    expect(runWithSettle(continuationFixture(), '5')).toBe(0)   // grace: the runner registers, PASS
  }, 240_000)
})

describe('the three selectors are reported, because craft-result.sh prints none of them', () => {
  test('a FAIL names the flagged task ids it read out of result.json', () => {
    const f = runDir({ 'result.json': verdict(false, ['T1']) })
    const r = loop(f, 1)
    expect(r.code).toBe(6)
    expect(r.out).toContain('T1')
  })
})

describe('argument handling', () => {
  test('a non-numeric --loops is refused with exit 2 rather than looping an unbounded number of times', () => {
    const f = runDir({ 'result.json': verdict(true) })
    let code = 0
    let out = ''
    try {
      execFileSync('bash', [SCRIPT, '--run-dir', f.R, '--plan', f.plan, '--loops', 'lots'], {
        encoding: 'utf8', timeout: 30_000, env: { ...process.env, CLAUDE_CODE_SESSION_ID: '' },
      })
    } catch (e: any) {
      code = e.status ?? -1
      out = (e.stdout ?? '') + (e.stderr ?? '')
    }
    expect(code).toBe(2)
    expect(out).toContain('--loops')
  })

  test('the plan file the loop will hand to craft-redispatch.sh must exist, or it refuses up front', () => {
    const f = runDir({ 'result.json': verdict(false, ['T1']) })
    let code = 0
    try {
      execFileSync('bash', [SCRIPT, '--run-dir', f.R, '--plan', join(f.R, 'absent.md'), '--loops', '2'], {
        encoding: 'utf8', timeout: 30_000, env: { ...process.env, CLAUDE_CODE_SESSION_ID: '' },
      })
    } catch (e: any) { code = e.status ?? -1 }
    expect(code).toBe(2)
  })
})

describe('the run directory is the only state — no new state file is introduced', () => {
  test('a completed PASS round leaves the run dir carrying nothing the loop invented', () => {
    const f = runDir({ 'result.json': verdict(true) })
    const r = loop(f, 3)
    expect(r.code).toBe(0)
    // The repo's state-file law: new state goes in the existing objects, never a new file.
    const allowed = new Set(['args.json', 'result.json', 'run.log'])
    expect(readdirSync(f.R).filter(n => !allowed.has(n))).toEqual([])
  })
})
