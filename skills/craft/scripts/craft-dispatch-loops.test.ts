/**
 * craft-dispatch.sh --loops N executes the continuation loop instead of printing it.
 *
 * The backward-compatibility half matters as much as the feature: --loops 0 must be today's
 * behaviour to the byte (the heredoc prints, the script exits 0), and the two paths that return
 * BEFORE the dispatch — --print and CRAFT_DISPATCH_DRYRUN — must be untouched, because every
 * existing test in this directory drives the script through the second one.
 *
 * Run: bun test /home/eh/projects/workflows/skills/craft/scripts/craft-dispatch-loops.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
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
 * A stand-in for farm.sh, reached through CRAFT_FARM (craft-dispatch.sh:64). It writes the verdict
 * the case needs to the --out path it was handed, which is exactly the contract the real runner has
 * with craft — so the loop under test polls a real file written by a real detached process.
 */
function stubFarm(dir: string, pass: boolean) {
  const verdict = JSON.stringify({
    overallPass: pass,
    verdict: pass ? 'PASS' : 'FAIL',
    scoreTable: { tasksTotal: 1 },
    findings: [],
    tasksThatFlagged: pass ? [] : ['T1'],
    mechanicalThatFailed: [],
    lensesThatFlagged: [],
    mechanical: [],
  })
  return script(dir, 'stub-farm.sh', [
    'out=""',
    'while [ $# -gt 0 ]; do case "$1" in --out) out="$2"; shift 2 ;; *) shift ;; esac; done',
    '[ -n "$out" ] || exit 2',
    `cat > "$out" <<'VERDICT'`,
    verdict,
    'VERDICT',
  ].join('\n'))
}

/** A lint-clean plan whose one task carries a genuinely-red gate, so no probe tier refuses. */
function fixture(extraArgs: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'craft-loops-'))
  scratch.push(dir)
  mkdirSync(join(dir, 'src'), { recursive: true })
  script(dir, 'check.sh', 'echo "1 failed, 0 passed"\nexit 1')
  const plan = join(dir, 'plan.md')
  const args = {
    projectDir: dir,
    goal: 'make the thing correct',
    ...extraArgs,
    // Empty on purpose: craft-result.sh RE-RUNS every declared mechanical check, so a fixture that
    // declared one would be asserting that command rather than the loop handoff under test.
    mechanicalChecks: [],
    reviewLenses: [{ key: 'k', agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' }],
    tasks: [{
      id: 'T1', name: 'one', work: 'do the thing', writablePaths: ['src/'], refs: [],
      redCommand: 'bash scripts/check.sh', acceptance: '`bash scripts/check.sh` exits 0',
    }],
  }
  writeFileSync(plan, '# Plan\n\n## Run sizing\n\nnothing parked\n\n' +
    `<!-- craft:dispatch\n${JSON.stringify({ runId: 'loops-run', args }, null, 2)}\n-->\n`)
  return { dir, plan, runDir: join(dir, '.craft', 'loops-run') }
}

/**
 * CLAUDE_CODE_SESSION_ID is blanked so goal-self-send.sh refuses at its identity check (exit 4)
 * BEFORE any transport is tried. Without it a test dispatch would queue a real /goal into whatever
 * live session is running the suite.
 */
function dispatch(f: { dir: string; plan: string }, env: Record<string, string>, ...extra: string[]) {
  try {
    const out = execFileSync('bash', [SCRIPT, ...extra, f.plan], {
      encoding: 'utf8',
      timeout: 120_000,
      cwd: f.dir,
      env: { ...process.env, CLAUDE_CODE_SESSION_ID: '', CRAFT_LOOP_POLL: '1', CRAFT_NO_SCOPE: '1', ...env },
    })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

const HEREDOC = /Monitor it \(persistent, no deadline\)/

describe('--loops 0 is today\'s behaviour, unchanged', () => {
  test('the wait heredoc still prints and the script still exits 0', () => {
    const f = fixture()
    const r = dispatch(f, { CRAFT_FARM: stubFarm(f.dir, true) }, '--loops', '0')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(HEREDOC)
  })

})

describe('the default when --loops is omitted is the plan\'s maxRounds', () => {
  /**
   * Previously this case passed `--loops 0` and was therefore byte-identical to the test above, so
   * the default-resolution block was never executed by anything. The flag has to be genuinely
   * ABSENT for that code to run.
   */
  test('a plan carrying maxRounds loops rather than printing, and honours that number', () => {
    const f = fixture({ maxRounds: 1 })
    const r = dispatch(f, { CRAFT_FARM: stubFarm(f.dir, false) })   // no --loops at all
    expect(r.out).not.toMatch(HEREDOC)
    expect(r.code).toBe(6)          // the cap from maxRounds: 1 was reached with the gate failing
  })

  test('a plan with no maxRounds falls back to 3 rather than to zero or to unbounded', () => {
    const f = fixture()
    const r = dispatch(f, { CRAFT_FARM: stubFarm(f.dir, true) })    // no --loops at all
    expect(r.out).not.toMatch(HEREDOC)
    expect(r.code).toBe(0)
  })
})

describe('--loops N > 0 hands off to the driver instead of printing', () => {
  test('the heredoc is NOT printed and the run reaches craft-loop.sh, which returns the PASS verdict', () => {
    const f = fixture()
    const r = dispatch(f, { CRAFT_FARM: stubFarm(f.dir, true) }, '--loops', '2')
    expect(r.out).not.toMatch(HEREDOC)
    expect(r.code).toBe(0)
    expect(existsSync(join(f.runDir, 'result.json'))).toBe(true)
  })

  test('a failing gate at the loop cap surfaces the driver\'s halt code, not a bare 0', () => {
    const f = fixture()
    const r = dispatch(f, { CRAFT_FARM: stubFarm(f.dir, false) }, '--loops', '1')
    expect(r.code).toBe(6)
  })
})

describe('--loops validation', () => {
  test('a non-numeric value is refused with exit 2 naming the flag, before anything is dispatched', () => {
    const f = fixture()
    const r = dispatch(f, { CRAFT_FARM: stubFarm(f.dir, true) }, '--loops', 'lots')
    expect(r.code).toBe(2)
    expect(r.out).toContain('--loops')
    expect(existsSync(join(f.runDir, 'args.json'))).toBe(false)
  })

  test('a missing value is refused with exit 2 rather than swallowing the plan path as the count', () => {
    const f = fixture()
    const r = dispatch(f, { CRAFT_FARM: stubFarm(f.dir, true) }, '--loops')
    expect(r.code).toBe(2)
  })
})

describe('the paths that return before the dispatch are untouched', () => {
  test('--print still writes only the preview and dispatches nothing', () => {
    const f = fixture()
    const r = dispatch(f, {}, '--print')
    expect(r.code).toBe(0)
    expect(r.out).toContain('--print: nothing dispatched.')
    expect(existsSync(join(f.runDir, 'args.preview.json'))).toBe(true)
    expect(existsSync(join(f.runDir, 'args.json'))).toBe(false)
  })

  test('CRAFT_DISPATCH_DRYRUN still stops after the gates, even with --loops set', () => {
    const f = fixture()
    const r = dispatch(f, { CRAFT_DISPATCH_DRYRUN: '1' }, '--loops', '3')
    expect(r.code).toBe(0)
    expect(r.out).toContain('CRAFT_DISPATCH_DRYRUN: lint passed, nothing dispatched.')
    expect(r.out).not.toMatch(HEREDOC)
    expect(existsSync(join(f.runDir, 'result.json'))).toBe(false)
  })
})
