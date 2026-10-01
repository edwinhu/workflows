/**
 * work-redispatch.sh re-syncs the plan's dispatch block into args.json.
 *
 * The script's own header calls the FAIL loop "fix, amend the plan, re-hash, re-dispatch", but it
 * only ever re-hashed: `tasks[]`, `mechanicalChecks` and the lens arrays stayed at whatever the
 * first work-dispatch.sh built. An amended `work` string never reached the implementer and — worse
 * — an amended `redCommand` never reached the red gate, which is EXECUTED from args.json. A stale
 * gate that has since gone green reads as `redNotRed`, i.e. "your test proves nothing", for a test
 * the author had already fixed in the plan.
 *
 * The hash is not a defence here: it authenticates the PLAN while the executed instructions live in
 * args.json, and nothing checked that the two still agree.
 *
 * Run: bun test ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/work-redispatch.test.ts
 */
import { describe, expect, test, afterAll, setDefaultTimeout } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, chmodSync, readdirSync, rmSync, writeFileSync, readFileSync, existsSync, utimesSync } from "node:fs"
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run as runWorkflow, replies } from './workflow-harness.mjs'

// Tests in this file drive work-dispatch.sh as a real bash subprocess. Bun's 5s per-test default
// is a budget for that subprocess plus whatever else the machine is doing, so under parallel load
// these go red at exactly [5000.xx ms] — contention reported as a defect in the code under test.
// 60s does not hide a hang (a hang never returns and is caught by any finite ceiling); it stops
// standing in for a latency budget this suite never had. Set per file because bun 1.4.0 ignores
// `[test] timeout` in bunfig.toml and applies a preload's setDefaultTimeout to the first file only.
setDefaultTimeout(60_000)

const SCRIPT = `${import.meta.dir}/work-redispatch.sh`
const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

/** A real script for a `redCommand` to name, so the dispatch-time probe has something to execute. */
function redScript(dir: string, name: string, body: string) {
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  const p = join(dir, 'scripts', name)
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}

/** A plan whose dispatch block carries `work`/`redCommand` values, plus the args.json built earlier. */
function fixture(opts: { planWork: string; planRed: string; argsWork: string; argsRed: string; extra?: Record<string, unknown> }) {
  const dir = mkdtempSync(join(tmpdir(), 'work-redispatch-'))
  scratch.push(dir)
  const plan = join(dir, 'plan.md')
  const args = join(dir, 'args.json')
  const block = {
    runId: 'test-run',
    args: {
      projectDir: dir,
      goal: 'a goal',
      tasks: [{ id: 't1', name: 'one', work: opts.planWork, writablePaths: ['a.txt'], refs: [], redCommand: opts.planRed, acceptance: 'it passes' }],
      mechanicalChecks: [{ name: 'check', cmd: 'true' }],
      lens: { agentType: 'Explore', refs: [], prompt: 'judge' },
    },
  }
  writeFileSync(plan, `# Plan\n\n<!-- work:dispatch\n${JSON.stringify(block, null, 2)}\n-->\n`)
  writeFileSync(args, JSON.stringify({
    projectDir: dir,
    planPath: plan,
    specHash: '0'.repeat(64),
    goal: 'a goal',
    tasks: [{ id: 't1', name: 'one', work: opts.argsWork, writablePaths: ['a.txt'], refs: [], redCommand: opts.argsRed, acceptance: 'it passes' }],
    mechanicalChecks: [{ name: 'check', cmd: 'true' }],
    lens: { agentType: 'Explore', refs: [], prompt: 'judge' },
    ...(opts.extra ?? {}),
  }, null, 2) + '\n')
  return { dir, plan, args }
}

/** A previous round's verdict, in the run dir work-redispatch.sh reads and rotates. */
function priorResult(dir: string, name = 'result.json') {
  writeFileSync(join(dir, name), JSON.stringify({
    overallPass: false,
    verdict: 'FAIL',
    tasksThatFlagged: [],
    mechanicalThatFailed: [],
    lensesThatFlagged: [],
    findings: [],
  }, null, 2) + '\n')
}

function run(plan: string, args: string) {
  try {
    const stdout = execFileSync('bash', [SCRIPT, plan, args], { encoding: 'utf8' })
    return { code: 0, stdout }
  } catch (e: any) {
    return { code: e.status ?? -1, stdout: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

const readArgs = (p: string) => JSON.parse(readFileSync(p, 'utf8'))

describe('work-redispatch.sh syncs the plan dispatch block into args.json', () => {
  test('an amended work string in the plan reaches args.json', () => {
    const f = fixture({ planWork: 'AMENDED work', planRed: 'false', argsWork: 'STALE work', argsRed: 'false' })
    const r = run(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(readArgs(f.args).tasks[0].work).toBe('AMENDED work')
  })

  test('an amended redCommand reaches args.json — it is EXECUTED from there, not from the plan', () => {
    const f = fixture({ planWork: 'w', planRed: 'bun test x -t amended', argsWork: 'w', argsRed: 'bun test x -t stale' })
    const r = run(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(readArgs(f.args).tasks[0].redCommand).toBe('bun test x -t amended')
  })

  /**
   * The ONE key the sync has to be able to REMOVE. workflow.js refuses `reviewLenses` outright, so an
   * args file carrying it from an earlier round while the amended plan declares `lens` throws before a
   * single agent is dispatched — the round cannot run at all, on a plan that is correct. Every other
   * key the sync only ever sets.
   */
  test('a retired reviewLenses key is REMOVED when the plan no longer declares it', () => {
    const f = fixture({
      planWork: 'w', planRed: 'false', argsWork: 'w', argsRed: 'false',
      extra: { reviewLenses: [{ key: 'k', agentType: 'Explore', refs: [], prompt: 'judge' }] },
    })
    const r = run(f.plan, f.args)
    expect(r.code).toBe(0)
    expect('reviewLenses' in readArgs(f.args)).toBe(false)
    expect(readArgs(f.args).lens.prompt).toBe('judge')
    expect(r.stdout).toContain('-reviewLenses')
  })

  test('the sync is reported on stdout — a silent overwrite is how drift hides', () => {
    const f = fixture({ planWork: 'AMENDED work', planRed: 'false', argsWork: 'STALE work', argsRed: 'false' })
    expect(run(f.plan, f.args).stdout).toMatch(/sync|task|amend/i)
  })

  test('run-local fields survive the sync — they are not in the plan and must not be dropped', () => {
    const f = fixture({
      planWork: 'AMENDED work', planRed: 'false', argsWork: 'STALE work', argsRed: 'false',
      extra: { onlyTasks: ['t1'], priorResults: { implemented: [{ id: 't2' }] } },
    })
    const r = run(f.plan, f.args)
    expect(r.code).toBe(0)
    const a = readArgs(f.args)
    expect(a.onlyTasks).toEqual(['t1'])
    expect(a.priorResults.implemented[0].id).toBe('t2')
    expect(a.tasks[0].work).toBe('AMENDED work')
  })

  test('a plan naming a different planPath is still refused', () => {
    const f = fixture({ planWork: 'w', planRed: 'false', argsWork: 'w', argsRed: 'false' })
    const a = readArgs(f.args)
    a.planPath = '/somewhere/else.md'
    writeFileSync(f.args, JSON.stringify(a, null, 2))
    expect(run(f.plan, f.args).code).not.toBe(0)
  })

  test('a plan with no dispatch block is refused, and args.json is left exactly as it was', () => {
    // There is no spec to re-hash, so there is nothing to re-dispatch under. Refusing is the only
    // honest answer; what must NOT happen is the args being rewritten or erased on the way out.
    const f = fixture({ planWork: 'w', planRed: 'false', argsWork: 'STALE work', argsRed: 'false' })
    const before = readFileSync(f.args, 'utf8')
    writeFileSync(f.plan, '# Plan with no dispatch block\n')
    const r = run(f.plan, f.args)
    expect(r.code).not.toBe(0)
    expect(r.stdout).toMatch(/work:dispatch/)
    expect(readFileSync(f.args, 'utf8')).toBe(before)
  })
})

describe('the round counter — a field in args.json, not a file beside it', () => {
  test('re-hashing increments <run-dir>/rounds', () => {
    const f = fixture({ planWork: 'w', planRed: 'false', argsWork: 'w', argsRed: 'false' })
    const a0 = readArgs(f.args); a0.rounds = 1; writeFileSync(f.args, JSON.stringify(a0, null, 2))
    run(f.plan, f.args)
    expect(readArgs(f.args).rounds).toBe(2)
    run(f.plan, f.args)
    expect(readArgs(f.args).rounds).toBe(3)
  })

  test('an absent counter starts at 1 rather than crashing a re-dispatch', () => {
    const f = fixture({ planWork: 'w', planRed: 'false', argsWork: 'w', argsRed: 'false' })
    const r = run(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(readArgs(f.args).rounds).toBe(1)
  })

  test('a corrupt counter is reported, not silently reset to 1 — a reset would make the budget unreachable', () => {
    const f = fixture({ planWork: 'w', planRed: 'false', argsWork: 'w', argsRed: 'false' })
    const bad = readArgs(f.args); bad.rounds = 'not-a-number'; writeFileSync(f.args, JSON.stringify(bad, null, 2))
    const r = run(f.plan, f.args)
    expect(r.code).not.toBe(0)
    expect(r.stdout).toMatch(/rounds/i)
  })

  test('the new count is printed, so the budget is visible without opening the file', () => {
    const f = fixture({ planWork: 'w', planRed: 'false', argsWork: 'w', argsRed: 'false' })
    const a4 = readArgs(f.args); a4.rounds = 4; writeFileSync(f.args, JSON.stringify(a4, null, 2))
    expect(run(f.plan, f.args).stdout).toMatch(/round.*5|5.*round/i)
  })
})

// ------------------------------------------------ the tier-1 plan gate on the re-dispatch path
//
// work-dispatch.sh lints the built args and exits 3 on a major/critical, failing closed. The FAIL
// loop does not go through it: fix -> amend -> re-dispatch runs THIS script, which dispatched
// unlinted. The gate here lints the FINAL args — after the plan block has been re-synced and the
// counters advanced — so what is linted is what runs.
//
// A refusal must be a no-op: `rounds` unspent, result.json unrotated, args.json untouched. A gate
// that consumes a round and destroys the previous verdict is worse than no gate.

/**
 * A lint-CLEAN args/plan pair, so the only finding a test can produce is the one it asks for.
 * `dirty` adds a task that is neither red-gated nor dispositioned — one major, nothing else.
 * `uncountable` empties both channels, which plan-lint refuses to read at all (exit 2, no JSON).
 */
function gateFixture(opts: { dirty?: boolean; uncountable?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'work-redispatch-gate-'))
  scratch.push(dir)
  const plan = join(dir, 'plan.md')
  const args = join(dir, 'args.json')
  // The dispatch-time red probe EXECUTES this, so it has to exist and be genuinely red — an absent
  // script is exit 127, which is a could-not-run refusal rather than the plan finding under test.
  redScript(dir, 'check.sh', 'echo "1 failed"\nexit 1')
  const clean = {
    projectDir: dir,
    goal: 'make the thing correct',
    tasks: [{
      id: 'T1', name: 'one', work: 'do the thing', writablePaths: ['src/'], refs: [],
      redCommand: 'bash scripts/check.sh', acceptance: '`bash scripts/check.sh` exits 0',
    }],
    mechanicalChecks: [{ name: 'tests', cmd: 'bun test' }],
    lens: { agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' },
  }
  if (opts.dirty)
    clean.tasks.push({
      id: 'T2', name: 'two', work: 'do the other thing', writablePaths: ['docs/'], refs: [],
      redCommand: null as any, acceptance: '`bash scripts/check.sh` exits 0',
    })
  if (opts.uncountable) { clean.tasks = []; clean.mechanicalChecks = [] }
  writeFileSync(plan, `# Plan\n\n## Run sizing\n\n` +
    `<!-- work:dispatch\n${JSON.stringify({ runId: 'gate-run', args: clean }, null, 2)}\n-->\n`)
  writeFileSync(args, JSON.stringify({
    ...clean, planPath: plan, specHash: '0'.repeat(64), rounds: 1,
  }, null, 2) + '\n')
  return { dir, plan, args, result: join(dir, 'result.json') }
}

/**
 * A REAL --dispatch, with farm.sh swapped for a stub. Rotation, the args write and the plan archive
 * all happen, which is what these tests are about — they used to ride on WORK_REDISPATCH_DRYRUN, which
 * committed everything and only skipped the farm-out. That flag is now a true dry run (nothing
 * written), so observing the commit path means dispatching for real against a farm that does nothing.
 */
const FARM_STUB = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'work-redispatch-farm-'))
  scratch.push(dir)
  const p = join(dir, 'farm-stub.sh')
  writeFileSync(p, '#!/usr/bin/env bash\nexit 0\n')
  chmodSync(p, 0o755)
  return p
})()

function redispatch(plan: string, args: string, ...extra: string[]) {
  const env = { ...process.env, WORK_FARM: FARM_STUB, WORK_NO_SCOPE: '1' }
  try {
    const stdout = execFileSync('bash', [SCRIPT, plan, args, '--dispatch', ...extra], { encoding: 'utf8', env })
    return { code: 0, out: stdout }
  } catch (e: any) {
    return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

/** The dry run: every gate above, nothing on disk. */
function dryRun(plan: string, args: string, ...extra: string[]) {
  try {
    const stdout = execFileSync('bash', [SCRIPT, plan, args, '--dispatch', ...extra], {
      encoding: 'utf8', env: { ...process.env, WORK_REDISPATCH_DRYRUN: '1' },
    })
    return { code: 0, out: stdout }
  } catch (e: any) {
    return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

/**
 * WORK_REDISPATCH_DRYRUN is the flag someone reaches for to see what a round WOULD do. It used to
 * commit everything and skip only the farm-out: the staged args landed over args.json with `rounds`
 * advanced, result.json was rotated away, the plan was archived — and then it printed "nothing
 * dispatched". So looking spent the round and destroyed the verdict the next round scopes from, and a
 * second look ran against state the first look had already moved.
 */
describe('WORK_REDISPATCH_DRYRUN writes nothing', () => {
  test('args.json and result.json are byte-identical after a dry run', () => {
    const f = gateFixture()
    priorResult(f.dir)
    const argsBefore = readFileSync(f.args, 'utf8')
    const resultBefore = readFileSync(f.result, 'utf8')

    const r = dryRun(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(readFileSync(f.args, 'utf8')).toBe(argsBefore)
    expect(readFileSync(f.result, 'utf8')).toBe(resultBefore)
    expect(existsSync(join(f.dir, 'result-round1.json'))).toBe(false)
  })

  test('the staged args file is cleaned up, not left behind as a half-committed round', () => {
    const f = gateFixture()
    priorResult(f.dir)
    dryRun(f.plan, f.args)
    expect(existsSync(join(f.dir, '.args.redispatch.json'))).toBe(false)
  })

  test('it says what it WOULD have advanced and rotated — skipped silently is no better than done silently', () => {
    const f = gateFixture()
    priorResult(f.dir)
    const out = dryRun(f.plan, f.args).out
    expect(out).toMatch(/WOULD advance: rounds -> 2/)
    expect(out).toMatch(/WOULD rotate:\s+result\.json -> result-round1\.json/)
    expect(out).toContain('nothing written')
  })

  test('with no result.json to rotate it says nothing about rotation', () => {
    const f = gateFixture()
    const out = dryRun(f.plan, f.args, '--no-lint').out
    expect(out).not.toContain('WOULD rotate')
    expect(out).toMatch(/WOULD advance/)
  })

  // The gates are the whole point of the flag: a dry run that skipped them would report a round as
  // dispatchable when plan-lint refuses it.
  test('the tier-1 gate still runs and still refuses under a dry run', () => {
    const f = gateFixture({ dirty: true })
    priorResult(f.dir)
    const r = dryRun(f.plan, f.args)
    expect(r.code).toBe(3)
    expect(r.out).toContain('BLOCKED')
  })

  // The contrast that makes the fix legible: a REAL dispatch does commit all three.
  test('a real dispatch still advances, rotates and archives', () => {
    const f = gateFixture()
    priorResult(f.dir)
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(readArgs(f.args).rounds).toBe(2)
    expect(existsSync(join(f.dir, 'result-round1.json'))).toBe(true)
    expect(existsSync(f.result)).toBe(false)
  })
})

describe('the tier-1 plan gate on re-dispatch', () => {
  test('a clean plan lints, dispatches, and increments rounds as before', () => {
    const f = gateFixture()
    priorResult(f.dir)
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(readArgs(f.args).rounds).toBe(2)
    expect(existsSync(join(f.dir, 'result-round1.json'))).toBe(true)
  })

  test('a major/critical plan finding refuses with exit 3 and dispatches nothing', () => {
    const f = gateFixture({ dirty: true })
    priorResult(f.dir)
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/BLOCKED/)
  })

  test('a refused re-dispatch spends no round: rounds, args.json and result.json are untouched', () => {
    const f = gateFixture({ dirty: true })
    priorResult(f.dir)
    const argsBefore = readFileSync(f.args, 'utf8')
    const resultBefore = readFileSync(f.result, 'utf8')

    expect(redispatch(f.plan, f.args).code).toBe(3)

    expect(readFileSync(f.args, 'utf8')).toBe(argsBefore)      // not rewritten at all
    expect(readArgs(f.args).rounds).toBe(1)                     // not incremented
    expect(readFileSync(f.result, 'utf8')).toBe(resultBefore)   // previous verdict still readable
    expect(existsSync(join(f.dir, 'result-round1.json'))).toBe(false) // not rotated
  })

  test('a lint verdict that cannot be counted refuses too — the gate fails CLOSED', () => {
    // With neither a task table nor a mechanical check, plan-lint exits 2 and prints no JSON.
    const f = gateFixture({ uncountable: true })
    const argsBefore = readFileSync(f.args, 'utf8')
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/countable|unlinted/i)
    expect(readFileSync(f.args, 'utf8')).toBe(argsBefore)
  })

  test('--no-lint dispatches without linting, as work-dispatch.sh does', () => {
    const f = gateFixture({ dirty: true })
    priorResult(f.dir)
    const r = redispatch(f.plan, f.args, '--no-lint')
    expect(r.code).toBe(0)
    expect(readArgs(f.args).rounds).toBe(2)
  })
})

/**
 * The FAIL loop amends the plan and re-hashes, so THIS is the script that most often replaces the
 * bytes a run was approved with. Archiving only at first dispatch would preserve round 1 and lose
 * every amendment after it — the rounds that actually shipped.
 */
describe('a re-dispatched plan is archived beside args.json, like a first dispatch', () => {
  const archives = (dir: string) => readdirSync(dir).filter(f => /^plan-[0-9a-f]{12}\.md$/.test(f))

  test('the amended plan is archived under the hash the re-dispatch just recorded', () => {
    const f = gateFixture()
    priorResult(f.dir)
    expect(redispatch(f.plan, f.args).code).toBe(0)

    const found = archives(f.dir)
    expect(found).toHaveLength(1)
    expect(readFileSync(join(f.dir, found[0]), 'utf8')).toBe(readFileSync(f.plan, 'utf8'))
    expect(found[0]).toBe(`plan-${readArgs(f.args).specHash.slice(0, 12)}.md`)
  })

  test('a refused re-dispatch archives nothing — it spends no round and leaves no artifact', () => {
    const f = gateFixture({ dirty: true })
    priorResult(f.dir)
    expect(redispatch(f.plan, f.args).code).toBe(3)
    expect(archives(f.dir)).toEqual([])
  })

  test('a re-hash-only call archives nothing — no round runs under those bytes', () => {
    const f = gateFixture()
    expect(run(f.plan, f.args).code).toBe(0)
    expect(archives(f.dir)).toEqual([])
  })
})

// ------------------------------------------------------------------ the selective re-run, derived
//
// the work skill has supported `onlyTasks` + `priorResults` all along, and a live 8-round run set NEITHER,
// eight times running: every round re-ran 6 tasks x2, 6 red probes x2, 5 lenses and 5 mechanical
// checks — ~34 agents — when typically 3 findings across 3 tasks needed fixing. A capability that
// depends on the orchestrator remembering it is not a capability. work-redispatch.sh already reads
// and rotates the previous result.json, so it derives the scope itself.
//
// The transitive-dependents closure is the SOUNDNESS condition, not an optimisation: if T2 is
// re-run and rewrites a file T3 reads, T3's carried "verified" record was earned against code that
// no longer exists. Carrying it forward reports a pass for work nobody checked.

/**
 * Five tasks, T2 -> T3 -> T4 by `dependsOn`, T1 and T5 independent. Every `redCommand` names a real
 * script that is genuinely red, so the dispatch-time probe passes and the only thing under test is
 * which tasks the selection picks.
 */
function selFixture(opts: { extra?: Record<string, unknown>; paths?: Record<string, string[]> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'work-redispatch-sel-'))
  scratch.push(dir)
  const plan = join(dir, 'plan.md')
  const args = join(dir, 'args.json')
  const deps: Record<string, string[]> = { T3: ['T2'], T4: ['T3'] }
  const tasks = [1, 2, 3, 4, 5].map(i => {
    redScript(dir, `red${i}.sh`, 'echo "1 failed"\nexit 1')
    return {
      id: `T${i}`, name: `task ${i}`, work: `do part ${i}`,
      writablePaths: opts.paths?.[`T${i}`] ?? [`src/t${i}`], refs: [],
      redCommand: `bash scripts/red${i}.sh`, acceptance: `\`bash scripts/red${i}.sh\` exits 0`,
      ...(deps[`T${i}`] ? { dependsOn: deps[`T${i}`] } : {}),
    }
  })
  const clean = {
    projectDir: dir,
    goal: 'make the thing correct',
    tasks,
    mechanicalChecks: [{ name: 'tests', cmd: 'bun test' }],
    lens: { agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' },
  }
  writeFileSync(plan, '# Plan\n\n## Run sizing\n\nnothing parked\n\n' +
    `<!-- work:dispatch\n${JSON.stringify({ runId: 'sel-run', args: clean }, null, 2)}\n-->\n`)
  writeFileSync(args, JSON.stringify({
    ...clean, planPath: plan, specHash: '0'.repeat(64), rounds: 1, ...(opts.extra ?? {}),
  }, null, 2) + '\n')
  return { dir, plan, args, result: join(dir, 'result.json') }
}

/** A previous round's verdict carrying per-task records for every task it settled. */
function selResult(
  dir: string,
  flagged: string[],
  opts: {
    settled?: string[]; noRedFor?: string[]; findings?: unknown[]; mechFailed?: unknown[]; rulesThatFailed?: unknown[]
    /** RED-mode diagnoses: {failure, ownerTask, cause, fix}. ownerTask is a task id or 'plan'. */
    routes?: unknown[]
    /** Blocking items whose owner is the PLAN — no task's writablePaths can reach them. */
    planFindings?: unknown[]
  } = {},
) {
  const settled = opts.settled ?? ['T1', 'T2', 'T3', 'T4', 'T5'].filter(id => !flagged.includes(id))
  const noRed = new Set(opts.noRedFor ?? [])
  const previousTasks = readArgs(join(dir, 'args.json')).tasks
  writeFileSync(join(dir, 'result.json'), JSON.stringify({
    overallPass: false, verdict: 'FAIL',
    implemented: settled.map(id => ({ id, done: true })),
    verified: settled.map(id => ({ id, pass: true })),
    red: settled.filter(id => !noRed.has(id)).map(id => ({
      id, command: previousTasks.find((t: any) => t.id === id).redCommand, verdict: 'red-green',
    })),
    tasksThatFlagged: flagged,
    mechanicalThatFailed: opts.mechFailed ?? [],
    rulesThatFailed: opts.rulesThatFailed ?? [],
    lensesThatFlagged: opts.findings?.length ? ['lens'] : [],
    findings: opts.findings ?? [],
    routes: opts.routes ?? [],
    planFindings: opts.planFindings ?? [],
  }, null, 2) + '\n')
}

const only = (p: string): string[] | undefined => readArgs(p).onlyTasks
const carriedIds = (p: string, key: string): string[] =>
  ((readArgs(p).priorResults ?? {})[key] ?? []).map((r: any) => r.id).sort()

describe('work-redispatch.sh derives the selective re-run from the previous verdict', () => {
  test('a flagged task with NO dependents re-runs alone; every other task is carried', () => {
    const f = selFixture()
    selResult(f.dir, ['T5'])
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toEqual(['T5'])
    expect(carriedIds(f.args, 'verified')).toEqual(['T1', 'T2', 'T3', 'T4'])
  })

  test('SOUNDNESS: a flagged task drags its TRANSITIVE dependents into the re-run', () => {
    // T2 flagged; T3 dependsOn T2 and T4 dependsOn T3. T4 is two edges away and must still re-run —
    // its carried "verified" was earned against code T2 is about to rewrite.
    const f = selFixture()
    selResult(f.dir, ['T2'])
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toEqual(['T2', 'T3', 'T4'])
    expect(carriedIds(f.args, 'verified')).toEqual(['T1', 'T5'])
    expect(r.out).toMatch(/dependent/i)
  })

  test('a carried task keeps its `red` adjudication — dropping it re-reads as redUnproven', () => {
    const f = selFixture()
    selResult(f.dir, ['T5'])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    const red = readArgs(f.args).priorResults.red
    expect(red.map((x: any) => x.id).sort()).toEqual(['T1', 'T2', 'T3', 'T4'])
    expect(red.every((x: any) => x.verdict === 'red-green')).toBe(true)
  })

  test('a carried red-gated task with NO carried adjudication is re-run, not carried as unproven', () => {
    const f = selFixture()
    selResult(f.dir, ['T5'], { noRedFor: ['T1'] })
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)!.sort()).toEqual(['T1', 'T5'])
    expect(carriedIds(f.args, 'verified')).toEqual(['T2', 'T3', 'T4'])
  })

  test('an ABSENT previous result falls back to a full re-run, and says so', () => {
    const f = selFixture({ extra: { onlyTasks: ['T2'], priorResults: { implemented: [{ id: 'T1' }] } } })
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toBeUndefined()
    expect(readArgs(f.args).priorResults).toBeUndefined()
    expect(r.out).toMatch(/FULL re-run/)
  })

  test('an UNREADABLE previous result falls back to a full re-run, and says so', () => {
    const f = selFixture()
    writeFileSync(f.result, '{ this is not JSON')
    const r = redispatch(f.plan, f.args, '--no-lint')  // an unreadable verdict also stops plan-lint
    expect(r.code).toBe(0)
    expect(only(f.args)).toBeUndefined()
    expect(r.out).toMatch(/FULL re-run/)
  })

  test('a previous verdict whose tasksThatFlagged cannot be parsed falls back to a full re-run', () => {
    const f = selFixture()
    selResult(f.dir, ['T5'])
    const bad = JSON.parse(readFileSync(f.result, 'utf8'))
    bad.tasksThatFlagged = 'T5'                      // a string, not the array the contract promises
    writeFileSync(f.result, JSON.stringify(bad, null, 2))
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toBeUndefined()
    expect(r.out).toMatch(/FULL re-run/)
  })

  test('a verdict flagging a task absent from tasks[] falls back to a full re-run rather than scoping to a guess', () => {
    const f = selFixture()
    selResult(f.dir, ['T9'])
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toBeUndefined()
    expect(r.out).toMatch(/FULL re-run/)
  })

  test('an EMPTY tasksThatFlagged is a full re-run — a lens or mechanical FAIL names no task to scope to', () => {
    const f = selFixture()
    selResult(f.dir, [])
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toBeUndefined()
    expect(r.out).toMatch(/FULL re-run/)
  })

  test('--full opts out and CLEARS a selection a previous round left behind', () => {
    const f = selFixture({ extra: { onlyTasks: ['T2'], priorResults: { implemented: [{ id: 'T1' }] } } })
    selResult(f.dir, ['T5'])
    const r = redispatch(f.plan, f.args, '--full')
    expect(r.code).toBe(0)
    expect(only(f.args)).toBeUndefined()
    // The stale implemented/verified records are gone — every task is re-run, so none of them holds.
    // M1 keeps the proven RED adjudications, and only those: see the M1 tests below.
    expect(readArgs(f.args).priorResults.implemented).toEqual([])
    expect(readArgs(f.args).priorResults.verified).toEqual([])
  })

  test('the selection is printed — a scope nobody can see is a scope nobody can check', () => {
    const f = selFixture()
    selResult(f.dir, ['T2'])
    const out = redispatch(f.plan, f.args).out
    expect(out).toMatch(/T2/)
    expect(out).toMatch(/carr/i)
  })

  test('the selection is NOT applied on the re-hash-only path — that call restructures no run', () => {
    const f = selFixture({ extra: { onlyTasks: ['T1'] } })
    selResult(f.dir, ['T5'])
    expect(run(f.plan, f.args).code).toBe(0)
    expect(only(f.args)).toEqual(['T1'])
  })
})

/**
 * A FAIL carried entirely by review lenses names no task: `tasksThatFlagged` is [] because no
 * implementer, verifier or red gate failed. Selection fell back to FULL, and FULL re-probes every red
 * command — including the ones the previous round FIXED, which now exit 0 and are refused as
 * `red-not-red`. The round could not be dispatched at all, on a verdict whose findings were confined
 * to two files. The mapping is the one plan-lint already uses: a finding names a `file`, and a task
 * declares the paths it may write.
 */
describe('a lens-only FAIL is narrowed by the files its findings name', () => {
  const major = (file: string, title = 'the gate asserts existence only') =>
    ({ title, severity: 'major', detail: 'why it is wrong', file, lens: 'k' })

  test('a finding in one task’s writablePaths scopes the re-run to that task', () => {
    const f = selFixture()
    selResult(f.dir, [], { findings: [major('src/t5/thing.ts')] })
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toEqual(['T5'])
    expect(carriedIds(f.args, 'verified')).toEqual(['T1', 'T2', 'T3', 'T4'])
    expect(r.out).toMatch(/lens-only FAIL/)
  })

  test('an ABSOLUTE path in the finding still maps — findings carry absolute paths, writablePaths do not', () => {
    const f = selFixture()
    selResult(f.dir, [], { findings: [major(join(f.dir, 'src/t5/thing.ts'))] })
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toEqual(['T5'])
  })

  test('two findings in two tasks select both', () => {
    const f = selFixture()
    selResult(f.dir, [], { findings: [major('src/t1/a.ts'), major('src/t5/b.ts', 'a second defect')] })
    expect(redispatch(f.plan, f.args).code).toBe(0)
    expect(only(f.args)!.sort()).toEqual(['T1', 'T5'])
  })

  // SOUNDNESS, the same condition the flagged path enforces: anything reading a re-run task's output
  // was verified against code that is about to change.
  test('the mapped task drags its transitive dependents in', () => {
    const f = selFixture()
    selResult(f.dir, [], { findings: [major('src/t2/a.ts')] })
    expect(redispatch(f.plan, f.args).code).toBe(0)
    expect(only(f.args)).toEqual(['T2', 'T3', 'T4'])
  })

  // ONE unmapped finding is enough: scoping to the rest would carry a task the unmapped finding may
  // be about, on a "verified" record earned before the fix.
  test('a finding that maps to NO task falls back to FULL, and names the finding', () => {
    const f = selFixture()
    selResult(f.dir, [], { findings: [major('src/t5/a.ts'), major('docs/elsewhere.md', 'unowned')] })
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toBeUndefined()
    expect(r.out).toMatch(/FULL re-run/)
    expect(r.out).toContain('unowned')
  })

  test('a finding with no `file` at all falls back to FULL', () => {
    const f = selFixture()
    const { file, ...noFile } = major('src/t5/a.ts')
    selResult(f.dir, [], { findings: [noFile] })
    const r = redispatch(f.plan, f.args)
    expect(only(f.args)).toBeUndefined()
    expect(r.out).toMatch(/names no file/)
  })

  // A mechanical failure is attributable to no task and no file, and mechanical checks re-run under
  // any scope — so narrowing would leave the round failing on a check nobody selected can touch.
  test('a failed mechanical check forbids the narrowing, even with mappable findings', () => {
    const f = selFixture()
    selResult(f.dir, [], {
      findings: [major('src/t5/a.ts')],
      mechFailed: [{ name: 'tests', exitCode: 1, output: 'boom' }],
    })
    const r = redispatch(f.plan, f.args)
    expect(only(f.args)).toBeUndefined()
    expect(r.out).toMatch(/FULL re-run/)
    expect(r.out).toMatch(/mechanical/)
  })

  test('a MINOR finding is not a blocking finding and scopes nothing', () => {
    const f = selFixture()
    selResult(f.dir, [], { findings: [{ ...major('src/t5/a.ts'), severity: 'minor' }] })
    const r = redispatch(f.plan, f.args)
    expect(only(f.args)).toBeUndefined()
    expect(r.out).toMatch(/FULL re-run/)
  })

  /**
   * M1. A finding's `file` is written by a model reading a diff, so it routinely carries a location.
   * With the suffix on, `coveredBy` matched NO writablePath, every located finding was an orphan, the
   * round fell back to FULL, and FULL re-probed red commands the previous round had fixed — so the run
   * dead-ended on `red-not-red` over work that was done. All three location forms are pinned, because
   * fixing only `:135` is how the range form stayed broken.
   *
   * The writablePath here is the FILE, not its directory: `coveredBy` is a prefix test, so `a/` matches
   * `a/b.go:135-140` suffix and all, and a directory-scoped fixture would pass with the strip removed.
   * The plans this defect was measured on declare exact files.
   */
  test("a finding file 'a/b.go:135-140' maps to the task owning a/b.go", () => {
    const f = selFixture({ paths: { T5: ['a/b.go'] } })
    selResult(f.dir, [], { findings: [major('a/b.go:135-140')] })
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toEqual(['T5'])
    expect(r.out).toMatch(/lens-only FAIL/)
    // The mapping is reported by the STRIPPED path, so a reader can see which path was matched.
    expect(r.out).toContain('a/b.go ->')
  })

  test('the single-line and column location forms map too', () => {
    for (const file of ['a/b.go:135', 'a/b.go:135:8']) {
      const f = selFixture({ paths: { T5: ['a/b.go'] } })
      selResult(f.dir, [], { findings: [major(file)] })
      expect(redispatch(f.plan, f.args).code).toBe(0)
      expect(only(f.args)).toEqual(['T5'])
    }
  })

  // An ABSOLUTE path carrying a location is both transformations at once: relativise, then strip.
  test('an absolute path with a line range maps too', () => {
    const f = selFixture({ paths: { T5: ['a/b.go'] } })
    selResult(f.dir, [], { findings: [major(join(f.dir, 'a/b.go') + ':135-140')] })
    expect(redispatch(f.plan, f.args).code).toBe(0)
    expect(only(f.args)).toEqual(['T5'])
  })

  // The strip must not eat a real path: a task may legitimately own a file whose name ends in digits.
  test('a path with no location suffix is untouched', () => {
    const f = selFixture({ paths: { T5: ['a/b2.go'] } })
    selResult(f.dir, [], { findings: [major('a/b2.go')] })
    expect(redispatch(f.plan, f.args).code).toBe(0)
    expect(only(f.args)).toEqual(['T5'])
  })
})

/**
 * M1's other half, M2 and M3 — the three ways the loop used to dead-end.
 *
 * M1  a FULL re-run dropped every red adjudication, so the probe re-ran a command the implementer had
 *     already made pass, classified it `red-not-red`, and refused the round at dispatch.
 * M2  a mechanical failure was attributable to no task, so any round carrying one re-ran everything —
 *     and a failure no task CAN fix had no channel at all.
 * M3  carried findings reached only the review leg, never the implementer that had to fix them.
 */
describe('M1/M2/M3 — the loop no longer dead-ends', () => {
  const major = (file: string, title = 'the gate asserts existence only', over: Record<string, unknown> = {}) =>
    ({ title, severity: 'major', detail: 'why it is wrong', file, lens: 'lens', ...over })

  /** Re-hash WITHOUT dispatching, so args.specHash becomes the plan's real hash and the next
   *  --dispatch sees an UNCHANGED hash. The loop's "nothing was amended" state, reproduced. */
  const syncHash = (f: { plan: string; args: string }) => {
    const r = run(f.plan, f.args)
    expect(r.code).toBe(0)
    return r
  }

  // ---- M1: a FULL re-run keeps the proven red pair ------------------------------------------------
  // red1.sh is rewritten to PASS, which is what a fixed task looks like. Without the carry the probe
  // observes exit 0, classifies `red-not-red`, and refuses the whole round — the measured dead end.
  test('a FULL round-2 re-run does not re-probe a task with a carried proven red', () => {
    const f = selFixture()
    selResult(f.dir, ['T5'])                       // T1..T4 settled with verdict red-green
    redScript(f.dir, 'red1.sh', 'echo "1 passed"\nexit 0')   // T1 is FIXED
    const r = redispatch(f.plan, f.args, '--full')
    expect(r.code).toBe(0)
    expect(only(f.args)).toBeUndefined()           // FULL: every task re-runs
    const red = readArgs(f.args).priorResults.red
    expect(red.map((x: any) => x.id).sort()).toEqual(['T1', 'T2', 'T3', 'T4'])
    expect(r.out).toMatch(/carried red adjudications, NOT re-probed/)
    // The probe itself skipped it, and said so rather than silently not running.
    expect(r.out).toMatch(/red-probe T1: carried red-green — not re-probed/)
    expect(r.out).not.toMatch(/red-not-red/)
  })

  const amendRed = (f: { dir: string; plan: string }, id: string) => {
    const n = id.slice(1)
    const command = `bash scripts/amended-red${n}.sh`
    redScript(f.dir, `amended-red${n}.sh`, `echo probed > reprobed-${id}\necho "1 failed"\nexit 1`)
    writeFileSync(f.plan, readFileSync(f.plan, 'utf8').replaceAll(`bash scripts/red${n}.sh`, command))
    return command
  }

  test('a carried red record whose command changed is dropped and re-probed', () => {
    const f = selFixture()
    selResult(f.dir, ['T5'])
    const command = amendRed(f, 'T1')
    const r = redispatch(f.plan, f.args, '--full')
    expect(r.code).toBe(0)
    expect(readArgs(f.args).tasks[0].redCommand).toBe(command)
    expect(existsSync(join(f.dir, 'reprobed-T1'))).toBe(true)
    expect(r.out).toMatch(/red-probe T1: red \(exit 1\)/)
    expect(r.out).not.toMatch(/red-probe T1: carried/)
    expect(carriedIds(f.args, 'red')).toEqual(['T2', 'T3', 'T4'])
  })

  test('a changed redCommand makes an otherwise carried task active in a scoped round', () => {
    const f = selFixture()
    selResult(f.dir, ['T5'])
    amendRed(f, 'T1')
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toEqual(['T1', 'T5'])
    expect(carriedIds(f.args, 'verified')).toEqual(['T2', 'T3', 'T4'])
    expect(carriedIds(f.args, 'red')).toEqual(['T2', 'T3', 'T4'])
    expect(existsSync(join(f.dir, 'reprobed-T1'))).toBe(true)
  })

  test('a selected task with a changed redCommand drops its stale proof in a scoped round', () => {
    const f = selFixture()
    selResult(f.dir, ['T5'], { settled: ['T1', 'T2', 'T3', 'T4', 'T5'] })
    amendRed(f, 'T5')
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toEqual(['T5'])
    expect(carriedIds(f.args, 'red')).toEqual(['T1', 'T2', 'T3', 'T4'])
    expect(existsSync(join(f.dir, 'reprobed-T5'))).toBe(true)
  })

  test('a plan-only amendment changing redCommand cannot carry an unobserved command into onlyTasks []', () => {
    const f = selFixture()
    const routed = { failure: 'tests exited 1', ownerTask: 'plan', cause: 'c', fix: 'x' }
    selResult(f.dir, [], {
      mechFailed: [{ name: 'tests', exitCode: 1 }], routes: [routed], planFindings: [routed],
    })
    amendRed(f, 'T1')
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toBeUndefined()
    expect(carriedIds(f.args, 'red')).toEqual(['T2', 'T3', 'T4', 'T5'])
    expect(existsSync(join(f.dir, 'reprobed-T1'))).toBe(true)
  })

  test('a legacy red record without a command is dropped and re-probed', () => {
    const f = selFixture()
    selResult(f.dir, ['T5'])
    const previous = readArgs(f.result)
    delete previous.red.find((r: any) => r.id === 'T1').command
    writeFileSync(f.result, JSON.stringify(previous))
    redScript(f.dir, 'red1.sh', 'echo probed > reprobed-T1\necho "1 failed"\nexit 1')
    const r = redispatch(f.plan, f.args, '--full')
    expect(r.code).toBe(0)
    expect(carriedIds(f.args, 'red')).toEqual(['T2', 'T3', 'T4'])
    expect(existsSync(join(f.dir, 'reprobed-T1'))).toBe(true)
  })

  test('without a carried proven red the same FULL re-run is REFUSED as red-not-red', () => {
    const f = selFixture()
    // No `red` records at all: the previous verdict settles nothing to carry.
    selResult(f.dir, ['T5'], { noRedFor: ['T1', 'T2', 'T3', 'T4', 'T5'] })
    redScript(f.dir, 'red1.sh', 'echo "1 passed"\nexit 0')
    const r = redispatch(f.plan, f.args, '--full')
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/red-not-red/)
  })

  test('a SCOPED re-run also carries the proven red of a re-run task', () => {
    const f = selFixture()
    // T5 flagged AND settled, so its proven pair exists and must travel even though T5 re-runs.
    selResult(f.dir, ['T5'], { settled: ['T1', 'T2', 'T3', 'T4', 'T5'] })
    redScript(f.dir, 'red5.sh', 'echo "1 passed"\nexit 0')
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toEqual(['T5'])
    expect(readArgs(f.args).priorResults.red.map((x: any) => x.id).sort())
      .toEqual(['T1', 'T2', 'T3', 'T4', 'T5'])
    expect(r.out).toMatch(/proven red carried, NOT re-probed/)
  })

  // ---- M2: a mechanical failure the lens routed --------------------------------------------------
  test('a lens-routed rule failure narrows to its owner', () => {
    const f = selFixture()
    selResult(f.dir, [], {
      rulesThatFailed: [{ name: 'Rule 3', exitCode: 1, output: 'broken' }],
      routes: [{ failure: 'Rule 3', ownerTask: 'T5',
                 cause: 'broken', fix: 'fix' }],
    })
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toEqual(['T5'])
    expect(carriedIds(f.args, 'verified')).toEqual(['T1', 'T2', 'T3', 'T4'])
    expect(r.out).toMatch(/mechanical\/rule failure\(s\) the lens routed to an owner/)
    expect(r.out).toContain('Rule 3 -> T5')
  })

  test('a lens-routed mechanical failure narrows to its owner', () => {
    const f = selFixture()
    selResult(f.dir, [], {
      mechFailed: [{ name: 'tests', exitCode: 1, output: 'boom' }],
      routes: [{ failure: 'mechanical check tests exited 1', ownerTask: 'T5',
                 cause: 'the assertion reads a key the writer never emits', fix: 'emit the key' }],
    })
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toEqual(['T5'])
    expect(carriedIds(f.args, 'verified')).toEqual(['T1', 'T2', 'T3', 'T4'])
    expect(r.out).toMatch(/mechanical\/rule failure\(s\) the lens routed to an owner/)
    expect(r.out).toContain('tests -> T5')
  })

  test('a mechanical failure routed to an owner also drags that owner’s dependents in', () => {
    const f = selFixture()
    selResult(f.dir, [], {
      mechFailed: [{ name: 'tests', exitCode: 1 }],
      routes: [{ failure: 'tests exited 1', ownerTask: 'T2', cause: 'c', fix: 'x' }],
    })
    expect(redispatch(f.plan, f.args).code).toBe(0)
    expect(only(f.args)).toEqual(['T2', 'T3', 'T4'])
  })

  // The route has to name an owner the PLAN declares. A typo is not a narrowing.
  test('an unrouted mechanical failure forces FULL even when another task is flagged', () => {
    const f = selFixture()
    selResult(f.dir, ['T5'], { mechFailed: [{ name: 'tests', exitCode: 1 }] })
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toBeUndefined()
    expect(r.out).toContain('no lens route to a valid owner (tests)')
  })

  test('a route naming an unknown task narrows nothing and falls back to FULL', () => {
    const f = selFixture()
    selResult(f.dir, [], {
      mechFailed: [{ name: 'tests', exitCode: 1 }],
      routes: [{ failure: 'tests exited 1', ownerTask: 'T99', cause: 'c', fix: 'x' }],
    })
    const r = redispatch(f.plan, f.args)
    expect(only(f.args)).toBeUndefined()
    expect(r.out).toMatch(/no lens route to a valid owner/)
  })

  // ---- M2, second half: the plan-routed failure ---------------------------------------------------
  test('a plan-routed rule failure with an unchanged hash exits 3', () => {
    const f = selFixture()
    syncHash(f)
    const routed = { failure: 'Rule 4', ownerTask: 'plan', cause: 'x', fix: 'x' }
    selResult(f.dir, [], {
      rulesThatFailed: [{ name: 'Rule 4', exitCode: 1 }],
      routes: [routed], planFindings: [routed],
    })
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(3)
    expect(r.stderr || r.out).toMatch(/item\(s\) in .* are routed to the PLAN, and the spec hash is unchanged/)
  })

  test('a plan-routed failure after a hash change dispatches onlyTasks []', () => {
    const f = selFixture()                         // args.specHash is 0*64, so the hash CHANGES
    const routed = { failure: 'mechanical check tests exited 1', ownerTask: 'plan',
                     cause: 'the artifact is outside every task’s writablePaths',
                     fix: 'add scripts/gen.ts to a task’s writablePaths' }
    selResult(f.dir, [], {
      mechFailed: [{ name: 'tests', exitCode: 1 }],
      routes: [routed], planFindings: [routed],
    })
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toEqual([])
    expect(r.out).toMatch(/ZERO-IMPLEMENTER round/)
    // workflow.js refuses onlyTasks: [] unless priorResults carries EVERY task.
    const pr = readArgs(f.args).priorResults
    expect(pr.implemented.map((x: any) => x.id).sort()).toEqual(['T1', 'T2', 'T3', 'T4', 'T5'])
    expect(pr.verified.map((x: any) => x.id).sort()).toEqual(['T1', 'T2', 'T3', 'T4', 'T5'])
    // And no probe is dispatched: every task carries a proven pair.
    expect(r.out).toMatch(/no active task needs a probe/)
  })

  test('a zero-implementer round is refused when the previous verdict carries a task short', () => {
    const f = selFixture()
    const routed = { failure: 'tests exited 1', ownerTask: 'plan', cause: 'c', fix: 'x' }
    selResult(f.dir, [], {
      settled: ['T1', 'T2', 'T3', 'T4'],           // T5 has no implemented/verified record
      mechFailed: [{ name: 'tests', exitCode: 1 }],
      routes: [routed], planFindings: [routed],
    })
    const r = redispatch(f.plan, f.args)
    expect(only(f.args)).toBeUndefined()
    expect(r.out).toMatch(/FULL re-run/)
    expect(r.out).toContain('T5')
  })

  // ---- M1: planFindings with nothing amended ------------------------------------------------------
  test('planFindings with an unchanged hash exits 3 with the amend message', () => {
    const f = selFixture()
    syncHash(f)                                     // args.specHash == the plan's hash from here on
    const routed = { title: 'the generated file is outside every writablePath', severity: 'major',
                     detail: 'no task can write scripts/gen.ts', file: 'scripts/gen.ts',
                     ownerTask: 'plan', lens: 'lens' }
    selResult(f.dir, [], { findings: [routed], planFindings: [routed] })
    const before = readFileSync(f.args, 'utf8')

    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(3)
    expect(r.out).toContain("amend the plan: add <path> to a task's writablePaths (or reword), then re-hash")
    expect(r.out).toContain('scripts/gen.ts')
    // Nothing was spent: the refusal is before every mutation.
    expect(readFileSync(f.args, 'utf8')).toBe(before)
    expect(readArgs(f.args).rounds).toBe(2)
    expect(existsSync(join(f.dir, 'result-round1.json'))).toBe(false)
  })

  test('the same planFindings AFTER the plan is amended dispatches instead of refusing', () => {
    const f = selFixture()
    syncHash(f)
    const routed = { title: 'outside every writablePath', severity: 'major', detail: 'd',
                     file: 'scripts/gen.ts', ownerTask: 'plan', lens: 'lens' }
    selResult(f.dir, [], { findings: [routed], planFindings: [routed] })
    // The amendment: a VALUE inside the dispatch block, which is what moves the spec hash.
    writeFileSync(f.plan, readFileSync(f.plan, 'utf8').replace('"do part 1"', '"do part 1, AMENDED"'))
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toEqual([])
    expect(r.out).toMatch(/ZERO-IMPLEMENTER round/)
  })

  test('no planFindings and an unchanged hash is not refused', () => {
    const f = selFixture()
    syncHash(f)
    selResult(f.dir, ['T5'])
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(only(f.args)).toEqual(['T5'])
  })

  // ---- M3: taskFixes ------------------------------------------------------------------------------
  test('taskFixes are built from the previous result', () => {
    const f = selFixture()
    const route = { failure: 'mechanical check tests exited 1', ownerTask: 'T1',
                    cause: 'the writer emits no key', fix: 'emit it' }
    selResult(f.dir, ['T1'], {
      settled: ['T2', 'T3', 'T4', 'T5'],
      routes: [route],
      findings: [major('src/t5/a.ts', 'T5 owns this one', { ownerTask: 'T5' })],
    })
    expect(redispatch(f.plan, f.args).code).toBe(0)
    const fixes = readArgs(f.args).taskFixes
    expect(Object.keys(fixes).sort()).toEqual(['T1', 'T5'])
    expect(fixes.T1[0].failure).toBe('mechanical check tests exited 1')
    expect(fixes.T1[0].cause).toBe('the writer emits no key')
    expect(fixes.T5[0].title).toBe('T5 owns this one')
  })

  // workflow.js THROWS on a taskFixes key naming a task the plan does not declare, which would kill the
  // round before an agent is dispatched. An invalid owner is dropped here rather than passed on.
  test('a fix item whose ownerTask is unknown is dropped, not passed to workflow.js', () => {
    const f = selFixture()
    selResult(f.dir, ['T1'], {
      routes: [{ failure: 'f', ownerTask: 'T99', cause: 'c', fix: 'x' }],
    })
    expect(redispatch(f.plan, f.args).code).toBe(0)
    expect('taskFixes' in readArgs(f.args)).toBe(false)
  })

  test('a MINOR finding is not a fix item — only blocking routes and findings are', () => {
    const f = selFixture()
    selResult(f.dir, ['T1'], {
      findings: [major('src/t5/a.ts', 'a nit', { ownerTask: 'T5', severity: 'minor' })],
    })
    expect(redispatch(f.plan, f.args).code).toBe(0)
    expect('taskFixes' in readArgs(f.args)).toBe(false)
  })

  // args.json outlives the round, so a taskFixes left from round N-1 would hand round N a fix list for
  // failures that are already closed.
  test('a stale taskFixes from the previous round is cleared', () => {
    const f = selFixture({ extra: { taskFixes: { T1: ['a fix from two rounds ago'] } } })
    selResult(f.dir, ['T1'], { settled: ['T2', 'T3', 'T4', 'T5'] })
    expect(redispatch(f.plan, f.args).code).toBe(0)
    expect('taskFixes' in readArgs(f.args)).toBe(false)
  })

  test('taskFixes survive a FULL re-run — the implementer still has to be told', () => {
    const f = selFixture()
    selResult(f.dir, ['T1'], {
      routes: [{ failure: 'f', ownerTask: 'T1', cause: 'c', fix: 'x' }],
    })
    const r = redispatch(f.plan, f.args, '--full')
    expect(r.code).toBe(0)
    expect(only(f.args)).toBeUndefined()
    expect(Object.keys(readArgs(f.args).taskFixes)).toEqual(['T1'])
    expect(r.out).toMatch(/taskFixes -> implementer prompts/)
  })
})

describe('the dispatch-time redCommand probe on the re-dispatch path', () => {
  test('a selected task whose redCommand exits 127 is refused before anything is spent', () => {
    const f = selFixture()
    selResult(f.dir, ['T5'])
    rmSync(join(f.dir, 'scripts', 'red5.sh'))
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/could-not-run/)
    expect(r.out).toMatch(/T5/)
  })

  test('a selected task whose redCommand already exits 0 is refused as red-not-red', () => {
    const f = selFixture()
    selResult(f.dir, ['T5'])
    redScript(f.dir, 'red5.sh', 'echo "3 passed"\nexit 0')
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/red-not-red/)
  })

  test('a CARRIED task with a broken redCommand does not refuse — it is not being re-run', () => {
    const f = selFixture()
    selResult(f.dir, ['T5'])
    rmSync(join(f.dir, 'scripts', 'red1.sh'))     // T1 is carried, so nothing probes it
    expect(redispatch(f.plan, f.args).code).toBe(0)
  })

  test('a probe refusal spends nothing: rounds, args.json and result.json are untouched', () => {
    const f = selFixture()
    selResult(f.dir, ['T5'])
    redScript(f.dir, 'red5.sh', 'echo "3 passed"\nexit 0')
    const argsBefore = readFileSync(f.args, 'utf8')
    const resultBefore = readFileSync(f.result, 'utf8')

    expect(redispatch(f.plan, f.args).code).toBe(3)

    expect(readFileSync(f.args, 'utf8')).toBe(argsBefore)
    expect(readArgs(f.args).rounds).toBe(1)
    expect(readFileSync(f.result, 'utf8')).toBe(resultBefore)
    expect(existsSync(join(f.dir, 'result-round1.json'))).toBe(false)
    expect(existsSync(join(f.dir, '.args.redispatch.json'))).toBe(false)
  })

  test('--no-red-probe is the escape hatch on this path too', () => {
    const f = selFixture()
    selResult(f.dir, ['T5'])
    redScript(f.dir, 'red5.sh', 'echo "3 passed"\nexit 0')
    expect(redispatch(f.plan, f.args, '--no-red-probe').code).toBe(0)
  })
})

describe('the red column is echoed on re-hash too, from work-dispatch.sh\'s one implementation', () => {
  test('a dispositioned task is counted and its claim printed verbatim', () => {
    const f = fixture({ planWork: 'w', planRed: 'false', argsWork: 'w', argsRed: 'false' })
    const plan = readFileSync(f.plan, 'utf8')
    const block = JSON.parse(plan.match(/<!--\s*work:dispatch\s*\n([\s\S]*?)\n-->/)![1])
    block.args.tasks.push({
      id: 't4', name: 'four', work: 'already done', writablePaths: ['b.txt'], refs: [],
      redDisposition: 'work complete round 6; covered by extraction-unity lens', acceptance: 'it passes',
    })
    writeFileSync(f.plan, `# Plan\n\n<!-- work:dispatch\n${JSON.stringify(block, null, 2)}\n-->\n`)
    const r = run(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/red: 1 gated, 1 dispositioned/)
    expect(r.stdout).toMatch(/t4\s+"work complete round 6; covered by extraction-unity lens"/)
  })

  test('a run with no dispositions says so rather than printing nothing — REGRESSION GUARD', () => {
    const f = fixture({ planWork: 'w', planRed: 'false', argsWork: 'w', argsRed: 'false' })
    expect(run(f.plan, f.args).stdout).toMatch(/red: 1 gated, 0 dispositioned/)
  })
})

/**
 * The FAIL loop's re-hash is over the SPEC — the `work:dispatch` block's canonical JSON — not the
 * plan's bytes. So amending a rationale paragraph between rounds moves nothing, while amending the
 * task table moves the hash the agents verify.
 */
describe('work-redispatch.sh re-hashes the SPEC, not the plan bytes', () => {
  test('the synced spec hash lands in args.json as specHash, with no planHash left behind', () => {
    const f = fixture({ planWork: 'AMENDED work', planRed: 'false', argsWork: 'STALE work', argsRed: 'false' })
    expect(run(f.plan, f.args).code).toBe(0)
    const a = readArgs(f.args)
    expect(a.planHash).toBeUndefined()
    expect(a.specHash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.specHash).toBe(execFileSync('bash', [
      `${import.meta.dir}/work-dispatch.sh`, '--spec-hash', f.plan,
    ], { encoding: 'utf8' }).trim())
  })

  test('it prints old -> new SPEC hash, so the amendment is visible without opening the file', () => {
    const f = fixture({ planWork: 'AMENDED work', planRed: 'false', argsWork: 'STALE work', argsRed: 'false' })
    const r = run(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/specHash:\s+[0-9a-f]+ -> [0-9a-f]+/)
    expect(r.stdout).not.toMatch(/planHash/)
  })

  test('a PROSE-only amendment leaves the spec hash unchanged and says so', () => {
    const f = fixture({ planWork: 'w', planRed: 'false', argsWork: 'w', argsRed: 'false' })
    expect(run(f.plan, f.args).code).toBe(0)
    const first = readArgs(f.args).specHash

    writeFileSync(f.plan, readFileSync(f.plan, 'utf8').replace('# Plan', '# Plan\n\nA rationale sentence, added between rounds.'))
    const r = run(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(readArgs(f.args).specHash).toBe(first)
    expect(r.stdout).toMatch(/unchanged/)
  })

  test('amending a VALUE in the block moves the spec hash', () => {
    const f = fixture({ planWork: 'w', planRed: 'false', argsWork: 'w', argsRed: 'false' })
    expect(run(f.plan, f.args).code).toBe(0)
    const first = readArgs(f.args).specHash

    writeFileSync(f.plan, readFileSync(f.plan, 'utf8').replace('"work": "w"', '"work": "AMENDED IN THE BLOCK"'))
    expect(run(f.plan, f.args).code).toBe(0)
    expect(readArgs(f.args).specHash).not.toBe(first)
  })
})

/**
 * The fix loop's exit condition. Round 1 produces a blocking set; from round 2 that set is FROZEN
 * and carried as `carriedFindings`, so the question each round asks is "is the carried set closed?"
 * rather than "did this round's lens raise anything?" — the second is a draw from a generator
 * whose rate does not fall as fixes land. The cap is what actually stops the run.
 *
 * `carriedFindings`, not `priorFindings`: the two doors are separate, and the run's own carry must not
 * overwrite claims a human or an agent team put in `priorFindings` from outside the run.
 */
describe('the frozen finding set and the round cap', () => {
  /**
   * A previous verdict. `findings` is the gate return's STANDING pool — the lens's fresh findings plus
   * the carried entries it could not close — and `carried` is every carried entry with the lens's
   * {status, evidence} ruling on it. An evidenced `closed` there is what drops an entry.
   */
  function withFindings(dir: string, findings: unknown[], name = 'result.json', carried: unknown[] = []) {
    writeFileSync(join(dir, name), JSON.stringify({
      overallPass: false, verdict: 'FAIL',
      scoreTable: { survivingBlocking: findings.length, lensFindings: findings.length },
      tasksThatFlagged: [], mechanicalThatFailed: [], lensesThatFlagged: ['lens'],
      findings, carried, routes: [], planFindings: [],
    }, null, 2) + '\n')
  }
  const major = (title: string) => ({ title, severity: 'major', detail: 'why it is wrong', file: 'src/a.ts', lens: 'k' })
  const titles = (p: string): string[] => (readArgs(p).carriedFindings ?? []).map((x: any) => x.title)

  test('advancing to round 2 freezes the finding set and carries it as carriedFindings', () => {
    const f = gateFixture()
    withFindings(f.dir, [major('the gate asserts existence only'), { ...major('a minor nit'), severity: 'minor' }])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    const a = readArgs(f.args)
    expect(a.rounds).toBe(2)
    expect(a.freezeFindingSet).toBe(true)
    // Blocking only: a minor never gated, so carrying it would make the frozen set larger than the
    // set that failed the run.
    expect(titles(f.args)).toEqual(['the gate asserts existence only'])
    expect(a.carriedFindings[0].detail).toBe('why it is wrong')
    expect(a.carriedFindings[0].severity).toBe('major')
    // The lens rules BY id, so every carried entry must have one — a minted id is deterministic, so
    // the same finding carried twice is the same id both times.
    expect(typeof a.carriedFindings[0].id).toBe('string')
    expect(a.carriedFindings[0].id.length).toBeGreaterThan(0)
    // The other door is left alone: this is the run's own carry, not an external claim.
    expect('priorFindings' in a).toBe(false)
  })

  test('external priorFindings are not duplicated into the carry and the next spine accepts the args', async () => {
    const f = gateFixture()
    const external = { id: 'external', title: 'outside claim', severity: 'major', detail: 'd', file: 'src/e.ts' }
    const owned = { id: 'owned', title: 'run finding', severity: 'major', detail: 'd', file: 'src/a.ts' }
    const a0 = readArgs(f.args)
    a0.priorFindings = [external]
    writeFileSync(f.args, JSON.stringify(a0, null, 2))
    withFindings(f.dir, [owned, { ...external, source: 'prior' }])

    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    const a = readArgs(f.args)
    expect(a.priorFindings).toEqual([external])
    expect(a.carriedFindings.map((x: any) => x.id)).toEqual(['owned'])
    const next = await runWorkflow(a, replies())
    expect(next.result.carried.map((x: any) => x.id).sort()).toEqual(['external', 'owned'])
  })

  test('an unevidenced closed ruling leaves the carried finding open', () => {
    const f = gateFixture()
    const claim = { id: 'open', title: 'still unproven', severity: 'major', detail: 'd', file: 'src/a.ts' }
    const a0 = readArgs(f.args)
    a0.rounds = 2
    a0.freezeFindingSet = true
    a0.carriedFindings = [claim]
    writeFileSync(f.args, JSON.stringify(a0, null, 2))
    withFindings(f.dir, [], 'result.json', [{ ...claim, status: 'closed', evidence: ' ' }])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    expect(readArgs(f.args).carriedFindings.map((x: any) => x.id)).toEqual(['open'])
  })

  test('a non-object previous result falls back to FULL without emptying the carried set', () => {
    const f = gateFixture()
    const claim = { id: 'open', title: 'unjudged', severity: 'major', detail: 'd' }
    const a0 = readArgs(f.args)
    a0.rounds = 2
    a0.freezeFindingSet = true
    a0.carriedFindings = [claim]
    writeFileSync(f.args, JSON.stringify(a0, null, 2))
    writeFileSync(f.result, 'null\n')
    const r = redispatch(f.plan, f.args, '--no-lint')
    expect(r.code).toBe(0)
    expect(only(f.args)).toBeUndefined()
    expect(r.out).toMatch(/FULL re-run/)
    expect(readArgs(f.args).carriedFindings).toEqual([claim])
    expect(readArgs(f.args).freezeFindingSet).toBe(true)
  })

  test('a carried entry keeps a STABLE id across rounds — a ruling matches nothing otherwise', () => {
    const f = gateFixture()
    withFindings(f.dir, [major('a real defect')])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    const first = readArgs(f.args).carriedFindings[0].id
    // Round 3's verdict reports the same finding back, still without an id of its own.
    withFindings(f.dir, [major('a real defect')])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    expect(readArgs(f.args).carriedFindings[0].id).toBe(first)
  })

  /**
   * CARRY-OVER. The carried set used to be written ONCE, on the advance to round 2, and never touched:
   * a finding a later round settled was still carried as an open gate, and a blocking finding a later
   * round raised was never carried at all. The set was frozen against the generator and also against
   * the evidence. It is re-derived from the previous verdict every round; ADJUDICATION, not the round
   * number, is what shrinks it.
   */
  test('a carried finding that survived the round is carried again', () => {
    const f = gateFixture()
    const a0 = readArgs(f.args)
    a0.rounds = 2
    a0.freezeFindingSet = true
    a0.carriedFindings = [{ id: 'x1', title: 'carried from round 1', severity: 'major', detail: 'd', lens: 'k' }]
    writeFileSync(f.args, JSON.stringify(a0, null, 2))
    // The gate return puts a still-open carried finding back in `findings`, so this IS the carry.
    withFindings(f.dir, [{ id: 'x1', title: 'carried from round 1', severity: 'major', detail: 'd', lens: 'k' }])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    const a = readArgs(f.args)
    expect(titles(f.args)).toEqual(['carried from round 1'])
    expect(a.carriedFindings[0].id).toBe('x1')
    expect(a.freezeFindingSet).toBe(true)
  })

  test('a carried finding the lens ruled CLOSED with evidence drops out', () => {
    const f = gateFixture()
    const a0 = readArgs(f.args)
    a0.rounds = 2
    a0.freezeFindingSet = true
    a0.carriedFindings = [
      { id: 'fixed', title: 'fixed this round', severity: 'major', detail: 'd', lens: 'k' },
      { id: 'open', title: 'still open', severity: 'major', detail: 'd', lens: 'k' },
    ]
    writeFileSync(f.args, JSON.stringify(a0, null, 2))
    withFindings(f.dir,
      [{ id: 'open', title: 'still open', severity: 'major', detail: 'd', lens: 'k' }],
      'result.json',
      [{ id: 'fixed', title: 'fixed this round', severity: 'major', detail: 'd', lens: 'k',
         status: 'closed', evidence: 'the assertion now reads the value' },
       { id: 'open', title: 'still open', severity: 'major', detail: 'd', lens: 'k', status: 'open', evidence: '' }])
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    expect(titles(f.args)).toEqual(['still open'])
    expect(r.out).toMatch(/ruled closed with evidence last round and dropped/)
  })

  test('a NEW blocking finding from a later round is carried, not lost', () => {
    const f = gateFixture()
    withFindings(f.dir, [major('a real defect')])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    expect(titles(f.args)).toEqual(['a real defect'])
    // Round 3's verdict still carries the first and adds one the round-2 lens raised.
    withFindings(f.dir, [major('a real defect'), major('another one')])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    const a = readArgs(f.args)
    expect(a.rounds).toBe(3)
    expect(a.freezeFindingSet).toBe(true)
    expect(titles(f.args).sort()).toEqual(['a real defect', 'another one'])
  })

  test('a carried finding the verdict never mentions at all stays OPEN — only an evidenced close removes one', () => {
    // The lens leg can die, and a verdict can predate the channel. Silence is not an adjudication.
    const f = gateFixture()
    const a0 = readArgs(f.args)
    a0.rounds = 2
    a0.carriedFindings = [{ id: 'u', title: 'unjudged', severity: 'major', detail: 'd', lens: 'k' }]
    writeFileSync(f.args, JSON.stringify(a0, null, 2))
    withFindings(f.dir, [])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    expect(titles(f.args)).toEqual(['unjudged'])
  })

  // Silence preserves the run's carry; external claims remain in their own input channel.
  test('an entry carried in carriedFindings and unmentioned by the verdict is carried again', () => {
    const f = gateFixture()
    const a0 = readArgs(f.args)
    a0.rounds = 2
    a0.freezeFindingSet = true
    a0.carriedFindings = [{ id: 'own', title: 'the run’s own carry', severity: 'major', detail: 'd', lens: 'lens' }]
    a0.priorFindings = [{ id: 'ext', title: 'an external claim', severity: 'major', detail: 'd', lens: 'team' }]
    writeFileSync(f.args, JSON.stringify(a0, null, 2))
    withFindings(f.dir, [])                        // the verdict echoes neither
    expect(redispatch(f.plan, f.args).code).toBe(0)
    expect(titles(f.args)).toEqual(['the run’s own carry'])
    // The external door is left exactly as the user set it — the carry never overwrites it.
    expect(readArgs(f.args).priorFindings.map((x: any) => x.id)).toEqual(['ext'])
  })

  test('the same finding in the carry and the previous findings is ONE entry — dedupe is by id', () => {
    const f = gateFixture()
    const a0 = readArgs(f.args)
    a0.rounds = 2
    a0.carriedFindings = [major('the one defect')]
    writeFileSync(f.args, JSON.stringify(a0, null, 2))
    withFindings(f.dir, [major('the one defect'), major('the one defect')])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    expect(readArgs(f.args).carriedFindings.length).toBe(1)
  })

  test('an idless external claim retains its single prior channel after redispatch', async () => {
    const f = gateFixture()
    const external = major('the external defect')
    const a0 = readArgs(f.args)
    a0.priorFindings = [external]
    writeFileSync(f.args, JSON.stringify(a0, null, 2))
    withFindings(f.dir, [{ ...external, id: 'prior#0', source: 'prior' }])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    const a = readArgs(f.args)
    expect(a.carriedFindings).toEqual([])
    expect(a.priorFindings).toEqual([external])
    const next = await runWorkflow(a, replies())
    expect(next.result.carried.map((x: any) => x.id)).toEqual(['prior#0'])
  })

  test('the same title with a DIFFERENT provenance is a different finding and both are carried', () => {
    const f = gateFixture()
    withFindings(f.dir, [major('shared title'), { ...major('shared title'), lens: 'other' }])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    const a = readArgs(f.args)
    expect(a.carriedFindings.length).toBe(2)
    expect(a.carriedFindings.map((p: any) => p.lens).sort()).toEqual(['k', 'other'])
  })

  // ownerTask is what narrows the NEXT round and what groups taskFixes, so losing it in the carry
  // would put the loop back to re-running everything.
  test('the carry keeps a finding’s file and ownerTask', () => {
    const f = gateFixture()
    withFindings(f.dir, [{ ...major('owned'), ownerTask: 'T1' }])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    const e = readArgs(f.args).carriedFindings[0]
    expect(e.file).toBe('src/a.ts')
    expect(e.ownerTask).toBe('T1')
  })

  test('freezeFindingSet and carriedFindings survive the plan sync — they are run-local', () => {
    const f = gateFixture()
    withFindings(f.dir, [major('a real defect')])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    // The plan block carries neither key, and the sync must not erase them.
    const a = readArgs(f.args)
    expect(a.freezeFindingSet).toBe(true)
    expect(titles(f.args)).toEqual(['a real defect'])
  })

  test('a previous verdict with no blocking findings freezes an EMPTY carried set, not nothing', () => {
    const f = gateFixture()
    withFindings(f.dir, [])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    const a = readArgs(f.args)
    expect(a.carriedFindings).toEqual([])
    expect(a.freezeFindingSet).toBe(true)
  })

  test('a re-hash without --dispatch neither freezes nor carries anything', () => {
    const f = gateFixture()
    withFindings(f.dir, [major('a real defect')])
    expect(run(f.plan, f.args).code).toBe(0)
    const a = readArgs(f.args)
    expect('freezeFindingSet' in a).toBe(false)
    expect('carriedFindings' in a).toBe(false)
  })

  /**
   * FAIL CLOSED on an unreadable previous verdict. Nothing can be re-derived, so the carried set is
   * left exactly as the last round set it. EMPTYING it while `freezeFindingSet` stays on would leave the
   * freeze's only gating channel empty and hold every fresh blocking finding as residue — the round
   * would PASS on a set nobody could read.
   */
  test('an unreadable previous verdict leaves the carried set and the freeze untouched', () => {
    const f = gateFixture()
    const a0 = readArgs(f.args)
    a0.rounds = 2
    a0.freezeFindingSet = true
    a0.carriedFindings = [{ id: 'k1', title: 'open from round 2', severity: 'major', detail: 'd', lens: 'lens' }]
    writeFileSync(f.args, JSON.stringify(a0, null, 2))
    writeFileSync(f.result, '{ this is not json\n')

    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(0)
    const a = readArgs(f.args)
    expect(a.freezeFindingSet).toBe(true)
    expect(titles(f.args)).toEqual(['open from round 2'])
    expect(r.out).toMatch(/UNCHANGED — the previous verdict could not be read/)
  })

  test('round 1 carries nothing, and a carry left over from an earlier run is dropped', () => {
    const f = gateFixture()
    const a0 = readArgs(f.args)
    a0.rounds = 0                      // this dispatch advances to round 1
    a0.carriedFindings = [{ id: 'stale', title: 'from an earlier run', severity: 'major', detail: 'd' }]
    writeFileSync(f.args, JSON.stringify(a0, null, 2))
    withFindings(f.dir, [major('a real defect')])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    const a = readArgs(f.args)
    expect(a.rounds).toBe(1)
    expect('carriedFindings' in a).toBe(false)
    expect('freezeFindingSet' in a).toBe(false)
  })

  test('the dispatch past the default cap is refused, spends nothing, and hands back a paste-ready priorFindings block', () => {
    const f = gateFixture()
    // 6 is the default maxRounds; the seventh dispatch is the one that must be refused.
    const a0 = readArgs(f.args); a0.rounds = 6; writeFileSync(f.args, JSON.stringify(a0, null, 2))
    withFindings(f.dir, [major('still open after six rounds')])
    const argsBefore = readFileSync(f.args, 'utf8')
    const resultBefore = readFileSync(f.result, 'utf8')

    const r = redispatch(f.plan, f.args)
    expect(r.code).not.toBe(0)
    expect(r.out).toMatch(/human review/i)
    expect(r.out).toContain('"priorFindings"')
    expect(r.out).toContain('still open after six rounds')
    // Nothing spent: the run is left exactly as it was.
    expect(readFileSync(f.args, 'utf8')).toBe(argsBefore)
    expect(readArgs(f.args).rounds).toBe(6)
    expect(readFileSync(f.result, 'utf8')).toBe(resultBefore)
    expect(existsSync(join(f.dir, 'result-round1.json'))).toBe(false)
    expect(readdirSync(f.dir).filter(x => /^plan-[0-9a-f]{12}\.md$/.test(x))).toHaveLength(0)
  })

  // The block is what a human takes to a FRESH run, so it has to list everything still open — the
  // RESIDUE included. Residue never gated (the freeze held it out of the verdict), so it is precisely
  // the part a reader has not seen, and dropping it would lose real blocking findings at the cap.
  test('the cap block lists the still-open CARRIED entries and the RESIDUE, deduped by id', () => {
    const f = gateFixture()
    const a0 = readArgs(f.args); a0.rounds = 6; writeFileSync(f.args, JSON.stringify(a0, null, 2))
    writeFileSync(f.result, JSON.stringify({
      overallPass: false, verdict: 'FAIL',
      scoreTable: { survivingBlocking: 1, lensFindings: 1, residue: 1 },
      tasksThatFlagged: [], mechanicalThatFailed: [], lensesThatFlagged: ['lens'],
      findings: [{ id: 'c1', title: 'still open after six rounds', severity: 'major', detail: 'd', lens: 'lens' }],
      carried: [
        { id: 'c1', title: 'still open after six rounds', severity: 'major', detail: 'd', lens: 'lens', status: 'open', evidence: '' },
        { id: 'c2', title: 'settled last round', severity: 'major', detail: 'd', lens: 'lens', status: 'closed', evidence: 'the check now reads it' },
      ],
      residue: [{ id: 'r1', title: 'raised but never gated', severity: 'critical', detail: 'd', lens: 'lens' }],
    }, null, 2) + '\n')

    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(4)
    expect(r.out).toContain('"priorFindings"')
    expect(r.out).toContain('still open after six rounds')
    expect(r.out).toContain('raised but never gated')
    // A CLOSED carried entry is settled and must not come back.
    expect(r.out).not.toContain('settled last round')
    // c1 is in both `findings` and `carried`; the id dedupes it to one entry.
    expect(r.out.match(/still open after six rounds/g)).toHaveLength(1)
  })

  test('the cap block retains an open carried finding the previous result never echoed', () => {
    const f = gateFixture()
    const a0 = readArgs(f.args)
    a0.rounds = 6
    a0.freezeFindingSet = true
    a0.carriedFindings = [{ id: 'silent', title: 'unjudged carry', severity: 'major', detail: 'd' }]
    writeFileSync(f.args, JSON.stringify(a0, null, 2))
    withFindings(f.dir, [])
    const before = readFileSync(f.args, 'utf8')
    const r = redispatch(f.plan, f.args)
    expect(r.code).toBe(4)
    expect(r.out).toContain('"title": "unjudged carry"')
    expect(readFileSync(f.args, 'utf8')).toBe(before)
  })

  test('an explicit maxRounds moves the cap', () => {
    const f = gateFixture()
    const a0 = readArgs(f.args); a0.rounds = 1; a0.maxRounds = 1; writeFileSync(f.args, JSON.stringify(a0, null, 2))
    withFindings(f.dir, [major('open')])
    expect(redispatch(f.plan, f.args).code).not.toBe(0)

    const g = gateFixture()
    const b0 = readArgs(g.args); b0.rounds = 3; b0.maxRounds = 6; writeFileSync(g.args, JSON.stringify(b0, null, 2))
    withFindings(g.dir, [major('open')])
    expect(redispatch(g.plan, g.args).code).toBe(0)
  })

  test('maxRounds is run-local: the plan sync does not drop it', () => {
    const f = gateFixture()
    const a0 = readArgs(f.args); a0.maxRounds = 6; writeFileSync(f.args, JSON.stringify(a0, null, 2))
    withFindings(f.dir, [major('open')])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    expect(readArgs(f.args).maxRounds).toBe(6)
  })
})

/**
 * The self-eval trigger. ADVISORY — the cap above is what stops the run; converge-check.ts explains
 * why it had to be stopped, computed from the archives the run already wrote.
 */
describe('the convergence self-eval trigger', () => {
  function rounds(dir: string, blocking: number[]) {
    blocking.forEach((b, i) =>
      writeFileSync(join(dir, `result-round${i + 1}.json`), JSON.stringify({
        overallPass: false, verdict: 'FAIL',
        scoreTable: { survivingBlocking: b, lensFindings: b + 2 },
        tasksThatFlagged: [], mechanicalThatFailed: [], lensesThatFlagged: ['k'],
        findings: Array.from({ length: b }, (_, k) => ({ title: `r${i}f${k}`, severity: 'major', detail: 'd', lens: 'k' })),
      }, null, 2) + '\n'))
  }

  test('at rounds >= 3 the verdict is printed, and a NOT CONVERGING verdict does not refuse below the cap', () => {
    const f = gateFixture()
    const a0 = readArgs(f.args); a0.rounds = 2; a0.maxRounds = 6; writeFileSync(f.args, JSON.stringify(a0, null, 2))
    rounds(f.dir, [2, 5])            // rises => NOT CONVERGING
    priorResult(f.dir)
    const r = redispatch(f.plan, f.args)
    expect(r.out).toContain('NOT CONVERGING')
    expect(r.code).toBe(0)           // advisory: it explains, it does not gate
    expect(readArgs(f.args).rounds).toBe(3)
  })

  test('below the threshold and inside 2h the self-eval does not run', () => {
    const f = gateFixture()
    priorResult(f.dir)
    const r = redispatch(f.plan, f.args)   // rounds 1 -> 2, archives just written
    expect(r.code).toBe(0)
    expect(r.out).not.toContain('CONVERGING')
  })

  test('a run dir whose oldest archive is over 2h old triggers the self-eval early', () => {
    const f = gateFixture()
    rounds(f.dir, [2, 5])
    priorResult(f.dir)
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000)
    utimesSync(join(f.dir, 'result-round1.json'), old, old)
    const r = redispatch(f.plan, f.args)   // rounds 1 -> 2, below the rounds threshold
    expect(readArgs(f.args).rounds).toBe(2)
    expect(r.out).toContain('CONVERGING')
  })
})

describe('the provider passthrough', () => {
  test('an unknown provider is refused, and refused before a round is spent', () => {
    const f = gateFixture()
    priorResult(f.dir)
    const r = redispatch(f.plan, f.args, '--provider', 'llama')
    expect(r.code).toBe(1)
    expect(r.out).toContain('--provider must be claude|codex|gemini')
    expect(readArgs(f.args).rounds).toBe(1)
  })

  test('--provider codex is accepted and named on the dispatch line', () => {
    const f = gateFixture()
    priorResult(f.dir)
    const r = redispatch(f.plan, f.args, '--provider', 'codex')
    expect(r.code).toBe(0)
    expect(readArgs(f.args).rounds).toBe(2)
  })

  test('the provider is NOT persisted into args.json — a later round inherits nothing', () => {
    const f = gateFixture()
    priorResult(f.dir)
    redispatch(f.plan, f.args, '--provider', 'codex')
    const keys = Object.keys(readArgs(f.args))
    expect(keys).not.toContain('provider')
    expect(keys).not.toContain('dispatchProvider')
  })
})
