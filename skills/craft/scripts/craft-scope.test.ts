/**
 * Each dispatch runs inside a systemd user transient scope, so a long run is not collateral damage
 * from the terminal's cgroup.
 *
 * This is the measured failure: a run was OOM-killed by systemd-oomd at 10:18 because it shared the
 * terminal's cgroup, and `setsid` does not escape a cgroup — it detaches the session, not the
 * resource domain. A transient scope is a new cgroup under the user manager, which is what the
 * kill actually needed.
 *
 * The fallback is as load-bearing as the feature: a machine with no user systemd manager (a
 * container, a remote shell, a non-systemd distro) must still DISPATCH. Losing the scope is a
 * warning; refusing to run is a regression.
 *
 * Run: bun test /home/eh/projects/workflows/skills/craft/scripts/craft-scope.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = `${import.meta.dir}/craft-dispatch.sh`
const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

function script(dir: string, name: string, body: string) {
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  const p = join(dir, 'scripts', name)
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}

/**
 * The stub records ITS OWN cgroup beside the verdict. That is the only honest witness to which
 * branch the dispatch actually took: craft-dispatch.sh's `scope:` line is printed from PROBE state,
 * so asserting on it proves the probe ran, not that the runner was placed anywhere. A transient
 * scope is a new cgroup under the user manager, so the dispatched process can simply read where it
 * landed.
 */
function stubFarm(dir: string) {
  const verdict = JSON.stringify({
    overallPass: true, verdict: 'PASS', scoreTable: { tasksTotal: 1 }, findings: [],
    tasksThatFlagged: [], mechanicalThatFailed: [], lensesThatFlagged: [], mechanical: [],
  })
  return script(dir, 'stub-farm.sh', [
    'out=""',
    'while [ $# -gt 0 ]; do case "$1" in --out) out="$2"; shift 2 ;; *) shift ;; esac; done',
    '[ -n "$out" ] || exit 2',
    'cat /proc/self/cgroup > "$out.cgroup" 2>/dev/null || true',
    `cat > "$out" <<'VERDICT'`,
    verdict,
    'VERDICT',
  ].join('\n'))
}

/** The cgroup the dispatched runner actually ran in. */
function runnerCgroup(runDir: string): string {
  const p = join(runDir, 'result.json.cgroup')
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'craft-scope-'))
  scratch.push(dir)
  mkdirSync(join(dir, 'src'), { recursive: true })
  script(dir, 'check.sh', 'echo "1 failed, 0 passed"\nexit 1')
  const plan = join(dir, 'plan.md')
  const args = {
    projectDir: dir,
    goal: 'make the thing correct',
    mechanicalChecks: [],
    reviewLenses: [{ key: 'k', agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' }],
    tasks: [{
      id: 'T1', name: 'one', work: 'do the thing', writablePaths: ['src/'], refs: [],
      redCommand: 'bash scripts/check.sh', acceptance: '`bash scripts/check.sh` exits 0',
    }],
  }
  writeFileSync(plan, '# Plan\n\n## Run sizing\n\nnothing parked\n\n' +
    `<!-- craft:dispatch\n${JSON.stringify({ runId: 'scope-run', args }, null, 2)}\n-->\n`)
  return { dir, plan, runDir: join(dir, '.craft', 'scope-run') }
}

function dispatch(f: { dir: string; plan: string }, env: Record<string, string>) {
  try {
    const out = execFileSync('bash', [SCRIPT, '--loops', '0', f.plan], {
      encoding: 'utf8',
      timeout: 120_000,
      cwd: f.dir,
      env: { ...process.env, CLAUDE_CODE_SESSION_ID: '', ...env },
    })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

/** Does this machine actually have a reachable user manager? The assertion below branches on it
 *  rather than assuming, so the suite is honest on a container as well as on this workstation. */
function scopeAvailable(): boolean {
  try {
    execFileSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', '--', 'true'],
      { timeout: 20_000, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Wait for the detached runner to land its verdict; the dispatch returns before the run finishes. */
function awaitResult(path: string, ms = 30_000): boolean {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (existsSync(path)) return true
    execFileSync('sleep', ['0.2'])
  }
  return existsSync(path)
}

describe('the dispatch reports which cgroup path it took', () => {
  test('CRAFT_NO_SCOPE=1 forces the plain detached path and says so', () => {
    const f = fixture()
    const r = dispatch(f, { CRAFT_FARM: stubFarm(f.dir), CRAFT_NO_SCOPE: '1' })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/scope: none/)
    expect(awaitResult(join(f.runDir, 'result.json'))).toBe(true)
  })

  test('with no override the runner LANDS in a transient scope when the user manager is reachable', () => {
    const f = fixture()
    const r = dispatch(f, { CRAFT_FARM: stubFarm(f.dir) })
    expect(r.code).toBe(0)
    expect(awaitResult(join(f.runDir, 'result.json'))).toBe(true)

    const cgroup = runnerCgroup(f.runDir)
    expect(cgroup).not.toBe('')
    if (scopeAvailable()) {
      expect(r.out).toMatch(/scope: transient/)
      // The claim under test is placement, not the printed word: the runner's own cgroup must be a
      // transient scope, and must name this run rather than some other unit.
      expect(cgroup).toMatch(/\.scope\b/)
      expect(cgroup).toContain('scope-run')
    } else {
      expect(r.out).toMatch(/scope: none/)
    }
  })

  test('the plain path leaves the runner in the inherited cgroup — the two branches are distinguishable', () => {
    const f = fixture()
    const r = dispatch(f, { CRAFT_FARM: stubFarm(f.dir), CRAFT_NO_SCOPE: '1' })
    expect(r.code).toBe(0)
    expect(awaitResult(join(f.runDir, 'result.json'))).toBe(true)
    // No craft unit anywhere in the runner's cgroup: nothing placed it.
    expect(runnerCgroup(f.runDir)).not.toContain('scope-run')
  })
})

/**
 * The cgroup fix has to cover the CONTINUATION, not just round 1.
 *
 * craft-dispatch.sh starts round 1; craft-redispatch.sh starts rounds 2..N, and it is the loop —
 * the long, unattended part — that the OOM kill actually threatens. A scope wrapper on round 1
 * alone leaves every subsequent round back in the terminal's cgroup, which is the failure this
 * change exists to remove.
 */
describe('the continuation rounds are scoped too, not just the first dispatch', () => {
  const REDISPATCH = join(import.meta.dir, 'craft-redispatch.sh')

  test('a redispatched round lands in a transient scope when the user manager is reachable', () => {
    const f = fixture()
    // Round 1, plain, to lay down args.json and a verdict for the redispatch to rotate.
    expect(dispatch(f, { CRAFT_FARM: stubFarm(f.dir), CRAFT_NO_SCOPE: '1' }).code).toBe(0)
    expect(awaitResult(join(f.runDir, 'result.json'))).toBe(true)
    rmSync(join(f.runDir, 'result.json.cgroup'), { force: true })

    let code = 0
    let out = ''
    try {
      out = execFileSync('bash', [REDISPATCH, f.plan, join(f.runDir, 'args.json'), '--dispatch', '--full'], {
        encoding: 'utf8', timeout: 120_000, cwd: f.dir,
        env: { ...process.env, CLAUDE_CODE_SESSION_ID: '', CRAFT_FARM: stubFarm(f.dir) },
      })
    } catch (e: any) {
      code = e.status ?? -1
      out = (e.stdout ?? '') + (e.stderr ?? '')
    }
    expect(code).toBe(0)
    expect(awaitResult(join(f.runDir, 'result.json'))).toBe(true)

    const cgroup = runnerCgroup(f.runDir)
    expect(cgroup).not.toBe('')
    if (scopeAvailable()) {
      expect(out).toMatch(/scope: transient/)
      expect(cgroup).toMatch(/\.scope\b/)
      expect(cgroup).toContain('scope-run')
    } else {
      expect(out).toMatch(/scope: none/)
    }
  }, 180_000)
})

describe('losing the scope is a warning, never a refusal', () => {
  test('an unusable systemd-run still dispatches, warns, and exits 0', () => {
    const f = fixture()
    const r = dispatch(f, {
      CRAFT_FARM: stubFarm(f.dir),
      CRAFT_SYSTEMD_RUN: join(f.dir, 'no-such-systemd-run'),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/scope: none/)
    // The whole point of the fallback: the run still happens.
    expect(awaitResult(join(f.runDir, 'result.json'))).toBe(true)
  })
})
