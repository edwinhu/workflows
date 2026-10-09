// <!-- wc-probe: ignore-refs -->
// Fixtures below are executed, not declared: the task rows are INPUT to the dispatcher.
/**
 * A work round runs as ONE farm.sh --workflow row, so that row's budget caps every implementer and
 * verifier together. It must scale with the plan: FARM_TASK_BUDGET alone killed the 6-task
 * 1007-nevada-otc round at 4.10M, about 5 h in and before verification (2026-10-07).
 *
 * No model and no network: dispatch stops at WORK_DISPATCH_DRYRUN, and work-round.sh runs a stub
 * farm.sh (WORK_FARM) that records its argv.
 *
 * Run: bun test ./skills/work/scripts/work-budget.test.ts
 */
import { describe, expect, test, setDefaultTimeout } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { useTmp } from '../../../tests/helpers/tmp.ts'

setDefaultTimeout(60_000)
const mkTmp = useTmp()

const DISPATCH = join(import.meta.dir, 'work-dispatch.sh')
const ROUND = join(import.meta.dir, 'work-round.sh')
const PER_TASK = 1_000_000
const budgetEnv = { FARM_TASK_BUDGET: String(PER_TASK), FARM_SESSION_BUDGET: '100000000' }

function sixTaskArgs(dir: string, extra: Record<string, unknown> = {}) {
  return {
    projectDir: dir,
    goal: 'make the six things correct',
    tasks: Array.from({ length: 6 }, (_, i) => ({
      id: `T${i + 1}`, name: `task ${i + 1}`, work: 'do the thing', writablePaths: [`src/t${i + 1}/`], refs: [],
      redCommand: 'bash scripts/check.sh', acceptance: '`bash scripts/check.sh` exits 0',
    })),
    mechanicalChecks: [{ name: 'tests', cmd: 'bun test' }],
    lens: { agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' },
    ...extra,
  }
}

function plan(extra: Record<string, unknown> = {}) {
  const dir = mkTmp('work-budget-')
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  writeFileSync(join(dir, 'scripts', 'check.sh'), '#!/usr/bin/env bash\necho "1 failed, 0 passed"\nexit 1\n')
  chmodSync(join(dir, 'scripts', 'check.sh'), 0o755)
  const p = join(dir, 'plan.md')
  writeFileSync(p, '# Plan\n\n## Run sizing\n\nnothing parked\n\n' +
    `<!-- work:dispatch\n${JSON.stringify({ runId: 'budget-run', args: sixTaskArgs(dir, extra) }, null, 2)}\n-->\n`)
  return { dir, plan: p }
}

function dispatch(f: { dir: string; plan: string }) {
  const r = spawnSync('bash', [DISPATCH, '--provider', 'claude', f.plan], {
    encoding: 'utf8', cwd: f.dir, timeout: 60_000,
    env: { ...process.env, ...budgetEnv, WORK_DISPATCH_DRYRUN: '1' },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

/** work-round.sh against a stub farm.sh; returns the argv of its first (--workflow) call. */
function roundFarmArgv(args: Record<string, unknown>, env: Record<string, string> = {}) {
  const dir = mkTmp('work-budget-round-')
  const argsPath = join(dir, 'args.json'), cap = join(dir, 'farm-argv')
  writeFileSync(argsPath, JSON.stringify(args))
  const farm = join(dir, 'farm.sh')
  writeFileSync(farm, `#!/usr/bin/env bash\n[ -e "${cap}" ] || printf '%s\\n' "$@" > "${cap}"\nexit 1\n`)
  chmodSync(farm, 0o755)
  const r = spawnSync('bash', [ROUND, argsPath, join(dir, 'result.json'), dir, 'claude'], {
    encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, ...budgetEnv, ...env, WORK_FARM: farm, TMPDIR: dir },
  })
  const argv = readFileSync(cap, 'utf8').trim().split('\n')
  return { argv, out: (r.stdout || '') + (r.stderr || '') }
}

const budgetOf = (argv: string[]) => {
  const i = argv.indexOf('--budget')
  return i < 0 ? null : Number(argv[i + 1])
}

describe('the work round budget scales with the plan', () => {
  test('dispatch prints a computed budget of at least tasks x FARM_TASK_BUDGET', () => {
    const r = dispatch(plan())
    expect(r.code).toBe(0)
    const m = r.out.match(/^\s*budget: (\d+) tokensW/m)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(6 * PER_TASK)
  })

  test('work-round.sh hands farm.sh --workflow a budget of at least 6 x the per-task budget', () => {
    const f = plan()
    const { argv } = roundFarmArgv(sixTaskArgs(f.dir))
    expect(argv).toContain('--workflow')
    expect(budgetOf(argv)).toBeGreaterThanOrEqual(6 * PER_TASK)
  })

  test('an explicit budget in the plan args wins, at dispatch and in the round', () => {
    const f = plan({ budget: 2_500_000 })
    const r = dispatch(f)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^\s*budget: 2500000 tokensW \(explicit/m)
    expect(budgetOf(roundFarmArgv(sixTaskArgs(f.dir, { budget: 2_500_000 })).argv)).toBe(2_500_000)
  })

  test('FARM_SESSION_BUDGET stays the outer bound', () => {
    const f = plan()
    const { argv } = roundFarmArgv(sixTaskArgs(f.dir), { FARM_SESSION_BUDGET: '5000000' })
    const b = budgetOf(argv)!
    expect(b).toBeGreaterThan(0)
    expect(b).toBeLessThan(5_000_000)
  })
})
