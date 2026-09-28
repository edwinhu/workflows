/**
 * Phase 3 arms the HOLD in this session, and the WAKE is the farm-runs monitor.
 *
 * The hold lives in the dispatching (main) session: it survives a run that dies, and the judge rules
 * on the user's own objective rather than on a round verdict. `--run` is what makes a stop legal
 * while the round is in flight. The cron is a FALLBACK POLL and is printed only when asked for —
 * AGK 2026-09-27, a cron woke the session 14 times inside one round while the monitor already had it.
 *
 * Run: bun test /home/eh/projects/workflows/tests/dispatch-hold-and-heartbeat.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'

const REPO = join(import.meta.dir, '..')
const SKILL = join(REPO, 'skills/work')
const DISPATCH = join(SKILL, 'scripts/work-dispatch.sh')
const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

function script(dir: string, name: string, body: string) {
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  const p = join(dir, 'scripts', name)
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}

/** A lint-clean plan whose one task carries a genuinely-red gate, so no probe tier refuses. */
function fixture(extraArgs: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hold-heartbeat-'))
  scratch.push(dir)
  mkdirSync(join(dir, 'src'), { recursive: true })
  script(dir, 'check.sh', 'echo "1 failed, 0 passed"\nexit 1')
  const plan = join(dir, 'plan.md')
  const args = {
    projectDir: dir,
    goal: 'make the thing right',
    maxRounds: 4,
    mechanicalChecks: [],
    reviewLenses: [{ key: 'k', agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' }],
    ...extraArgs,
    tasks: [{
      id: 'T1', name: 'one', work: 'do the thing', writablePaths: ['src/'], refs: [],
      redCommand: 'bash scripts/check.sh', acceptance: '`bash scripts/check.sh` exits 0',
    }],
  }
  writeFileSync(plan, '# Plan\n\n## Run sizing\n\nnothing parked\n\n' +
    `<!-- work:dispatch\n${JSON.stringify({ runId: 'hb-run', args }, null, 2)}\n-->\n`)
  return { dir, plan, runDir: join(dir, '.work', 'hb-run') }
}

/**
 * A real dispatch, with a real (fabricated) session id and a private TMPDIR — so work-hold.sh
 * writes a real state file this test can read, and cannot touch the hold of the live session
 * running the suite. WORK_FARM is stubbed so nothing is farmed out for real.
 */
function dispatch(
  f: { dir: string; plan: string },
  extraEnv: Record<string, string> = {},
  extraArgs: string[] = [],
) {
  const sid = `hb-test-${Math.random().toString(36).slice(2)}`
  const tmp = mkdtempSync(join(tmpdir(), 'hold-tmpdir-'))
  scratch.push(tmp)
  const farm = script(f.dir, 'stub-farm.sh', 'exit 0')
  try {
    const out = execFileSync('bash', [DISPATCH, '--loops', '0', ...extraArgs, f.plan], {
      encoding: 'utf8', timeout: 180_000, cwd: f.dir,
      env: {
        ...HERMETIC_ENV, CLAUDE_CODE_SESSION_ID: sid, TMPDIR: tmp,
        WORK_NO_SCOPE: '1', WORK_FARM: farm, ...extraEnv,
      },
    })
    return { code: 0, out, sid, tmp }
  } catch (e: any) {
    return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? ''), sid, tmp }
  }
}

describe('the self-send transport is gone, not merely unused', () => {
  /**
   * TRACKED files only. `.work/` run artifacts, `scratch/` and stale worktrees under
   * `.claude/worktrees/` are gitignored records of what the transport DID, and rewriting history
   * is not what deleting a mechanism means — but a tracked file naming a script that no longer
   * exists is a dangling reference, and that is what this asserts against.
   */
  test('no tracked file names it, save the CHANGELOG that records its removal', () => {
    const tracked = execFileSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf8' })
      .split('\n').filter(Boolean)
    const offenders = tracked.filter(rel =>
      rel !== 'CHANGELOG.md' && rel !== 'tests/dispatch-hold-and-heartbeat.test.ts'
      && /\.(sh|ts|js|mjs|md|json)$/.test(rel)
      && readFileSync(join(REPO, rel), 'utf8').includes('goal-self-send'))
    expect(offenders).toEqual([])
  })

  test('work-dispatch.sh queues nothing and names no drainer', () => {
    const s = readFileSync(DISPATCH, 'utf8')
    expect(s).not.toMatch(/goal-send-drain|agent-msg|herdr agent prompt/)
  })
})

/** The state file a dispatch armed, parsed. */
function holdState(r: { tmp: string; sid: string }): any {
  const p = join(r.tmp, `work-hold-${r.sid}.json`)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}

/**
 * HALF ONE: THE HOLD, armed in the DISPATCHING session.
 *
 * Not in the farmed child, which runs one workflow.js and exits, and not on the round verdict —
 * `hold-lint.ts` refuses that as CRITICAL, because a verdict goes green on a FAIL the loop was going
 * to fix and outlives a run the user abandons. What is armed is the plan's own `args.goalCheck`, or
 * with none, the judge alone on `args.goal`.
 */
describe('half one: the HOLD is armed by the dispatch, in this session', () => {
  const f = fixture()
  const r = dispatch(f)

  test('the dispatch succeeds', () => {
    expect(`code ${r.code}\n${r.out}`).toStartWith('code 0')
  })

  test('a state file exists for THIS session, with a ledger beside it', () => {
    expect(existsSync(join(r.tmp, `work-hold-${r.sid}.json`))).toBe(true)
    expect(readFileSync(join(r.tmp, `work-hold-${r.sid}.releases.log`), 'utf8')).toContain('armed')
  })

  test('the plan states no goalCheck, so the hold is CHECK-LESS: the judge alone on args.goal', () => {
    const s = holdState(r)
    expect(s.check).toBe('')
    expect(s.goal).toBe('make the thing right')
    expect(r.out).toContain('ARMED check-less')
  })

  /** `--run` is the whole in-flight rule: without it every stop mid-round would block. */
  test('it records the RUN DIR, absolute, so the hook can see a round in flight', () => {
    expect(holdState(r).run).toBe(f.runDir)
  })

  test('the ceilings are the plan maxRounds and compose-goal.sh --minutes', () => {
    const minutes = execFileSync('bash', [join(SKILL, 'scripts/compose-goal.sh'), '--minutes'],
      { encoding: 'utf8' }).trim()
    const s = holdState(r)
    expect(s.maxRounds).toBe(4)
    expect(s.ceilingMinutes).toBe(Number(minutes))
  })

  test('a plan that DOES state args.goalCheck arms on that command', () => {
    const f = fixture({ goalCheck: 'bash scripts/check.sh' })
    const g = dispatch(f)
    expect(holdState(g).check).toBe('bash scripts/check.sh')
    expect(g.out).toContain('ARMED on `bash scripts/check.sh`')
  }, 60_000)

  /**
   * ARMING NEVER ABORTS A DISPATCH. The run is detached before the arm, so a refusal that exited
   * would leave a live run with no hold and nothing saying so. A goalCheck that is already GREEN is
   * exactly that refusal, and it must print and stand.
   */
  test('an arm-time refusal is printed and the dispatch still succeeds', () => {
    const f = fixture({ goalCheck: 'true' })
    const g = dispatch(f)
    expect(g.code).toBe(0)
    expect(g.out).toContain('hold: NOT armed')
    expect(existsSync(join(g.tmp, `work-hold-${g.sid}.json`))).toBe(false)
  }, 60_000)

  test('a readOnly dispatch arms the hold too', () => {
    const ro = dispatch(fixture({ readOnly: true }))
    expect(existsSync(join(ro.tmp, `work-hold-${ro.sid}.json`))).toBe(true)
  }, 60_000)
})

/**
 * HALF TWO: THE WAKE. The `farm-runs` plugin monitor watches the run for the whole session, so the
 * cron is a FALLBACK POLL and off by default: measured AGK 2026-09-27, a cron woke the session 14
 * times inside one round, each tick re-entering a 113 KB plan and a 276 KB run dir.
 */
describe('half two: the cron is OPTIONAL, and the monitor is the wake', () => {
  const r = dispatch(fixture())

  test('no cron is printed by default — one line names the monitor instead', () => {
    expect(r.out).not.toContain('CronCreate')
    expect(r.out).toMatch(/farm-runs monitor/)
    expect(r.out).toMatch(/--cron/)
  })

  test('the farm-runs monitor runs for the whole session, not on skill invoke', () => {
    const m = JSON.parse(readFileSync(join(REPO, 'monitors/monitors.json'), 'utf8'))
    expect(m.find((x: any) => x.name === 'farm-runs').when).toBe('always')
  })

  test('--cron prints the CronCreate call, hourly, off the :00 mark', () => {
    const c = dispatch(fixture(), {}, ['--cron'])
    expect(c.out).toContain('CronCreate')
    expect(c.out).toMatch(/REQUIRED, THIS TURN/)
    expect(/cron:\s+(\S.*)$/m.exec(c.out)![1].trim()).toBe('7 * * * *')
  }, 60_000)

  test('WORK_LOOP_INTERVAL_MINUTES opts in too, and sets the period', () => {
    const c = dispatch(fixture(), { WORK_LOOP_INTERVAL_MINUTES: '120' })
    expect(c.out).toContain('CronCreate')
    expect(/cron:\s+(\S.*)$/m.exec(c.out)![1].trim()).toBe('7 */2 * * *')
  }, 60_000)

  test('the prompt is a nudge: short, and naming no plan path, check or authority', () => {
    const c = dispatch(fixture(), {}, ['--cron'])
    const prompt = /prompt:\s+(\S.*)$/m.exec(c.out)![1].trim()
    expect(prompt).toBe('and? (work run hb-run)')
    expect(prompt.length).toBeLessThan(60)
    expect(prompt).not.toMatch(/plan\.md|work-result\.sh|result\.json|\.work|CronDelete|authority|blocker/i)
  }, 60_000)

  /**
   * EVERY path that dispatches, not only the printed-wait one. --loops N returns through its own
   * `exit 0` after handing off to the detached loop, which is a second place both the hold and the
   * wake line can be missed — and a run dispatched with a loop is precisely the unattended one.
   */
  test('both dispatching exits arm the hold and print the wake line', () => {
    const s = readFileSync(DISPATCH, 'utf8')
    expect(s.match(/^\s*print_cron_instruction$/gm)?.length).toBe(2)
    expect(s.match(/^\s*arm_hold$/gm)?.length).toBe(2)
    const detachedExit = s.indexOf('loop: detached (pid $loop_pid)')
    expect(detachedExit).toBeGreaterThan(-1)
    expect(s.indexOf('arm_hold', detachedExit)).toBeLessThan(s.indexOf('print_cron_instruction', detachedExit))
    expect(s.indexOf('print_cron_instruction', detachedExit))
      .toBeLessThan(s.indexOf('exit 0', detachedExit))
  })
})
