// <!-- wc-probe: ignore-refs -->
// Fixtures below are executed, not declared: the lens and task literals here are
// test INPUTS to workflow.js, not workflow declarations carrying domain rules.
// P7 governs what workflow-creator EMITS.
// Tests for craft's GATE — the arithmetic in workflow.js that decides PASS/FAIL.
//
// Every assertion here is a rule stated in craft/SKILL.md or workflow-creator's gate-laws.md, not a
// transcription of current behaviour. If one fails, the question is which of the two is wrong.
//
// Run: bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/workflow.test.ts
// (absolute or ./-prefixed — a bare relative path is read as a NAME FILTER and exits 1 having
// matched nothing, which is byte-identical to a real failure.)
import { test, expect } from 'bun:test'
import { run, runCatching, baseArgs, task, replies } from './workflow-harness.mjs'

const one = [task()]

// ---------------------------------------------------------------- arg validation (fail-closed)
// Every one of these must throw BEFORE any agent is dispatched: sizing and authority are settled at
// arg time, and a run that has already spent agents cannot un-spend them.

test('missing planPath throws and dispatches nothing', async () => {
  const r = await runCatching({ ...baseArgs, planPath: undefined, tasks: one }, replies())
  expect(r.threw).toBe(true)
  expect(r.dispatched).toEqual([])
})

test('a specHash that is absent or not 64-hex throws', async () => {
  for (const bad of [undefined, '', 'deadbeef', 'g'.repeat(64), 'A'.repeat(64)]) {
    const r = await runCatching({ ...baseArgs, specHash: bad, tasks: one }, replies())
    expect(r.threw).toBe(true)
    expect(String(r.error)).toMatch(/specHash/)
  }
})

test('tasks[] is required when not readOnly, and optional when readOnly', async () => {
  expect((await runCatching({ ...baseArgs, tasks: [] }, replies())).threw).toBe(true)
  expect((await runCatching({ ...baseArgs, readOnly: true, tasks: [] }, replies())).threw).toBe(false)
})

test('a task missing any of id/name/work/acceptance throws', async () => {
  for (const k of ['id', 'name', 'work', 'acceptance']) {
    const t = task(); delete (t as any)[k]
    expect((await runCatching({ ...baseArgs, tasks: [t] }, replies())).threw).toBe(true)
  }
})

// ---------------------------------------------------------------- redCommand contract

test('every shell operator is rejected before a single agent is dispatched', async () => {
  const bad = ['a; b', 'a && b', 'a | b', 'a `b`', 'a $b', 'a > b', 'a < b', 'a (b)', 'a {b}', 'a\nb', 'a\rb']
  for (const cmd of bad) {
    const r = await runCatching({ ...baseArgs, tasks: [task({ redCommand: cmd })] }, replies())
    expect(r.threw).toBe(true)
    expect(r.dispatched).toEqual([])
  }
})

test('an empty or non-string redCommand throws', async () => {
  for (const cmd of ['', '   ', 7, {}, []]) {
    const r = await runCatching({ ...baseArgs, tasks: [task({ redCommand: cmd as any })] }, replies())
    expect(r.threw).toBe(true)
  }
})

test('flags and quotes are accepted — the ban is on shell programs, not arguments', async () => {
  const r = await runCatching({ ...baseArgs, tasks: [task({ redCommand: 'pytest tests/x.py -k "a or b"' })] }, replies())
  expect(r.threw).toBe(false)
  expect(r.result.verdict).toBe('PASS')
})

test('red-green: fails before, passes after -> PASS, task not flagged', async () => {
  const { result } = await run({ ...baseArgs, tasks: [task({ redCommand: 'pytest x' })] },
    replies({ red: { before: 1, after: 0 } }))
  expect(result.red[0].verdict).toBe('red-green')
  expect(result.tasksThatFlagged).toEqual([])
  expect(result.overallPass).toBe(true)
})

test('red-not-red: already passing before implementation -> FAIL and the task is flagged', async () => {
  const { result } = await run({ ...baseArgs, tasks: [task({ redCommand: 'pytest x' })] },
    replies({ red: { before: 0, after: 0 } }))
  expect(result.red[0].verdict).toBe('red-not-red')
  expect(result.tasksThatFlagged).toEqual(['T1'])
  expect(result.overallPass).toBe(false)
})

test('green-not-green: still failing after implementation -> FAIL', async () => {
  const { result } = await run({ ...baseArgs, tasks: [task({ redCommand: 'pytest x' })] },
    replies({ red: { before: 1, after: 1 } }))
  expect(result.red[0].verdict).toBe('green-not-green')
  expect(result.overallPass).toBe(false)
})

test('a dead probe is red-unproven and FAILS — never a silent pass (gate-laws: fail closed)', async () => {
  for (const red of [{ before: null }, { after: null }, { before: null, after: null }]) {
    const { result } = await run({ ...baseArgs, tasks: [task({ redCommand: 'pytest x' })] }, replies({ red }))
    expect(result.red[0].verdict).toBe('red-unproven')
    expect(result.overallPass).toBe(false)
    expect(result.tasksThatFlagged).toEqual(['T1'])
  }
})

test('the RED probe runs BEFORE the implementer — the order is the guarantee', async () => {
  const { dispatched } = await run({ ...baseArgs, tasks: [task({ redCommand: 'pytest x' })] },
    replies({ red: { before: 1, after: 0 } }))
  expect(dispatched.indexOf('red:before:T1')).toBeLessThan(dispatched.indexOf('implement:T1'))
  expect(dispatched.indexOf('implement:T1')).toBeLessThan(dispatched.indexOf('red:after:T1'))
})

test('no redCommand dispatches no probes and emits no red keys — existing callers unchanged', async () => {
  const { result, dispatched } = await run({ ...baseArgs, tasks: one }, replies())
  expect(dispatched.filter(l => l.startsWith('red:'))).toEqual([])
  expect('redGated' in result.scoreTable).toBe(false)
  expect(result.overallPass).toBe(true)
})

// ---------------------------------------------------------------- dead agents fail closed

test('a dead implementer flags its task', async () => {
  const { result } = await run({ ...baseArgs, tasks: one }, replies({ impl: { T1: null } }))
  expect(result.overallPass).toBe(false)
  expect(result.tasksThatFlagged).toEqual(['T1'])
})

test('a dead verifier flags its task — silence is not a pass', async () => {
  const { result } = await run({ ...baseArgs, tasks: one }, replies({ verify: { T1: null } }))
  expect(result.overallPass).toBe(false)
  expect(result.tasksThatFlagged).toEqual(['T1'])
})

test('a dead lens synthesizes a critical finding, is counted as not-reported, and fails', async () => {
  const lenses = [{ key: 'alpha', prompt: 'p' }, { key: 'beta', prompt: 'p' }]
  const { result } = await run({ ...baseArgs, tasks: one, reviewLenses: lenses },
    replies({ lens: { alpha: null } }))
  expect(result.scoreTable.lensesRun).toBe(2)
  expect(result.scoreTable.lensesReported).toBe(1)
  expect(result.lensesThatFlagged).toContain('alpha')
  expect(result.findings.some(f => f.lens === 'alpha' && f.severity === 'critical')).toBe(true)
  expect(result.overallPass).toBe(false)
})

test('a lens that ran and found nothing is NOT treated like a dead one', async () => {
  const { result } = await run({ ...baseArgs, tasks: one, reviewLenses: [{ key: 'alpha', prompt: 'p' }] },
    replies({ lens: { alpha: { findings: [] } } }))
  expect(result.scoreTable.lensesReported).toBe(1)
  expect(result.lensesThatFlagged).toEqual([])
  expect(result.overallPass).toBe(true)
})

// ---------------------------------------------------------------- mechanical checks

test('a non-zero mechanical check fails the gate and names itself', async () => {
  const { result } = await run({ ...baseArgs, tasks: one, mechanicalChecks: [{ name: 'lint', cmd: 'x' }] },
    replies({ mech: { lint: { name: 'lint', exitCode: 3, output: 'boom' } } }))
  expect(result.overallPass).toBe(false)
  expect(result.mechanicalThatFailed.map(m => m.name)).toEqual(['lint'])
})

test('a dead probe is exitCode -1 and counts as FAILED, not skipped', async () => {
  const { result } = await run({ ...baseArgs, tasks: one, mechanicalChecks: [{ name: 'lint', cmd: 'x' }] },
    replies({ mech: { lint: null } }))
  expect(result.mechanical[0].exitCode).toBe(-1)
  expect(result.overallPass).toBe(false)
})

test('absent mechanicalChecks reports 0/0 — nothing checked, not everything clean', async () => {
  const { result } = await run({ ...baseArgs, tasks: one }, replies())
  expect(result.scoreTable.mechanicalRun).toBe(0)
  expect(result.scoreTable.mechanicalPassed).toBe(0)
  expect(result.mechanicalThatFailed).toEqual([])
})

test('a malformed mechanicalCheck throws at arg time', async () => {
  for (const c of [{ name: 'x' }, { cmd: 'y' }, {}]) {
    const r = await runCatching({ ...baseArgs, tasks: one, mechanicalChecks: [c as any] }, replies())
    expect(r.threw).toBe(true)
  }
})

// ---------------------------------------------------------------- the L3 invariant

test('overallPass===false implies at least one non-empty selector, across every failure mode', async () => {
  const cases = [
    { args: { tasks: one }, reply: replies({ impl: { T1: null } }) },
    { args: { tasks: one }, reply: replies({ verify: { T1: null } }) },
    { args: { tasks: one, mechanicalChecks: [{ name: 'm', cmd: 'c' }] }, reply: replies({ mech: { m: { name: 'm', exitCode: 1, output: '' } } }) },
    { args: { tasks: one, reviewLenses: [{ key: 'alpha', prompt: 'p' }] }, reply: replies({ lens: { alpha: null } }) },
    { args: { tasks: [task({ redCommand: 'pytest x' })] }, reply: replies({ red: { before: 0 } }) },
  ]
  for (const c of cases) {
    const { result } = await run({ ...baseArgs, ...c.args }, c.reply)
    expect(result.overallPass).toBe(false)
    // Spread unguarded: the return carries all three selector keys on EVERY run.
    const selectors = [...result.tasksThatFlagged, ...result.mechanicalThatFailed, ...result.lensesThatFlagged]
    expect(selectors.length).toBeGreaterThan(0)
  }
})

test('a fully clean run PASSES with all three selectors empty', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, mechanicalChecks: [{ name: 'm', cmd: 'c' }], reviewLenses: [{ key: 'alpha', prompt: 'p' }] },
    replies())
  expect(result.overallPass).toBe(true)
  expect(result.tasksThatFlagged).toEqual([])
  expect(result.mechanicalThatFailed).toEqual([])
  expect(result.lensesThatFlagged).toEqual([])
})

// ---------------------------------------------------------------- readOnly

test('readOnly dispatches no implementer and no per-task verifier', async () => {
  const { dispatched } = await run({ ...baseArgs, readOnly: true, tasks: one }, replies())
  expect(dispatched.filter(l => l.startsWith('implement:'))).toEqual([])
  expect(dispatched.filter(l => l.startsWith('verify:'))).toEqual([])
})

test('readOnly renders the task dimensions n/a (null), not zero', async () => {
  const { result } = await run({ ...baseArgs, readOnly: true, tasks: one }, replies())
  expect(result.scoreTable.tasksJudgedThisRun).toBeNull()
  expect(result.scoreTable.implementedDone).toBeNull()
  expect(result.scoreTable.verifyPassed).toBeNull()
})

test('readOnly dispatches no red probe and renders red counts n/a, not 0/N unproven', async () => {
  const { result, dispatched } = await run(
    { ...baseArgs, readOnly: true, tasks: [task({ redCommand: 'pytest x' })] }, replies())
  expect(dispatched.filter(l => l.startsWith('red:'))).toEqual([])
  expect(result.scoreTable.redUnproven).toBeNull()
  expect(result.scoreTable.redProven).toBeNull()
})

// ---------------------------------------------------------------- onlyTasks / priorResults

test('onlyTasks re-dispatches just the named tasks and carries the rest', async () => {
  const two = [task({ id: 'T1' }), task({ id: 'T2' })]
  const { dispatched, result } = await run({
    ...baseArgs, tasks: two, onlyTasks: ['T1'],
    priorResults: { implemented: [{ id: 'T2', done: true }], verified: [{ id: 'T2', pass: true }] },
  }, replies())
  expect(dispatched).toContain('implement:T1')
  expect(dispatched).not.toContain('implement:T2')
  expect(result.overallPass).toBe(true)
})

test('onlyTasks matching no task throws rather than silently judging nothing', async () => {
  const r = await runCatching({ ...baseArgs, tasks: one, onlyTasks: ['NOPE'] }, replies())
  expect(r.threw).toBe(true)
})

test('a carried red-gated task needs priorResults.red — dropping it re-reads as unproven', async () => {
  const two = [task({ id: 'T1', redCommand: 'pytest a' }), task({ id: 'T2', redCommand: 'pytest b' })]
  const withoutRed = await run({
    ...baseArgs, tasks: two, onlyTasks: ['T1'],
    priorResults: { implemented: [{ id: 'T2', done: true }], verified: [{ id: 'T2', pass: true }] },
  }, replies({ red: { before: 1, after: 0 } }))
  const withRed = await run({
    ...baseArgs, tasks: two, onlyTasks: ['T1'],
    priorResults: {
      implemented: [{ id: 'T2', done: true }], verified: [{ id: 'T2', pass: true }],
      red: [{ id: 'T2', verdict: 'red-green' }],
    },
  }, replies({ red: { before: 1, after: 0 } }))
  // This is the documented hazard: the two runs must differ, and only the second may pass.
  expect(withRed.result.overallPass).toBe(true)
  expect(withoutRed.result.overallPass).toBe(false)
  expect(withoutRed.result.tasksThatFlagged).toContain('T2')
})

// ---------------------------------------------------------------- fan-out ceiling

test('maxAgents throws before dispatching, and the message breaks down the count', async () => {
  const r = await runCatching({ ...baseArgs, tasks: one, maxAgents: 1 }, replies())
  expect(r.threw).toBe(true)
  expect(r.dispatched).toEqual([])
  expect(r.error.message).toMatch(/maxAgents|floor|exceed/i)
})

test('a red-gated task costs 2 more against the ceiling than a plain one', async () => {
  const plain = [task({ id: 'T1' })]
  const gated = [task({ id: 'T1', redCommand: 'pytest x' })]
  // Find the smallest ceiling each shape fits under, and assert the gated one needs exactly 2 more.
  const fits = async (tasks: any, n: number) =>
    !(await runCatching({ ...baseArgs, tasks, maxAgents: n }, replies({ red: { before: 1, after: 0 } }))).threw
  let plainMin = 0, gatedMin = 0
  for (let n = 1; n <= 40 && !plainMin; n++) if (await fits(plain, n)) plainMin = n
  for (let n = 1; n <= 40 && !gatedMin; n++) if (await fits(gated, n)) gatedMin = n
  expect(plainMin).toBeGreaterThan(0)
  expect(gatedMin - plainMin).toBe(2)
})

// ---------------------------------------------------------------- authority plumbing

test('every dispatched agent is told the plan path and the spec hash', async () => {
  const { prompts } = await run({ ...baseArgs, tasks: one, reviewLenses: [{ key: 'alpha', prompt: 'p' }] }, replies())
  expect(prompts.size).toBeGreaterThan(0)
  for (const [, p] of prompts) {
    expect(p).toContain(baseArgs.planPath)
    expect(p).toContain(baseArgs.specHash)
  }
})

test('authorityExtra reaches every dispatched agent, and is absent when not supplied', async () => {
  const marker = 'ZZ-DOMAIN-RULE-ZZ'
  const withExtra = await run({ ...baseArgs, tasks: one, authorityExtra: marker }, replies())
  for (const [, p] of withExtra.prompts) expect(p).toContain(marker)
  const without = await run({ ...baseArgs, tasks: one }, replies())
  for (const [, p] of without.prompts) expect(p).not.toContain(marker)
})

// ---------------------------------------------------------------- priorFindings (found outside this run)

test('priorFindings reach findings, the selector and the score table', async () => {
  // priorFindings are about work that ALREADY EXISTS, discovered outside this run, and they were
  // charged against the fan-out cap at arg time. They may be refuted or kept, but they may not vanish.
  const priorTitle = 'a defect found outside this run'
  const { result } = await run(
    {
      ...baseArgs, tasks: one,
      priorFindings: [{ title: priorTitle, severity: 'major', detail: 'd', lens: 'prior-x' }],
    },
    replies({ refute: { refuted: false, reason: 'stands' } }))
  expect(result.findings.some((f: any) => f.title === priorTitle)).toBe(true)
  // It re-runs no task — it is attributed to its own lens key, which is exactly the channel a
  // surviving finding uses everywhere else in this file.
  expect(result.lensesThatFlagged).toContain('prior-x')
  expect(result.scoreTable.priorFindingsSubmitted).toBe(1)
  expect(result.scoreTable.priorFindingsSurviving).toBe(1)
  expect(result.overallPass).toBe(false)
})

// ---------------------------------------------------------------- freezeFindingSet (the fix loop's exit condition)
// Without the flag the exit condition is "this round's lenses raise nothing" — a draw from a
// generator whose rate does not fall as fixes land, so termination is a coin flip. With it, the
// question is the finite one: is the carried blocking set closed? Lens findings still RUN and are
// still reported, as residue; they do not gate.

const lensCritical = { key: 'alpha', prompt: 'p' }
const kept = { refuted: false, reason: 'stands' }
const oneCritical = { alpha: { findings: [{ title: 'fresh', severity: 'critical', detail: 'd' }] } }

test('under freezeFindingSet a surviving lens critical is residue and does NOT fail the gate', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, reviewLenses: [lensCritical], freezeFindingSet: true },
    replies({ lens: oneCritical, refute: kept }))
  expect(result.residue.map((f: any) => f.title)).toEqual(['fresh'])
  expect(result.scoreTable.residue).toBe(1)
  // Still reported — frozen means "does not gate", not "not looked for".
  expect(result.findings.some((f: any) => f.title === 'fresh')).toBe(true)
  expect(result.scoreTable.survivingBlocking).toBe(0)
  expect(result.overallPass).toBe(true)
})

test('under freezeFindingSet a surviving priorFinding still fails the gate and names its lens', async () => {
  const { result } = await run(
    {
      ...baseArgs, tasks: one, reviewLenses: [lensCritical], freezeFindingSet: true,
      priorFindings: [{ title: 'carried', severity: 'major', detail: 'd', lens: 'prior-x' }],
    },
    replies({ lens: oneCritical, refute: kept }))
  expect(result.overallPass).toBe(false)
  expect(result.scoreTable.survivingBlocking).toBe(1)
  // L3: a FAIL always names something to re-run.
  expect(result.lensesThatFlagged.length).toBeGreaterThan(0)
  expect(result.lensesThatFlagged).toContain('prior-x')
  // The fresh lens critical is beside it, as residue, not as a second gate failure.
  expect(result.residue.map((f: any) => f.title)).toEqual(['fresh'])
})

test('a REFUTED priorFinding under freeze leaves the gate clean — the carried set is closed', async () => {
  const { result } = await run(
    {
      ...baseArgs, tasks: one, reviewLenses: [lensCritical], freezeFindingSet: true,
      priorFindings: [{ title: 'carried', severity: 'major', detail: 'd', lens: 'prior-x' }],
    },
    replies({ lens: oneCritical, refute: { refuted: true, reason: 'fixed' } }))
  expect(result.overallPass).toBe(true)
  expect(result.scoreTable.priorFindingsSurviving).toBe(0)
})

test('freezeFindingSet gates nothing else: task and mechanical failures still fail', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, freezeFindingSet: true, mechanicalChecks: [{ name: 'lint', cmd: 'x' }] },
    replies({ verify: { T1: { id: 'T1', pass: false, evidence: '', failures: ['no'] } },
              mech: { lint: { name: 'lint', exitCode: 3, output: 'boom' } } }))
  expect(result.overallPass).toBe(false)
  expect(result.tasksThatFlagged).toEqual(['T1'])
  expect(result.mechanicalThatFailed.map((m: any) => m.name)).toEqual(['lint'])
})

test('absent freezeFindingSet changes nothing: no residue key, and a lens critical still fails', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, reviewLenses: [lensCritical] },
    replies({ lens: oneCritical, refute: kept }))
  expect('residue' in result).toBe(false)
  expect('residue' in result.scoreTable).toBe(false)
  expect(result.scoreTable.survivingBlocking).toBe(1)
  expect(result.overallPass).toBe(false)
})

test('a non-true freezeFindingSet is not a freeze — only the boolean true arms it', async () => {
  for (const v of ['true', 1, {}]) {
    const { result } = await run(
      { ...baseArgs, tasks: one, reviewLenses: [lensCritical], freezeFindingSet: v as any },
      replies({ lens: oneCritical, refute: kept }))
    expect(result.overallPass).toBe(false)
    expect('residue' in result).toBe(false)
  }
})

test('the fail-closed rules still hold under the freeze: a dead refuter keeps its carried finding', async () => {
  // A refuter that never reported tested nothing, so the carried finding STANDS — the freeze narrows
  // which findings gate, never how a finding that gates is judged.
  const { result } = await run(
    {
      ...baseArgs, readOnly: true, tasks: [], freezeFindingSet: true,
      priorFindings: [{ title: 'carried', severity: 'critical', detail: 'd', lens: 'prior-x' }],
    },
    replies({ refute: null }))
  expect(result.overallPass).toBe(false)
  expect(result.lensesThatFlagged).toContain('prior-x')
  // readOnly still reports the task dimensions as n/a, not as clean zeroes.
  expect(result.scoreTable.implementedDone).toBe(null)
  expect(result.tasksThatFlagged).toEqual([])
})

// ---------------------------------------------------------------- dependsOn (IMPLEMENT waves)
// A dependency edge is a READ ordering: B declares dependsOn:['A'] when B's refs or inputs are files
// A writes. Absent dependsOn, IMPLEMENT must behave exactly as it did when it was a single for-loop.

const dep = (id: string, dependsOn?: string[], paths?: string[]) =>
  task({ id, ...(dependsOn ? { dependsOn } : {}), ...(paths ? { writablePaths: paths } : {}) })

test('dependsOn must be an array of id strings, and cannot name itself', async () => {
  for (const bad of ['T2', 42, [1], ['']]) {
    const r = await runCatching({ ...baseArgs, tasks: [task({ dependsOn: bad as any })] }, replies())
    expect(r.threw).toBe(true)
    expect(r.dispatched.length).toBe(0)
  }
  const self = await runCatching({ ...baseArgs, tasks: [task({ id: 'T1', dependsOn: ['T1'] })] }, replies())
  expect(self.threw).toBe(true)
})

test('dependsOn naming an unknown task id throws rather than silently dropping the ordering', async () => {
  const r = await runCatching({ ...baseArgs, tasks: [dep('T1'), dep('T2', ['NOPE'])] }, replies())
  expect(r.threw).toBe(true)
  expect(String(r.error)).toContain('unknown task id')
  expect(r.dispatched.length).toBe(0)
})

test('a dependsOn cycle throws and names every id in it', async () => {
  const r = await runCatching({ ...baseArgs, tasks: [dep('T1', ['T2']), dep('T2', ['T1'])] }, replies())
  expect(r.threw).toBe(true)
  expect(String(r.error)).toContain('cycle')
  expect(String(r.error)).toContain('T1')
  expect(String(r.error)).toContain('T2')
  expect(r.dispatched.length).toBe(0)
})

test('same-wave tasks claiming overlapping writable paths throw — prefix-aware, before any dispatch', async () => {
  // No dependsOn between them => one wave => concurrent => paths must be disjoint.
  const exact = await runCatching(
    { ...baseArgs, tasks: [dep('T1', undefined, ['src/a.ts']), dep('T2', undefined, ['src/a.ts'])] }, replies())
  expect(exact.threw).toBe(true)
  expect(exact.dispatched.length).toBe(0)
  const prefix = await runCatching(
    { ...baseArgs, tasks: [dep('T1', undefined, ['src']), dep('T2', undefined, ['src/lib/x.ts'])] }, replies())
  expect(prefix.threw).toBe(true)
  expect(String(prefix.error)).toContain('disjoint')
  // Serialising them makes the same paths legal: different waves never write concurrently.
  const ordered = await run(
    { ...baseArgs, tasks: [dep('T1', undefined, ['src']), dep('T2', ['T1'], ['src/lib/x.ts'])] }, replies())
  expect(ordered.result.overallPass).toBe(true)
})

test('no dependsOn anywhere leaves every task in one wave and every task implemented', async () => {
  const r = await run({ ...baseArgs, tasks: [dep('T1', undefined, ['a']), dep('T2', undefined, ['b']), dep('T3', undefined, ['c'])] }, replies())
  expect(r.result.implemented.map((i: any) => i.id)).toEqual(['T1', 'T2', 'T3'])
  expect(r.result.scoreTable.implementedDone).toBe(3)
})

test('a declared chain implements every task exactly once, in dependency order', async () => {
  // T3 -> T2 -> T1 declared out of array order, so array order alone cannot produce this.
  const r = await run({ ...baseArgs, tasks: [
    dep('T1', ['T2'], ['a']), dep('T2', ['T3'], ['b']), dep('T3', undefined, ['c']),
  ] }, replies())
  const order = r.dispatched.filter(l => l.startsWith('implement:')).map(l => l.split(':')[1])
  expect(order).toEqual(['T3', 'T2', 'T1'])
  expect(r.result.scoreTable.implementedDone).toBe(3)
})

test('an edge to a task outside onlyTasks is treated as satisfied, not unschedulable', async () => {
  // T2 depends on T1, but only T2 is re-run: T1's output is already on disk from the prior round.
  const r = await run({ ...baseArgs,
    tasks: [dep('T1', undefined, ['a']), dep('T2', ['T1'], ['b'])],
    onlyTasks: ['T2'],
    priorResults: { implemented: [{ id: 'T1', done: true, changedFiles: ['a'], evidence: 'e' }], verified: [{ id: 'T1', pass: true, evidence: 'e', failures: [] }] },
  }, replies())
  const order = r.dispatched.filter(l => l.startsWith('implement:')).map(l => l.split(':')[1])
  expect(order).toEqual(['T2'])
  expect(r.result.overallPass).toBe(true)
})

test('a redCommand still brackets its OWN implementer inside a concurrent wave', async () => {
  const r = await run({ ...baseArgs, tasks: [
    dep('T1', undefined, ['a']), task({ id: 'T2', writablePaths: ['b'], redCommand: 'pytest t.py' }),
  ] }, replies({ red: { before: 1, after: 0 } }))
  const red = r.result.red.find((x: any) => x.id === 'T2')
  expect(red.verdict).toBe('red-green')   // RED_VERDICT_OK, workflow.js:609
  expect(r.result.scoreTable.redProven).toBe(1)
})

// ---------------------------------------------------------------- scoredChecks (ADVISORY, counts in / scores computed here)
// The agent returns RAW COUNTS and craft computes every score, because an agent that reports its own
// score inflates it and one that never sees the formula cannot. Nothing below may reach overallPass.

// The slides-diagnose constants, declared rather than coded: s1 = 10 - missing·1.0 - collapsed·0.5,
// s2 = 10 - redundant·0.5, x1 = 10 - mismatches·1.5, composite = 0.5·s1 + 0.3·s2 + 0.2·x1.
const countProps = {
  itemsChecked: { type: 'integer' }, missing: { type: 'integer' }, collapsed: { type: 'integer' },
  redundant: { type: 'integer' }, mismatches: { type: 'integer' },
}
const scoredCheck = (over: any = {}) => ({
  key: 'slides',
  items: ['L1', 'L2'],
  prompt: 'Count coverage, redundancy and fidelity occurrences.',
  schema: { type: 'object', properties: countProps },
  components: [
    { name: 'coverage', weight: 0.5, base: 10, penalties: { missing: 1.0, collapsed: 0.5 } },
    { name: 'redundancy', weight: 0.3, base: 10, penalties: { redundant: 0.5 } },
    { name: 'fidelity', weight: 0.2, base: 10, penalties: { mismatches: 1.5 } },
  ],
  ...over,
})
const CLEAN_COUNTS = { itemsChecked: 10, missing: 0, collapsed: 0, redundant: 0, mismatches: 0 }
// Routes the scored labels by ITEM (the segments after the key), so no test hard-codes the label
// prefix; everything else falls through to the base fixtures.
const scoredReplies = ({ scored = {} as any, dflt = CLEAN_COUNTS as any, ...rest }: any = {}) => {
  const base = replies(rest)
  return (label: string, prompt: string, opts: any) => {
    if (label.split(':')[0] === 'scored') {
      const item = label.split(':').slice(2).join(':')
      return item in scored ? scored[item] : dflt
    }
    return base(label, prompt, opts)
  }
}
const scoredFor = (result: any, item: string) => result.scores.find((s: any) => s.item === item)

test('absent scoredChecks dispatches no scored agent and reports the score dimensions n/a (null)', async () => {
  for (const extra of [{}, { scoredChecks: [] }]) {
    const { result, dispatched } = await run({ ...baseArgs, tasks: one, ...extra }, replies())
    expect(dispatched.filter(l => /scored/i.test(l))).toEqual([])
    expect(dispatched).toContain('implement:T1')
    // null, not 0: nothing was scored, and a 0 beside a PASS reads as "scored and clean".
    expect(result.scoreTable.scoresRun).toBeNull()
    expect(result.scoreTable.scoresReported).toBeNull()
    expect(result.scores).toEqual([])
    expect(result.overallPass).toBe(true)
  }
})

test('the S3 arithmetic is computed per ITEM from the slides-diagnose constants, and never aggregated', async () => {
  const { result, dispatched } = await run(
    { ...baseArgs, tasks: one, scoredChecks: [scoredCheck()] },
    scoredReplies({ scored: {
      // s1 = 10 - 2·1.0 - 1·0.5 = 7.5, s2 = 10 - 4·0.5 = 8, x1 = 10 - 0 = 10
      // composite = 0.5·7.5 + 0.3·8 + 0.2·10 = 8.15
      L1: { itemsChecked: 20, missing: 2, collapsed: 1, redundant: 4, mismatches: 0 },
      // s1 clamps at 0 (10 - 20 < 0), s2 = 10, x1 = 10 => composite = 0 + 3 + 2 = 5
      L2: { itemsChecked: 5, missing: 20, collapsed: 0, redundant: 0, mismatches: 0 },
    } }))
  expect(dispatched).toContain('scored:slides:L1')
  expect(dispatched).toContain('scored:slides:L2')
  // One entry per (key, item) in dispatch order — two items, so the per-item rule is exercised
  // rather than inferred from a single row that a whole-check computation would also satisfy.
  expect(result.scores.map((s: any) => [s.key, s.item])).toEqual([['slides', 'L1'], ['slides', 'L2']])
  const a = scoredFor(result, 'L1')
  expect(a.components.coverage).toBeCloseTo(7.5, 10)
  expect(a.components.redundancy).toBeCloseTo(8, 10)
  expect(a.components.fidelity).toBeCloseTo(10, 10)
  expect(a.composite).toBeCloseTo(8.15, 10)
  const b = scoredFor(result, 'L2')
  // A MEASURED zero: clamped at 0 because the penalties exceeded the base, which is why an
  // UNMEASURED item may not also be 0 — see the itemsChecked: 0 test below.
  expect(b.components.coverage).toBe(0)
  expect(b.composite).toBeCloseTo(5, 10)
  expect(b.reason).toBeUndefined()
  // No cross-item mean, total or rank: an average taken over items is the caller's business.
  expect(result.scores.length).toBe(2)
  expect(result.scoreTable.scoresRun).toBe(2)
  expect(result.scoreTable.scoresReported).toBe(2)
})

test('a score-named or non-whitelisted schema field throws at arg time and dispatches nothing', async () => {
  const bad = [
    // The blacklist-killer: integer-typed and score-named. A refusal keyed on type:'number' waves
    // this through, and the agent then reports the very number craft exists to compute.
    scoredCheck({ schema: { type: 'object', properties: { ...countProps, compositeScore: { type: 'integer' } } } }),
    scoredCheck({ schema: { type: 'object', properties: { ...countProps, qualityScore: { type: 'number' } } } }),
    // Score-shaped AND whitelisted: it is a declared penalty key, so only the NAME rule can refuse it.
    scoredCheck({
      schema: { type: 'object', properties: { ...countProps, gradeCount: { type: 'integer' } } },
      components: [{ name: 'coverage', weight: 1, base: 10, penalties: { gradeCount: 1 } }],
    }),
    // Not score-named, but not a count either: the whitelist refuses whatever the type.
    scoredCheck({ schema: { type: 'object', properties: { ...countProps, notes: { type: 'string' } } } }),
    scoredCheck({ schema: { type: 'object', properties: { ...countProps, detail: { type: 'object', properties: { x: { type: 'number' } } } } } }),
  ]
  for (const s of bad) {
    const r = await runCatching({ ...baseArgs, tasks: one, scoredChecks: [s as any] }, scoredReplies())
    expect(r.threw).toBe(true)
    // Fail-closed at ARG time: a schema that would let an agent report a score can never cost a
    // dispatch, and a run that has already spent agents cannot un-spend them.
    expect(r.dispatched).toEqual([])
  }
})

test('a penalties key the schema does not declare throws — a penalty that never fires is invisible', async () => {
  const s = scoredCheck({
    components: [
      { name: 'coverage', weight: 0.5, base: 10, penalties: { missing: 1.0, collapsed: 0.5 } },
      { name: 'ghost', weight: 0.5, base: 10, penalties: { neverDeclared: 2 } },
    ],
  })
  const r = await runCatching({ ...baseArgs, tasks: one, scoredChecks: [s as any] }, scoredReplies())
  expect(r.threw).toBe(true)
  expect(String(r.error)).toContain('neverDeclared')
  expect(r.dispatched).toEqual([])
})

test('itemsChecked: 0 scores null with a reason — never the base, never 0', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, scoredChecks: [scoredCheck()] },
    scoredReplies({ scored: { L1: { itemsChecked: 0, missing: 0, collapsed: 0, redundant: 0, mismatches: 0 } } }))
  const a = scoredFor(result, 'L1')
  // Subtracting no penalties from the base is the vacuous perfect 10; a 0 reads as
  // measured-and-terrible. Both are wrong for something that measured nothing.
  expect(a.composite).toBeNull()
  for (const name of ['coverage', 'redundancy', 'fidelity']) expect(a.components[name]).toBeNull()
  expect(typeof a.reason).toBe('string')
  expect(a.reason).toContain('itemsChecked')
  // The other item still scored: one unmeasured item does not blank the check.
  expect(scoredFor(result, 'L2').composite).toBeCloseTo(10, 10)
  expect(result.overallPass).toBe(true)
})

test('a count the agent never returned yields null with its reason — never NaN, never a silent 0', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, scoredChecks: [scoredCheck()] },
    scoredReplies({ scored: {
      L1: { itemsChecked: 12, missing: 3, redundant: 0, mismatches: 0 },              // `collapsed` absent
      L2: { itemsChecked: 12, missing: 1, collapsed: 0, redundant: null, mismatches: 0 },
    } }))
  for (const item of ['L1', 'L2']) {
    const s = scoredFor(result, item)
    expect(s.composite).toBeNull()
    for (const v of Object.values(s.components)) {
      expect(v).toBeNull()
      expect(Number.isNaN(v as any)).toBe(false)   // Math.max(0, NaN) is NaN and would print as a score
    }
    expect(typeof s.reason).toBe('string')
  }
  expect(scoredFor(result, 'L1').reason).toContain('collapsed')
  expect(scoredFor(result, 'L2').reason).toContain('redundant')
  expect(result.overallPass).toBe(true)
})

test('a dead scored agent yields null with its reason, is visible as unreported, and does NOT fail the run', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, scoredChecks: [scoredCheck()] },
    scoredReplies({ scored: { L1: null } }))
  const a = scoredFor(result, 'L1')
  expect(a.composite).toBeNull()
  for (const name of ['coverage', 'redundancy', 'fidelity']) expect(a.components[name]).toBeNull()
  expect(a.reason).toMatch(/died|skipped/i)
  // Silence is legible without being fatal: those are separable, and conflating them would make an
  // advisory channel a gate by the back door.
  expect(result.scoreTable.scoresRun).toBe(2)
  expect(result.scoreTable.scoresReported).toBe(1)
  expect(result.overallPass).toBe(true)
  expect(result.verdict).toBe('PASS')
  // ...and it adds nothing to any selector, so craft's law that a FAIL names a re-run target holds.
  expect(result.tasksThatFlagged).toEqual([])
  expect(result.mechanicalThatFailed).toEqual([])
  expect(result.lensesThatFlagged).toEqual([])
})

test('overallPass is unchanged by any score value — the whole gate arithmetic is identical', async () => {
  const perfect = { itemsChecked: 40, missing: 0, collapsed: 0, redundant: 0, mismatches: 0 }
  const awful = { itemsChecked: 40, missing: 99, collapsed: 99, redundant: 99, mismatches: 99 }
  const go = (counts: any) => run(
    { ...baseArgs, tasks: one, mechanicalChecks: [{ name: 'm', cmd: 'c' }], reviewLenses: [{ key: 'alpha', prompt: 'p' }],
      scoredChecks: [scoredCheck()] },
    scoredReplies({ scored: { L1: counts, L2: counts } }))
  const good = await go(perfect)
  const bad = await go(awful)
  expect(good.result.scores[0].composite).toBeCloseTo(10, 10)
  expect(bad.result.scores[0].composite).toBe(0)   // every component clamped: as low as a score goes
  for (const r of [good, bad]) {
    expect(r.result.overallPass).toBe(true)
    expect(r.result.verdict).toBe('PASS')
  }
  // Structural, not incidental: every gate dimension and every selector is byte-identical across a
  // 10.0 and a 0.0, so overallPass is computable without reading any scored value.
  expect(bad.result.scoreTable).toEqual(good.result.scoreTable)
  expect(bad.result.tasksThatFlagged).toEqual(good.result.tasksThatFlagged)
  expect(bad.result.mechanicalThatFailed).toEqual(good.result.mechanicalThatFailed)
  expect(bad.result.lensesThatFlagged).toEqual(good.result.lensesThatFlagged)
  expect(bad.result.findings).toEqual(good.result.findings)
})

// ------------------------------------------------- scoredChecks: passthrough (evidence, not input)
// Found at first use: teaching's slide-auditor returns penalty counts, numeric DENOMINATORS a finding
// is stated against (covered/totalDQ/spotChecks) and the item lists findings are built from. The
// count-only whitelist could express none but the first, so the port would have had to run the
// auditor twice. `passthrough` declares evidence explicitly — still a whitelist.

const auditProps = {
  itemsChecked: { type: 'integer' }, missing: { type: 'integer' }, collapsed: { type: 'integer' },
  redundant: { type: 'integer' }, mismatches: { type: 'integer' },
  covered: { type: 'integer' }, totalDQ: { type: 'integer' }, spotChecks: { type: 'integer' },
  missingItems: { type: 'array', items: { type: 'string' } },
}
const auditComponents = [
  { name: 's1', weight: 0.5, base: 10, penalties: { missing: 1.0, collapsed: 0.5 } },
  { name: 's2', weight: 0.3, base: 10, penalties: { redundant: 0.5 } },
  { name: 'x1', weight: 0.2, base: 10, penalties: { mismatches: 1.5 } },
]
const audit = (over: any = {}) => ({
  ...baseArgs, tasks: [task()],
  scoredChecks: [{ key: 'slides-audit', items: ['01'], prompt: 'p', refs: [],
    schema: { type: 'object', properties: auditProps }, components: auditComponents, ...over }],
})

test('a real auditor shape — penalty counts, numeric denominators and item lists — is accepted when passthrough declares the evidence', async () => {
  const r = await runCatching(audit({ passthrough: ['covered', 'totalDQ', 'spotChecks', 'missingItems'] }), replies())
  expect(r.threw).toBe(false)
  expect(r.dispatched.filter(l => l.startsWith('scored:')).length).toBe(1)
})

test('an evidence field not declared in passthrough is still refused', async () => {
  const r = await runCatching(audit(), replies())          // covered/totalDQ/... undeclared
  expect(r.threw).toBe(true)
  expect(String(r.error)).toContain('passthrough')
  expect(r.dispatched.length).toBe(0)
})

test('a field cannot be both a penalties key and passthrough', async () => {
  const r = await runCatching(audit({ passthrough: ['missing'] }), replies())
  expect(r.threw).toBe(true)
  expect(String(r.error)).toContain('never both')
})

test('passthrough naming a field the schema does not declare throws', async () => {
  const r = await runCatching(audit({ passthrough: ['covered', 'totalDQ', 'spotChecks', 'missingItems', 'nope'] }), replies())
  expect(r.threw).toBe(true)
  expect(String(r.error)).toContain('does not declare')
})

test('a score-shaped passthrough field is refused — the guarantee holds through the new door', async () => {
  const props = { ...auditProps, qualityComposite: { type: 'number' } }
  const r = await runCatching({ ...baseArgs, tasks: [task()], scoredChecks: [{
    key: 'k', items: ['01'], prompt: 'p', refs: [], schema: { type: 'object', properties: props },
    components: auditComponents, passthrough: ['covered', 'totalDQ', 'spotChecks', 'missingItems', 'qualityComposite'] }] }, replies())
  expect(r.threw).toBe(true)
  expect(String(r.error)).toContain('score-shaped')
})

// Declaring the evidence and then dropping it made the parameter unusable for the thing it was
// added for: the port could express the auditor's schema and still never saw a denominator. These
// four fix the RETURN, which is the half a validation-only change left open.

const AUDIT_COUNTS = {
  itemsChecked: 41, missing: 1, collapsed: 0, redundant: 4, mismatches: 0,
  covered: 40, totalDQ: 9, spotChecks: 3, missingItems: ['CASE-17'],
}
const PASSTHROUGH = ['covered', 'totalDQ', 'spotChecks', 'missingItems']

test('declared passthrough comes BACK, under evidence, beside the computed scores', async () => {
  const { result } = await run(audit({ passthrough: PASSTHROUGH }),
    scoredReplies({ dflt: AUDIT_COUNTS }))
  const s = result.scores[0]
  // The scores are still computed in JS from the counts, and the evidence rides alongside.
  expect(s.components.s1).toBeCloseTo(9, 10)
  expect(s.evidence).toEqual({ covered: 40, totalDQ: 9, spotChecks: 3, missingItems: ['CASE-17'] })
  // Evidence is NOT a score input: nothing it carries appears in components or composite.
  expect(s.composite).toBeCloseTo(0.5 * 9 + 0.3 * 8 + 0.2 * 10, 10)
})

test('a check with no passthrough returns no evidence key at all', async () => {
  const { result } = await run({ ...baseArgs, tasks: one, scoredChecks: [scoredCheck()] },
    scoredReplies({ dflt: CLEAN_COUNTS }))
  // Byte-identical to the pre-evidence entry for every caller that declared none.
  expect('evidence' in result.scores[0]).toBe(false)
})

test('evidence survives an item that scored null — what it looked at is how you read the null', async () => {
  const { result } = await run(audit({ passthrough: PASSTHROUGH }),
    scoredReplies({ dflt: { ...AUDIT_COUNTS, itemsChecked: 0 } }))
  const s = result.scores[0]
  expect(s.composite).toBeNull()
  expect(s.reason).toContain('nothing was measured')
  expect(s.evidence.covered).toBe(40)
})

test('a dead agent reports no evidence — there is none, and a stale one would invent it', async () => {
  const { result } = await run(audit({ passthrough: PASSTHROUGH }), scoredReplies({ dflt: null }))
  const s = result.scores[0]
  expect(s.composite).toBeNull()
  expect(s.reason).toBe('agent died or was skipped')
  expect('evidence' in s).toBe(false)
})

test('a non-array passthrough throws for THAT reason, not incidentally', async () => {
  // Asserting only `threw` passed against the pre-passthrough spine too, which refused the same
  // schema for an unrelated reason — a test that cannot discriminate is not evidence.
  const r = await runCatching(audit({ passthrough: 'covered' as any }), replies())
  expect(r.threw).toBe(true)
  expect(String(r.error)).toContain('passthrough must be an array')
})

// ---------------------------------------------------------------- the spec, not the prose, is authority
//
// The hash craft pins is over the `craft:dispatch` block's canonical JSON, so the paragraphs around
// it are explanatory. An agent that reads a paragraph as a requirement is inventing authority, and
// an agent that cannot re-derive the hash cannot detect an amendment — so AUTHORITY has to name the
// field, the verification command, and the prose's status.

test('AUTHORITY names the craft:dispatch spec block as the ONLY authority, with its specHash', async () => {
  const { prompts } = await run({ ...baseArgs, tasks: one }, replies())
  for (const [, p] of prompts) {
    expect(p).toContain('craft:dispatch')
    expect(p).toContain(baseArgs.specHash)
    expect(p).toMatch(/only authority/i)
  }
})

test('AUTHORITY gives the --spec-hash command to verify with, and says to stop on mismatch', async () => {
  const { prompts } = await run({ ...baseArgs, tasks: one }, replies())
  for (const [, p] of prompts) {
    expect(p).toContain('craft-dispatch.sh --spec-hash')
    expect(p).toContain(baseArgs.planPath)
    expect(p).toMatch(/stop/i)
  }
})

test('AUTHORITY states the surrounding prose is explanatory and not authoritative', async () => {
  const { prompts } = await run({ ...baseArgs, tasks: one }, replies())
  for (const [, p] of prompts) expect(p).toMatch(/prose[^\n]*not authoritative|not authoritative[^\n]*prose/i)
})

test('nothing dispatched still mentions planHash — the field is gone, not aliased', async () => {
  const { prompts } = await run({ ...baseArgs, tasks: one, reviewLenses: [{ key: 'alpha', prompt: 'p' }] }, replies())
  expect(prompts.size).toBeGreaterThan(0)
  for (const [, p] of prompts) expect(p).not.toContain('planHash')
})
