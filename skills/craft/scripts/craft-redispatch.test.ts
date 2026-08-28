/**
 * craft-redispatch.sh re-syncs the plan's dispatch block into args.json.
 *
 * The script's own header calls the FAIL loop "fix, amend the plan, re-hash, re-dispatch", but it
 * only ever re-hashed: `tasks[]`, `mechanicalChecks` and the lens arrays stayed at whatever the
 * first craft-dispatch.sh built. An amended `work` string never reached the implementer and — worse
 * — an amended `redCommand` never reached the red gate, which is EXECUTED from args.json. A stale
 * gate that has since gone green reads as `redNotRed`, i.e. "your test proves nothing", for a test
 * the author had already fixed in the plan.
 *
 * The hash is not a defence here: it authenticates the PLAN while the executed instructions live in
 * args.json, and nothing checked that the two still agree.
 *
 * Run: bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/craft-redispatch.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, chmodSync, readdirSync, rmSync, writeFileSync, readFileSync, existsSync, utimesSync } from "node:fs"
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = `${import.meta.dir}/craft-redispatch.sh`
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
  const dir = mkdtempSync(join(tmpdir(), 'craft-redispatch-'))
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
      reviewLenses: [{ key: 'k', agentType: 'Explore', refs: [], prompt: 'judge' }],
    },
  }
  writeFileSync(plan, `# Plan\n\n<!-- craft:dispatch\n${JSON.stringify(block, null, 2)}\n-->\n`)
  writeFileSync(args, JSON.stringify({
    projectDir: dir,
    planPath: plan,
    specHash: '0'.repeat(64),
    goal: 'a goal',
    tasks: [{ id: 't1', name: 'one', work: opts.argsWork, writablePaths: ['a.txt'], refs: [], redCommand: opts.argsRed, acceptance: 'it passes' }],
    mechanicalChecks: [{ name: 'check', cmd: 'true' }],
    reviewLenses: [{ key: 'k', agentType: 'Explore', refs: [], prompt: 'judge' }],
    ...(opts.extra ?? {}),
  }, null, 2) + '\n')
  return { dir, plan, args }
}

/** A previous round's verdict, in the run dir craft-redispatch.sh reads and rotates. */
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

describe('craft-redispatch.sh syncs the plan dispatch block into args.json', () => {
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
    expect(r.stdout).toMatch(/craft:dispatch/)
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
// craft-dispatch.sh lints the built args and exits 3 on a major/critical, failing closed. The FAIL
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
  const dir = mkdtempSync(join(tmpdir(), 'craft-redispatch-gate-'))
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
    reviewLenses: [{ key: 'k', agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' }],
  }
  if (opts.dirty)
    clean.tasks.push({
      id: 'T2', name: 'two', work: 'do the other thing', writablePaths: ['docs/'], refs: [],
      redCommand: null as any, acceptance: '`bash scripts/check.sh` exits 0',
    })
  if (opts.uncountable) { clean.tasks = []; clean.mechanicalChecks = [] }
  writeFileSync(plan, `# Plan\n\n## Run sizing\n\n` +
    `<!-- craft:dispatch\n${JSON.stringify({ runId: 'gate-run', args: clean }, null, 2)}\n-->\n`)
  writeFileSync(args, JSON.stringify({
    ...clean, planPath: plan, specHash: '0'.repeat(64), rounds: 1,
  }, null, 2) + '\n')
  return { dir, plan, args, result: join(dir, 'result.json') }
}

/** --dispatch, stopped short of farming out. Rotation and the args write still happen. */
function redispatch(plan: string, args: string, ...extra: string[]) {
  try {
    const stdout = execFileSync('bash', [SCRIPT, plan, args, '--dispatch', ...extra], {
      encoding: 'utf8', env: { ...process.env, CRAFT_REDISPATCH_DRYRUN: '1' },
    })
    return { code: 0, out: stdout }
  } catch (e: any) {
    return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

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

  test('--no-lint dispatches without linting, as craft-dispatch.sh does', () => {
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
// craft has supported `onlyTasks` + `priorResults` all along, and a live 8-round run set NEITHER,
// eight times running: every round re-ran 6 tasks x2, 6 red probes x2, 5 lenses and 5 mechanical
// checks — ~34 agents — when typically 3 findings across 3 tasks needed fixing. A capability that
// depends on the orchestrator remembering it is not a capability. craft-redispatch.sh already reads
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
function selFixture(opts: { extra?: Record<string, unknown> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'craft-redispatch-sel-'))
  scratch.push(dir)
  const plan = join(dir, 'plan.md')
  const args = join(dir, 'args.json')
  const deps: Record<string, string[]> = { T3: ['T2'], T4: ['T3'] }
  const tasks = [1, 2, 3, 4, 5].map(i => {
    redScript(dir, `red${i}.sh`, 'echo "1 failed"\nexit 1')
    return {
      id: `T${i}`, name: `task ${i}`, work: `do part ${i}`, writablePaths: [`src/t${i}`], refs: [],
      redCommand: `bash scripts/red${i}.sh`, acceptance: `\`bash scripts/red${i}.sh\` exits 0`,
      ...(deps[`T${i}`] ? { dependsOn: deps[`T${i}`] } : {}),
    }
  })
  const clean = {
    projectDir: dir,
    goal: 'make the thing correct',
    tasks,
    mechanicalChecks: [{ name: 'tests', cmd: 'bun test' }],
    reviewLenses: [{ key: 'k', agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' }],
  }
  writeFileSync(plan, '# Plan\n\n## Run sizing\n\nnothing parked\n\n' +
    `<!-- craft:dispatch\n${JSON.stringify({ runId: 'sel-run', args: clean }, null, 2)}\n-->\n`)
  writeFileSync(args, JSON.stringify({
    ...clean, planPath: plan, specHash: '0'.repeat(64), rounds: 1, ...(opts.extra ?? {}),
  }, null, 2) + '\n')
  return { dir, plan, args, result: join(dir, 'result.json') }
}

/** A previous round's verdict carrying per-task records for every task it settled. */
function selResult(dir: string, flagged: string[], opts: { settled?: string[]; noRedFor?: string[] } = {}) {
  const settled = opts.settled ?? ['T1', 'T2', 'T3', 'T4', 'T5'].filter(id => !flagged.includes(id))
  const noRed = new Set(opts.noRedFor ?? [])
  writeFileSync(join(dir, 'result.json'), JSON.stringify({
    overallPass: false, verdict: 'FAIL',
    implemented: settled.map(id => ({ id, done: true })),
    verified: settled.map(id => ({ id, pass: true })),
    red: settled.filter(id => !noRed.has(id)).map(id => ({ id, verdict: 'red-green' })),
    tasksThatFlagged: flagged,
    mechanicalThatFailed: [], lensesThatFlagged: [], findings: [],
  }, null, 2) + '\n')
}

const only = (p: string): string[] | undefined => readArgs(p).onlyTasks
const carriedIds = (p: string, key: string): string[] =>
  ((readArgs(p).priorResults ?? {})[key] ?? []).map((r: any) => r.id).sort()

describe('craft-redispatch.sh derives the selective re-run from the previous verdict', () => {
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
    expect(readArgs(f.args).priorResults).toBeUndefined()
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

describe('the red column is echoed on re-hash too, from craft-dispatch.sh\'s one implementation', () => {
  test('a dispositioned task is counted and its claim printed verbatim', () => {
    const f = fixture({ planWork: 'w', planRed: 'false', argsWork: 'w', argsRed: 'false' })
    const plan = readFileSync(f.plan, 'utf8')
    const block = JSON.parse(plan.match(/<!--\s*craft:dispatch\s*\n([\s\S]*?)\n-->/)![1])
    block.args.tasks.push({
      id: 't4', name: 'four', work: 'already done', writablePaths: ['b.txt'], refs: [],
      redDisposition: 'work complete round 6; covered by extraction-unity lens', acceptance: 'it passes',
    })
    writeFileSync(f.plan, `# Plan\n\n<!-- craft:dispatch\n${JSON.stringify(block, null, 2)}\n-->\n`)
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
 * The FAIL loop's re-hash is over the SPEC — the `craft:dispatch` block's canonical JSON — not the
 * plan's bytes. So amending a rationale paragraph between rounds moves nothing, while amending the
 * task table moves the hash the agents verify.
 */
describe('craft-redispatch.sh re-hashes the SPEC, not the plan bytes', () => {
  test('the synced spec hash lands in args.json as specHash, with no planHash left behind', () => {
    const f = fixture({ planWork: 'AMENDED work', planRed: 'false', argsWork: 'STALE work', argsRed: 'false' })
    expect(run(f.plan, f.args).code).toBe(0)
    const a = readArgs(f.args)
    expect(a.planHash).toBeUndefined()
    expect(a.specHash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.specHash).toBe(execFileSync('bash', [
      `${import.meta.dir}/craft-dispatch.sh`, '--spec-hash', f.plan,
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
 * and carried as priorFindings, so the question each round asks is "is the carried set closed?"
 * rather than "did this round's lenses raise anything?" — the second is a draw from a generator
 * whose rate does not fall as fixes land. The cap is what actually stops the run.
 */
describe('the frozen finding set and the round cap', () => {
  /** A previous verdict carrying findings, so round 2 has a blocking set to freeze. */
  function withFindings(dir: string, findings: unknown[], name = 'result.json') {
    writeFileSync(join(dir, name), JSON.stringify({
      overallPass: false, verdict: 'FAIL',
      scoreTable: { survivingBlocking: findings.length, lensFindings: findings.length },
      tasksThatFlagged: [], mechanicalThatFailed: [], lensesThatFlagged: ['k'],
      findings,
    }, null, 2) + '\n')
  }
  const major = (title: string) => ({ title, severity: 'major', detail: 'why it is wrong', file: 'src/a.ts', lens: 'k' })

  test('advancing to round 2 freezes the finding set and carries it as priorFindings', () => {
    const f = gateFixture()
    withFindings(f.dir, [major('the gate asserts existence only'), { ...major('a minor nit'), severity: 'minor' }])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    const a = readArgs(f.args)
    expect(a.rounds).toBe(2)
    expect(a.freezeFindingSet).toBe(true)
    // Blocking only: a minor never gated, so carrying it would make the frozen set larger than the
    // set that failed the run.
    expect(a.priorFindings.map((p: any) => p.title)).toEqual(['the gate asserts existence only'])
    expect(a.priorFindings[0].detail).toBe('why it is wrong')
    expect(a.priorFindings[0].severity).toBe('major')
  })

  test('an already-frozen set is carried unchanged — the freeze is from round 1, not re-derived', () => {
    const f = gateFixture()
    const a0 = readArgs(f.args)
    a0.rounds = 2
    a0.freezeFindingSet = true
    a0.priorFindings = [{ title: 'carried from round 1', severity: 'major', detail: 'd', lens: 'k' }]
    writeFileSync(f.args, JSON.stringify(a0, null, 2))
    withFindings(f.dir, [major('raised in round 2, residue not gate')])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    const a = readArgs(f.args)
    expect(a.priorFindings.map((p: any) => p.title)).toEqual(['carried from round 1'])
    expect(a.freezeFindingSet).toBe(true)
  })

  test('freezeFindingSet and priorFindings survive the plan sync — they are run-local', () => {
    const f = gateFixture()
    withFindings(f.dir, [major('a real defect')])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    // Second advance: the plan block carries neither key, and the sync must not erase them.
    withFindings(f.dir, [major('another one')])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    const a = readArgs(f.args)
    expect(a.rounds).toBe(3)
    expect(a.freezeFindingSet).toBe(true)
    expect(a.priorFindings.map((p: any) => p.title)).toEqual(['a real defect'])
  })

  test('a previous verdict with no blocking findings freezes an EMPTY carried set, not nothing', () => {
    const f = gateFixture()
    withFindings(f.dir, [])
    expect(redispatch(f.plan, f.args).code).toBe(0)
    const a = readArgs(f.args)
    expect(a.priorFindings).toEqual([])
    expect(a.freezeFindingSet).toBe(true)
  })

  test('a re-hash without --dispatch neither freezes nor carries anything', () => {
    const f = gateFixture()
    withFindings(f.dir, [major('a real defect')])
    expect(run(f.plan, f.args).code).toBe(0)
    const a = readArgs(f.args)
    expect('freezeFindingSet' in a).toBe(false)
    expect('priorFindings' in a).toBe(false)
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
