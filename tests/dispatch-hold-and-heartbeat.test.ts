/**
 * Phase 3 has two halves and work-dispatch.sh can only ARM one of them.
 *
 * The self-send transport this replaced queued a `/goal` or `/loop` into the dispatching session's
 * own pane, and a detached drainer typed it when the pane went IDLE. A session that has just
 * dispatched a run is mid-turn and then works back-to-back, so the window frequently never opened:
 * measured 2026-09-16, `/goal` landed 127 times and missed 36, `/loop` landed 52 and missed 29.
 * Both halves now land INSIDE the dispatching turn — the HOLD as a state file hound-arm.sh writes,
 * the HEARTBEAT as a CronCreate call only the model can make.
 *
 * That second half is the one this file exists for. A shell cannot call CronCreate, so the script
 * can only INSTRUCT, and a dispatch that ends with a hold and no heartbeat is exactly the
 * unattended idle the mechanism exists to prevent. The instruction must therefore be present,
 * complete (cron expression AND prompt text), and last.
 *
 * Run: bun test /home/eh/projects/workflows/tests/dispatch-hold-and-heartbeat.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lint } from '../skills/hound/scripts/cron-prompt-lint'

const REPO = join(import.meta.dir, '..')
const SKILL = join(REPO, 'skills/work')
const DISPATCH = join(SKILL, 'scripts/work-dispatch.sh')
const COMPOSE = join(SKILL, 'scripts/compose-goal.sh')
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
    `<!-- craft:dispatch\n${JSON.stringify({ runId: 'hb-run', args }, null, 2)}\n-->\n`)
  return { dir, plan, runDir: join(dir, '.craft', 'hb-run') }
}

/**
 * A real dispatch, with a real (fabricated) session id and a private TMPDIR — so hound-arm.sh
 * writes a real state file this test can read, and cannot touch the hold of the live session
 * running the suite. CRAFT_FARM is stubbed so nothing is farmed out for real.
 */
function dispatch(f: { dir: string; plan: string }, extraEnv: Record<string, string> = {}) {
  const sid = `hb-test-${Math.random().toString(36).slice(2)}`
  const tmp = mkdtempSync(join(tmpdir(), 'hold-tmpdir-'))
  scratch.push(tmp)
  const farm = script(f.dir, 'stub-farm.sh', 'exit 0')
  try {
    const out = execFileSync('bash', [DISPATCH, '--loops', '0', f.plan], {
      encoding: 'utf8', timeout: 180_000, cwd: f.dir,
      env: {
        ...process.env, CLAUDE_CODE_SESSION_ID: sid, TMPDIR: tmp,
        CRAFT_NO_SCOPE: '1', CRAFT_FARM: farm, ...extraEnv,
      },
    })
    return { code: 0, out, sid, tmp }
  } catch (e: any) {
    return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? ''), sid, tmp }
  }
}

const holdState = (r: { sid: string; tmp: string }) =>
  JSON.parse(readFileSync(join(r.tmp, `hound-${r.sid}.json`), 'utf8'))

describe('the self-send transport is gone, not merely unused', () => {
  /**
   * TRACKED files only. `.craft/` run artifacts, `scratch/` and stale worktrees under
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

describe('half one: the HOLD is armed by the script itself', () => {
  const r = dispatch(fixture())

  test('the dispatch succeeds', () => {
    expect(`code ${r.code}\n${r.out}`).toStartWith('code 0')
  })

  test('a state file exists for THIS session — no transport, nothing typed', () => {
    expect(() => holdState(r)).not.toThrow()
  })

  test('the check is a command, and it is work-result.sh on this run', () => {
    expect(holdState(r).check).toContain('work-result.sh')
    expect(holdState(r).check).toContain('result.json')
  })

  /**
   * work-result.sh exits 2 when there is no result.json, and hound-arm.sh correctly refuses an
   * exit above 1 as could-not-run rather than a verdict. Unwrapped, the arm would therefore fail
   * at exactly the moment the hold is needed — before the run has returned anything.
   */
  test('the check normalises to 0/1, so an absent verdict reads RED rather than could-not-run', () => {
    const rc = execFileSync('bash', ['-lc', `${holdState(r).check}; echo "rc=$?"`], { encoding: 'utf8' })
    expect(rc.trim().split('\n').pop()).toBe('rc=1')
  })

  test('the ceilings are the hook-enforced flags, taken from the plan and compose-goal.sh', () => {
    expect(holdState(r).maxRounds).toBe(4)
    expect(String(holdState(r).ceilingMinutes))
      .toBe(execFileSync('bash', [COMPOSE, '--minutes'], { encoding: 'utf8' }).trim())
  })

  test('a readOnly run closes on either verdict, because its gate legitimately FAILs', () => {
    const ro = dispatch(fixture({ readOnly: true }))
    expect(holdState(ro).check).toMatch(/-le 1/)
  })
})

describe('half two: the HEARTBEAT is INSTRUCTED, because no shell can call CronCreate', () => {
  const r = dispatch(fixture())

  test('the instruction names the tool and demands it this turn', () => {
    expect(r.out).toContain('CronCreate')
    expect(r.out).toMatch(/REQUIRED, THIS TURN/)
  })

  test('it carries a cron expression off the :00 and :30 marks the whole fleet lands on', () => {
    const cron = /cron:\s+(\S.*)$/m.exec(r.out)
    expect(cron, 'no cron expression in the dispatch output').not.toBeNull()
    expect(cron![1].trim()).toBe('7-59/30 * * * *')
  })

  test('the period is configurable and reaches the printed expression', () => {
    const hourly = dispatch(fixture(), { CRAFT_LOOP_INTERVAL_MINUTES: '120' })
    expect(/cron:\s+(\S.*)$/m.exec(hourly.out)![1].trim()).toBe('7 */2 * * *')
  })

  test('it carries the exact prompt text, so nothing has to be composed at call time', () => {
    const prompt = /prompt:\s+(\S.*)$/m.exec(r.out)
    expect(prompt, 'no prompt text in the dispatch output').not.toBeNull()
    expect(prompt![1]).toContain('work-result.sh')
  })

  /**
   * The lint that used to gate the self-send chokepoint now governs this text — the only string
   * present when a tick fires into an otherwise empty session. An ungated checker is what the old
   * arrangement degenerated into once its one caller stopped landing anything.
   */
  test('the prompt text passes cron-prompt-lint clean', () => {
    const prompt = /prompt:\s+(\S.*)$/m.exec(r.out)![1]
    expect(lint(prompt).map(f => `${f.rule}: ${f.message}`)).toEqual([])
  })

  test('the instruction is the LAST thing printed, so nothing scrolls it away', () => {
    const lines = r.out.trimEnd().split('\n')
    expect(lines[lines.length - 1]).toMatch(/^=+$/)
  })

  /**
   * EVERY path that dispatches, not only the printed-wait one. --loops N returns through its own
   * `exit 0` after handing off to the detached loop, which is a second place the instruction can be
   * missed — and a run dispatched with a loop is precisely the unattended one.
   */
  test('both dispatching exits emit it', () => {
    const s = readFileSync(DISPATCH, 'utf8')
    expect(s.match(/^\s*print_cron_instruction$/gm)?.length).toBe(2)
    const detachedExit = s.indexOf('loop: detached (pid $loop_pid)')
    expect(detachedExit).toBeGreaterThan(-1)
    expect(s.indexOf('print_cron_instruction', detachedExit))
      .toBeLessThan(s.indexOf('exit 0', detachedExit))
  })
})
