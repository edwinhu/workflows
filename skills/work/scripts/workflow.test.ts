// <!-- wc-probe: ignore-refs -->
// Fixtures below are executed, not declared: the lens and task literals here are
// test INPUTS to workflow.js, not workflow declarations carrying domain rules.
// P7 governs what workflow-creator EMITS.
// Tests for work's GATE — the arithmetic in workflow.js that decides PASS/FAIL.
//
// Every assertion here is a rule stated in work/SKILL.md or workflow-creator's gate-laws.md, not a
// transcription of current behaviour. If one fails, the question is which of the two is wrong.
//
// Run: bun test ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/workflow.test.ts
// (absolute or ./-prefixed — a bare relative path is read as a NAME FILTER and exits 1 having
// matched nothing, which is byte-identical to a real failure.)
import { test, expect, setDefaultTimeout } from 'bun:test'
import { run, runCatching, baseArgs, task, replies } from './workflow-harness.mjs'

// Tests in this file drive work-dispatch.sh as a real bash subprocess. Bun's 5s per-test default
// is a budget for that subprocess plus whatever else the machine is doing, so under parallel load
// these go red at exactly [5000.xx ms] — contention reported as a defect in the code under test.
// 60s does not hide a hang (a hang never returns and is caught by any finite ceiling); it stops
// standing in for a latency budget this suite never had. Set per file because bun 1.4.0 ignores
// `[test] timeout` in bunfig.toml and applies a preload's setDefaultTimeout to the first file only.
setDefaultTimeout(60_000)

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
  // `before` is the dispatcher's probe, `after` is work-checks.sh's: both bracket the implementer.
  const { order, scripted, workflowDispatched } = await run({ ...baseArgs, tasks: [task({ redCommand: 'pytest x' })] },
    replies({ red: { before: 1, after: 0 } }))
  expect(order.indexOf('red:before:T1')).toBeGreaterThan(-1)
  expect(order.indexOf('red:before:T1')).toBeLessThan(order.indexOf('implement:T1'))
  expect(order.indexOf('implement:T1')).toBeLessThan(order.indexOf('red:after:T1'))
  expect(scripted).toEqual(['red:before:T1', 'red:after:T1'])
  expect(workflowDispatched.filter(l => l.startsWith('red:'))).toEqual([])
})

test('no redCommand dispatches no probes and emits no red keys — existing callers unchanged', async () => {
  const { result, dispatched } = await run({ ...baseArgs, tasks: one }, replies())
  expect(dispatched.filter(l => l.startsWith('red:'))).toEqual([])
  expect('redGated' in result.scoreTable).toBe(false)
  expect(result.overallPass).toBe(true)
})

// ---------------------------------------------------------------- the leg's task, not the agent's claim

test('verifier that mis-reports its id is still attributed to its task', async () => {
  const { result } = await run({ ...baseArgs, tasks: one },
    replies({ verify: { T1: { id: 'T1-verify', pass: true, evidence: 'e', failures: [] } } }))
  expect(result.verified[0].id).toBe('T1')
  expect(result.tasksThatFlagged).toEqual([])
  expect(result.overallPass).toBe(true)
})

test('implementer that mis-reports its id is still attributed to its task', async () => {
  const { result } = await run({ ...baseArgs, tasks: one },
    replies({ impl: { T1: { id: 'wrong', done: true, changedFiles: ['x'], evidence: 'e' } } }))
  expect(result.implemented[0].id).toBe('T1')
  expect(result.tasksThatFlagged).toEqual([])
  expect(result.overallPass).toBe(true)
})

test('stamping the id does not turn a verifier failure into a pass', async () => {
  const { result } = await run({ ...baseArgs, tasks: one },
    replies({ verify: { T1: { id: 'T1-verify', pass: false, evidence: 'e', failures: ['nope'] } } }))
  expect(result.verified[0].id).toBe('T1')
  expect(result.tasksThatFlagged).toEqual(['T1'])
  expect(result.overallPass).toBe(false)
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

test('a dead lens fails closed: synthesized critical, lensesReported 0, and FAIL', async () => {
  const { result } = await run({ ...baseArgs, tasks: one }, replies({ lens: null }))
  expect(result.scoreTable.lensesRun).toBe(1)
  expect(result.scoreTable.lensesReported).toBe(0)
  expect(result.lensesThatFlagged).toEqual(['lens'])
  expect(result.findings.some(f => f.severity === 'critical' && f.syntheticDeadLens)).toBe(true)
  expect(result.overallPass).toBe(false)
})

test('a lens that ran and found nothing is NOT treated like a dead one', async () => {
  const { result } = await run({ ...baseArgs, tasks: one },
    replies({ lens: { routes: [], findings: [], carried: [] } }))
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
    { args: { tasks: one }, reply: replies({ lens: null }) },
    { args: { tasks: [task({ redCommand: 'pytest x' })] }, reply: replies({ red: { before: 0 } }) },
    // A blocking GREEN finding whose owner is the PLAN: no task owns it, so planFindings is the
    // channel that names it — and lensesThatFlagged must still be non-empty.
    {
      args: { tasks: one },
      reply: replies({ lens: { findings: [{ title: 'the plan forbids the only path that can fix this', severity: 'critical', detail: 'd', ownerTask: 'plan' }] } }),
    },
  ]
  for (const c of cases) {
    const { result } = await run({ ...baseArgs, ...c.args }, c.reply)
    expect(result.overallPass).toBe(false)
    // Spread unguarded: the return carries all four selector keys on EVERY run.
    const selectors = [...result.tasksThatFlagged, ...result.mechanicalThatFailed, ...result.lensesThatFlagged, ...result.planFindings]
    expect(selectors.length).toBeGreaterThan(0)
  }
})

test('a fully clean run PASSES with every selector empty', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, mechanicalChecks: [{ name: 'm', cmd: 'c' }] },
    replies())
  expect(result.overallPass).toBe(true)
  expect(result.tasksThatFlagged).toEqual([])
  expect(result.mechanicalThatFailed).toEqual([])
  expect(result.lensesThatFlagged).toEqual([])
  expect(result.planFindings).toEqual([])
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
      red: [{ id: 'T2', command: 'pytest b', verdict: 'red-green' }],
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

test('a red-gated task costs NO agent against the ceiling — its two probes are scripted commands', async () => {
  const plain = [task({ id: 'T1' })]
  const gated = [task({ id: 'T1', redCommand: 'pytest x' })]
  // Find the smallest ceiling each shape fits under: the probes moved to the shell, so they are equal,
  // and the gated shape still runs both probes — as commands, not agents.
  const fits = async (tasks: any, n: number) =>
    !(await runCatching({ ...baseArgs, tasks, maxAgents: n }, replies({ red: { before: 1, after: 0 } }))).threw
  let plainMin = 0, gatedMin = 0
  for (let n = 1; n <= 40 && !plainMin; n++) if (await fits(plain, n)) plainMin = n
  for (let n = 1; n <= 40 && !gatedMin; n++) if (await fits(gated, n)) gatedMin = n
  expect(plainMin).toBeGreaterThan(0)
  expect(gatedMin).toBe(plainMin)
  const r = await run({ ...baseArgs, tasks: gated, maxAgents: gatedMin }, replies({ red: { before: 1, after: 0 } }))
  expect(r.scripted).toEqual(['red:before:T1', 'red:after:T1'])
  expect(r.fanOut).not.toHaveProperty('redProbes')
})

// ---------------------------------------------------------------- authority plumbing

test('every dispatched agent is told the plan path and the spec hash', async () => {
  const { prompts } = await run({ ...baseArgs, tasks: one }, replies())
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

// ---------------------------------------------------------------- the carried finding set
// Two doors into ONE pool. `carriedFindings` is what the previous round left open and the
// redispatcher hands back; `priorFindings` is the same shape arriving from outside the run. The lens
// rules on both identically, by id, with evidence — and silence leaves a finding OPEN.

const carriedMajor = (over: any = {}) => ({ id: 'C1', title: 'a defect from last round', severity: 'major', detail: 'd', ...over })
const rules = (id: string, status: string, evidence = 'ran it; it passes') => ({
  routes: [], findings: [], dispositions: [], carried: [{ id, status, evidence }],
})

test('a carried finding the lens rules OPEN fails the gate and names the lens selector', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, carriedFindings: [carriedMajor()] },
    replies({ lens: rules('C1', 'open', 'the command still fails') }))
  expect(result.overallPass).toBe(false)
  expect(result.findings.some((f: any) => f.id === 'C1')).toBe(true)
  expect(result.lensesThatFlagged).toEqual(['lens'])
  expect(result.scoreTable.carriedSubmitted).toBe(1)
  expect(result.scoreTable.carriedOpen).toBe(1)
})

test('a carried finding the lens rules CLOSED with evidence leaves the gate clean', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, carriedFindings: [carriedMajor()] },
    replies({ lens: rules('C1', 'closed', 'bun test exits 0 — pasted output') }))
  expect(result.overallPass).toBe(true)
  expect(result.scoreTable.carriedOpen).toBe(0)
  // Closed is REPORTED, not deleted: the next round's carry is a decision, not a guess.
  expect(result.carried.map((f: any) => [f.id, f.status])).toEqual([['C1', 'closed']])
  expect(result.findings).toEqual([])
})

test('a carried finding the lens never rules on stays OPEN — silence is not a closure', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, carriedFindings: [carriedMajor()] },
    replies({ lens: { routes: [], findings: [], carried: [] } }))
  expect(result.overallPass).toBe(false)
  expect(result.carried[0].status).toBe('open')
  expect(result.carried[0].evidence).toMatch(/no ruling/i)
})

test('CLOSED with no evidence is not a ruling — the finding stays open', async () => {
  for (const evidence of ['', '   ', undefined as any]) {
    const { result } = await run(
      { ...baseArgs, tasks: one, carriedFindings: [carriedMajor()] },
      replies({ lens: { routes: [], findings: [], carried: [{ id: 'C1', status: 'closed', evidence }] } }))
    expect(result.overallPass).toBe(false)
    expect(result.carried[0].status).toBe('open')
    expect(result.carried[0].evidence).toMatch(/no evidence/i)
  }
})

test('a dead lens leaves every carried finding open — nothing ruled on them', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, carriedFindings: [carriedMajor()] },
    replies({ lens: null }))
  expect(result.overallPass).toBe(false)
  expect(result.carried[0].status).toBe('open')
  expect(result.carried[0].evidence).toMatch(/never reported/i)
})

test('the FIRST ruling per id wins — a lens cannot close a finding by repeating itself', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, carriedFindings: [carriedMajor()] },
    replies({ lens: { routes: [], findings: [], carried: [
      { id: 'C1', status: 'open', evidence: 'still broken' },
      { id: 'C1', status: 'closed', evidence: 'on reflection, fine' },
    ] } }))
  expect(result.carried[0].status).toBe('open')
  expect(result.overallPass).toBe(false)
})

test('priorFindings merge into the SAME carried pool and are ruled the same way', async () => {
  const { result } = await run(
    {
      ...baseArgs, tasks: one,
      carriedFindings: [carriedMajor()],
      priorFindings: [{ title: 'found outside this run', severity: 'major', detail: 'd' }],
    },
    replies({ lens: rules('C1', 'closed', 'fixed and re-run') }))
  expect(result.scoreTable.carriedSubmitted).toBe(2)
  // The prior finding got no ruling, so it is the one still open.
  expect(result.scoreTable.carriedOpen).toBe(1)
  expect(result.carried.map((f: any) => f.source)).toEqual(['carried', 'prior'])
  expect(result.overallPass).toBe(false)
})

test('a prior finding with no id is minted one, so the lens has something to rule by', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, priorFindings: [{ title: 't', severity: 'major', detail: 'd' }] },
    replies())
  expect(result.carried[0].id).toBe('prior#0')
  // And closing that minted id works exactly like closing a supplied one.
  const closed = await run(
    { ...baseArgs, tasks: one, priorFindings: [{ title: 't', severity: 'major', detail: 'd' }] },
    replies({ lens: rules('prior#0', 'closed') }))
  expect(closed.result.overallPass).toBe(true)
})

test('a MINOR carried finding left open does not fail the gate', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, carriedFindings: [carriedMajor({ severity: 'minor' })] },
    replies({ lens: rules('C1', 'open', 'still there') }))
  expect(result.overallPass).toBe(true)
  expect(result.scoreTable.carriedOpen).toBe(1)
  expect(result.lensesThatFlagged).toEqual([])
})

test('a malformed carried claim throws at arg time and dispatches nothing', async () => {
  const bad = [
    { carriedFindings: 'nope' },
    { carriedFindings: [{ title: 't', severity: 'major' }] },              // no detail
    { carriedFindings: [{ title: 't', severity: 'blocker', detail: 'd' }] }, // bad severity
    { carriedFindings: [{ id: 7, title: 't', severity: 'major', detail: 'd' }] },
    { priorFindings: [{ severity: 'major', detail: 'd' }] },               // no title
  ]
  for (const extra of bad) {
    const r = await runCatching({ ...baseArgs, tasks: one, ...(extra as any) }, replies())
    expect(r.threw).toBe(true)
    expect(r.dispatched).toEqual([])
  }
})

test('two carried findings sharing an id throw — one ruling cannot settle two findings', async () => {
  const r = await runCatching(
    { ...baseArgs, tasks: one, carriedFindings: [carriedMajor(), carriedMajor({ title: 'another' })] },
    replies())
  expect(r.threw).toBe(true)
  expect(String(r.error)).toContain('more than once')
  expect(r.dispatched).toEqual([])
})

test('no carried findings at all reports 0/0 and changes nothing', async () => {
  const { result } = await run({ ...baseArgs, tasks: one }, replies())
  expect(result.scoreTable.carriedSubmitted).toBe(0)
  expect(result.scoreTable.carriedOpen).toBe(0)
  expect(result.carried).toEqual([])
  expect(result.overallPass).toBe(true)
})

// ---------------------------------------------------------------- freezeFindingSet (the fix loop's exit condition)
// Without the flag the exit condition is "this round's lens raises nothing" — a draw from a generator
// whose rate does not fall as fixes land, so termination is a coin flip. With it, the question is the
// finite one: is the carried blocking set closed? Fresh lens findings still RUN and are still
// reported, as residue; they do not gate.

const freshCritical = {
  routes: [], findings: [{ title: 'fresh', severity: 'critical', detail: 'd', ownerTask: 'T1' }], carried: [],
}

test('under freezeFindingSet a fresh blocking lens finding is residue and does NOT fail the gate', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, freezeFindingSet: true },
    replies({ lens: freshCritical }))
  expect(result.residue.map((f: any) => f.title)).toEqual(['fresh'])
  expect(result.scoreTable.residue).toBe(1)
  // Still reported — frozen means "does not gate", not "not looked for".
  expect(result.findings.some((f: any) => f.title === 'fresh')).toBe(true)
  expect(result.scoreTable.survivingBlocking).toBe(0)
  expect(result.overallPass).toBe(true)
  // And it routes nothing: a residue finding must not drag its ownerTask into the re-run, or into
  // planFindings — a finding the freeze excluded from the verdict cannot select the next round.
  expect(result.tasksThatFlagged).toEqual([])
  expect(result.planFindings).toEqual([])
})

test('the freeze narrows which FINDINGS gate — it never stops a route from routing', async () => {
  // A route diagnoses a failure the checks already found, so the freeze has nothing to say about it:
  // the mechanical check is failing whether or not this round's fresh findings gate.
  const { result } = await run(
    { ...baseArgs, tasks: one, freezeFindingSet: true, mechanicalChecks: [{ name: 'suite', cmd: 'bun test' }] },
    replies({
      mech: { suite: { name: 'suite', exitCode: 7, output: 'boom' } },
      lens: { routes: [{ failure: 'suite exited 7', ownerTask: 'T1', cause: 'c', fix: 'f' }], findings: [], carried: [] },
    }))
  expect(result.overallPass).toBe(false)
  expect(result.tasksThatFlagged).toEqual(['T1'])
  expect(result.routes).toHaveLength(1)
})

test('under freezeFindingSet an OPEN carried finding still fails the gate', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, freezeFindingSet: true, carriedFindings: [carriedMajor()] },
    replies({ lens: { ...freshCritical, carried: [{ id: 'C1', status: 'open', evidence: 'still broken' }] } }))
  expect(result.overallPass).toBe(false)
  expect(result.scoreTable.survivingBlocking).toBe(1)
  // L3: a FAIL always names something to re-run.
  expect(result.lensesThatFlagged).toEqual(['lens'])
  // The fresh critical is beside it, as residue, not as a second gate failure.
  expect(result.residue.map((f: any) => f.title)).toEqual(['fresh'])
})

test('a CLOSED carried finding under freeze leaves the gate clean — the carried set is closed', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, freezeFindingSet: true, carriedFindings: [carriedMajor()] },
    replies({ lens: { ...freshCritical, carried: [{ id: 'C1', status: 'closed', evidence: 'fixed; test passes' }] } }))
  expect(result.overallPass).toBe(true)
  expect(result.scoreTable.carriedOpen).toBe(0)
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

test('absent freezeFindingSet changes nothing: no residue key, and a fresh blocking finding still fails', async () => {
  const { result } = await run({ ...baseArgs, tasks: one }, replies({ lens: freshCritical }))
  expect('residue' in result).toBe(false)
  expect('residue' in result.scoreTable).toBe(false)
  expect(result.scoreTable.survivingBlocking).toBe(1)
  expect(result.overallPass).toBe(false)
})

test('a non-true freezeFindingSet is not a freeze — only the boolean true arms it', async () => {
  for (const v of ['true', 1, {}]) {
    const { result } = await run(
      { ...baseArgs, tasks: one, freezeFindingSet: v as any },
      replies({ lens: freshCritical }))
    expect(result.overallPass).toBe(false)
    expect('residue' in result).toBe(false)
  }
})

test('the freeze does NOT defer a dead lens — a review that never ran is not a fresh finding', async () => {
  // gate-laws L4. Under the freeze only carried findings gate, so a dead lens with an EMPTY carried
  // set would otherwise pass: nothing ruled on nothing, and the synthesized critical would sit in
  // residue. The absence of the adjudication the freeze depends on has to fail closed.
  const { result } = await run(
    { ...baseArgs, readOnly: true, tasks: [], freezeFindingSet: true },
    replies({ lens: null }))
  expect(result.overallPass).toBe(false)
  expect(result.lensesThatFlagged).toEqual(['lens'])
  expect(result.residue).toEqual([])
  expect(result.scoreTable.survivingBlocking).toBe(1)
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
// The agent returns RAW COUNTS and work computes every score, because an agent that reports its own
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
    // this through, and the agent then reports the very number `work` exists to compute.
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
  // ...and it adds nothing to any selector, so `work`'s law that a FAIL names a re-run target holds.
  expect(result.tasksThatFlagged).toEqual([])
  expect(result.mechanicalThatFailed).toEqual([])
  expect(result.lensesThatFlagged).toEqual([])
})

test('overallPass is unchanged by any score value — the whole gate arithmetic is identical', async () => {
  const perfect = { itemsChecked: 40, missing: 0, collapsed: 0, redundant: 0, mismatches: 0 }
  const awful = { itemsChecked: 40, missing: 99, collapsed: 99, redundant: 99, mismatches: 99 }
  const go = (counts: any) => run(
    { ...baseArgs, tasks: one, mechanicalChecks: [{ name: 'm', cmd: 'c' }],
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
// The hash the work skill pins is over the `work:dispatch` block's canonical JSON, so the paragraphs around
// it are explanatory. An agent that reads a paragraph as a requirement is inventing authority, and
// an agent that cannot re-derive the hash cannot detect an amendment — so AUTHORITY has to name the
// field, the verification command, and the prose's status.

test('AUTHORITY names the work:dispatch spec block as the ONLY authority, with its specHash', async () => {
  const { prompts } = await run({ ...baseArgs, tasks: one }, replies())
  for (const [, p] of prompts) {
    expect(p).toContain('work:dispatch')
    expect(p).toContain(baseArgs.specHash)
    expect(p).toMatch(/only authority/i)
  }
})

test('AUTHORITY gives the --spec-hash command to verify with, and says to stop on mismatch', async () => {
  const { prompts } = await run({ ...baseArgs, tasks: one }, replies())
  for (const [, p] of prompts) {
    expect(p).toContain('work-dispatch.sh --spec-hash')
    expect(p).toContain(baseArgs.planPath)
    expect(p).toMatch(/stop/i)
  }
})

test('AUTHORITY states the surrounding prose is explanatory and not authoritative', async () => {
  const { prompts } = await run({ ...baseArgs, tasks: one }, replies())
  for (const [, p] of prompts) expect(p).toMatch(/prose[^\n]*not authoritative|not authoritative[^\n]*prose/i)
})

test('nothing dispatched still mentions planHash — the field is gone, not aliased', async () => {
  const { prompts } = await run({ ...baseArgs, tasks: one }, replies())
  expect(prompts.size).toBeGreaterThan(0)
  for (const [, p] of prompts) expect(p).not.toContain('planHash')
})

// ---------------------------------------------------------------- per-leg effort dials
// Each dial has three states and all three are asserted: absent takes the leg's default, null omits
// the key so the leg inherits the session default, and an explicit value wins. The two probes pinned
// at low and the absence of a lens dial are asserted too — those are decisions, not omissions.

// The harness reports labels and prompts, not opts, so the opts are captured here.
const dispatchOpts = async (args: any, reply: any = replies()) => {
  const opts = new Map<string, any>()
  await run(args, (label: string, prompt: string, o: any) => { opts.set(label, o); return reply(label, prompt, o) })
  return opts
}
// One run that dispatches all three dialable legs: implement, verify and scored.
const allLegs = (over: any = {}) => ({
  ...baseArgs, tasks: one, scoredChecks: [scoredCheck()], ...over,
})
const DIALED = ['implement:T1', 'verify:T1', 'scored:slides:L1']

test('each dialable leg carries its default effort when the arg is absent', async () => {
  const opts = await dispatchOpts(allLegs(), scoredReplies())
  for (const label of DIALED) expect(opts.has(label)).toBe(true)
  expect(opts.get('implement:T1').effort).toBe('xhigh')
  expect(opts.get('verify:T1').effort).toBe('medium')
  expect(opts.get('scored:slides:L1').effort).toBe('low')
})

test('null on a dial omits the effort key entirely — the leg inherits the session default', async () => {
  const opts = await dispatchOpts(allLegs({
    implementerEffort: null, verifierEffort: null, scoredEffort: null,
  }), scoredReplies())
  // `in`, not `=== undefined`: an explicit `effort: undefined` is still a key the dispatcher reads.
  for (const label of DIALED) expect('effort' in opts.get(label)).toBe(false)
})

test('an explicit effort overrides the default on every dial', async () => {
  const opts = await dispatchOpts(allLegs({
    implementerEffort: 'low', verifierEffort: 'xhigh', scoredEffort: 'high',
  }), scoredReplies())
  expect(opts.get('implement:T1').effort).toBe('low')
  expect(opts.get('verify:T1').effort).toBe('xhigh')
  expect(opts.get('scored:slides:L1').effort).toBe('high')
})

test('the red and mechanical probes are scripted commands — no model, no effort, no dial reaches them', async () => {
  const opts = await dispatchOpts({
    ...baseArgs, tasks: [task({ redCommand: 'pytest x' })],
    mechanicalChecks: [{ name: 'tests', cmd: 'bun test' }],
    implementerEffort: 'xhigh', verifierEffort: 'xhigh', scoredEffort: 'xhigh',
  })
  for (const label of ['red:before:T1', 'red:after:T1', 'mechanical:tests']) {
    expect(opts.get(label)).toEqual({ label, scripted: true })
  }
})

// ---------------------------------------------------------------- the lens's model and effort
// The lens has DEFAULTS, not inherits: the replay that justified replacing the lens array with one
// lens ran on sonnet at high effort, so those are the settings the measurement covers. Pass null to
// omit the key and inherit the session's instead.

test('the lens defaults to sonnet at high effort — the settings the one-lens replay measured', async () => {
  const opts = await dispatchOpts({ ...baseArgs, tasks: one })
  expect(opts.get('lens').model).toBe('sonnet')
  expect(opts.get('lens').effort).toBe('high')
})

test("the lens's own model and effort win over the defaults", async () => {
  const opts = await dispatchOpts({ ...baseArgs, tasks: one, lens: { prompt: 'p', refs: [], model: 'haiku', effort: 'xhigh' } })
  expect(opts.get('lens').model).toBe('haiku')
  expect(opts.get('lens').effort).toBe('xhigh')
})

test('model: null / effort: null omit the key entirely — the lens inherits the session default', async () => {
  const opts = await dispatchOpts({ ...baseArgs, tasks: one, lens: { prompt: 'p', model: null, effort: null } })
  // `in`, not `=== undefined`: an explicit `model: undefined` is still a key the dispatcher reads.
  expect('model' in opts.get('lens')).toBe(false)
  expect('effort' in opts.get('lens')).toBe(false)
})

test('lensModel is the fallback only when the lens itself names model: null', async () => {
  const opts = await dispatchOpts({ ...baseArgs, tasks: one, lensModel: 'opus', lens: { prompt: 'p', model: null } })
  expect(opts.get('lens').model).toBe('opus')
  // With no `model` key at all, the lens's own default wins over lensModel — a documented default is
  // not something a global silently overrides.
  const dflt = await dispatchOpts({ ...baseArgs, tasks: one, lensModel: 'opus', lens: { prompt: 'p' } })
  expect(dflt.get('lens').model).toBe('sonnet')
})

test("the lens's agentType reaches the leg, and readOnly forces Explore when it names none", async () => {
  const explicit = await dispatchOpts({ ...baseArgs, tasks: one, lens: { prompt: 'p', agentType: 'ds-reviewer' } })
  expect(explicit.get('lens').agentType).toBe('ds-reviewer')
  const ro = await dispatchOpts({ ...baseArgs, readOnly: true, tasks: [], lens: { prompt: 'p' } })
  expect(ro.get('lens').agentType).toBe('Explore')
  // Outside readOnly, no agentType key at all — byte-identical to inheriting the dispatcher default.
  const plain = await dispatchOpts({ ...baseArgs, tasks: one, lens: { prompt: 'p' } })
  expect('agentType' in plain.get('lens')).toBe(false)
})

// ---------------------------------------------------------------- positive dispositions (the leak)
// A gate cannot block on a TRUE statement. So a lens that files "I checked X and it holds" as a
// FINDING fails the run for nothing. Measured 2026-09-27 over 3,137 findings: 2.8% were positive
// dispositions and ~47 reached gates. The fix is a second output channel — and the backstops ROUTE a
// misfiled entry into that channel, they never delete it.

// readOnly so the task dimensions are n/a and the verdict turns on the findings alone.
const lensOnly = (over: any = {}) => ({ ...baseArgs, readOnly: true, tasks: [], ...over })
const reports = (lensResult: any) => replies({ lens: { routes: [], findings: [], carried: [], ...lensResult } })

test('a lens `dispositions` entry is reported and never gates', async () => {
  const { result } = await run(
    lensOnly(),
    reports({ dispositions: [{ title: 'constraint A2 holds', detail: 'evidence' }] }))
  expect(result.overallPass).toBe(true)
  expect(result.dispositions).toHaveLength(1)
  expect(result.dispositions[0]).toMatchObject({ title: 'constraint A2 holds', lens: 'lens' })
  expect(result.scoreTable.dispositions).toBe(1)
  // It is not in the findings pool at all.
  expect(result.scoreTable.lensFindings).toBe(0)
  expect(result.findings).toEqual([])
})

test('defect:false on a finding routes it to dispositions instead of gating — the structural backstop', async () => {
  const { result } = await run(
    lensOnly(),
    reports({ findings: [{ title: 'looks like a defect claim', severity: 'critical', detail: 'd', ownerTask: 'plan', defect: false }] }))
  expect(result.overallPass).toBe(true)
  expect(result.scoreTable.survivingBlocking).toBe(0)
  // Routed, not deleted: the claimed severity and the reason are both preserved for the human.
  expect(result.dispositions).toHaveLength(1)
  expect(result.dispositions[0].routedFromFinding).toBe(true)
  expect(result.dispositions[0].claimedSeverity).toBe('critical')
  expect(result.dispositions[0].routedBecause).toMatch(/defect:false/)
  expect(result.scoreTable.dispositionsRoutedFromFindings).toBe(1)
  // A routed entry reaches NO selector: it never becomes a planFindings item either.
  expect(result.planFindings).toEqual([])
})

test('defect:true, and an omitted defect key, both leave a finding in the gate', async () => {
  for (const f of [
    { title: 'a real defect', severity: 'major', detail: 'd', ownerTask: 'plan', defect: true },
    { title: 'a real defect', severity: 'major', detail: 'd', ownerTask: 'plan' },
  ]) {
    const { result } = await run(lensOnly(), reports({ findings: [f] }))
    expect(result.overallPass).toBe(false)
    expect(result.scoreTable.survivingBlocking).toBe(1)
    expect(result.dispositions).toEqual([])
  }
})

// The five hand-read direction-A examples from the 2026-09-27 study (jev-refuter/disagreements.txt):
// every one is a positive disposition the refuter upheld into a gate. Titles and detail openings are
// verbatim from that corpus.
const DIRECTION_A = [
  {
    id: '1d18f6aa87cf', severity: 'minor',
    title: 'No violations found for the constraints this task touches — evidence-based disposition',
    detail: 'This is a MODEL-EVALUATED disposition, not a computed pass, based on the files actually read: /home/eh/projects/hidden-figures/src/agk_sample.py (full, 790 lines)',
  },
  {
    id: '43e2b9e2556f', severity: 'major',
    title: 'A2 (SE structure) and A3/A4/A5 (figures) are implemented with matching diagnostics — satisfied',
    detail: 'MODEL-EVALUATED (satisfied, not a defect, reported for completeness of the constraint list). src/first_stage.py clusters every bridge/deviation regression by config.CLUSTER_VAR',
  },
  {
    id: '17dced0cff55', severity: 'minor',
    title: 'No prose drift detected: all 39 changed spans lie inside #footnote[...]',
    detail: 'Verified mechanically. Line count is identical (636 lines at HEAD and in the working tree), so there is no insertion, deletion, or reordering of paragraphs.',
  },
  {
    id: 'c53f97b42630', severity: 'minor',
    title: 'DEN — every rate in the STALENESS and COVERAGE headlines states its denominator; disposition supported',
    detail: 'MODEL-EVALUATED (DEN, every rate states its denominator). Supported by the run\'s own output; no finding.',
  },
  {
    id: 'e6459357c0b0', severity: 'minor',
    title: 'tests/gates/ was not edited by any task',
    detail: 'No finding on the gate directory, recorded as a positive check because it is the run\'s judging surface. Six gates were authored 22:54-22:56, before the round-1 dispatch',
  },
]

test('the text backstop routes all five direction-A examples out of the gate, with no defect flag set', async () => {
  for (const ex of DIRECTION_A) {
    const { result } = await run(
      lensOnly(),
      reports({ findings: [{ title: ex.title, severity: ex.severity, detail: ex.detail, ownerTask: 'plan' }] }))
    expect(result.dispositions, `${ex.id} should route`).toHaveLength(1)
    expect(result.dispositions[0].routedFromFinding).toBe(true)
    expect(result.findings, `${ex.id} must not reach the gate`).toEqual([])
    expect(result.planFindings, `${ex.id} must reach no selector`).toEqual([])
  }
})

// The counter-side of the same rule, and the reason the patterns are narrow rather than clever: real
// defect titles from the same corpus, including ones that use "no", "not", "missing" and "satisfied"
// in a DEFECT sense. Measured over all 3,137 rows: 11 matches, 0 of them a real defect. These are the
// near misses that make that 0 non-trivial.
const REAL_DEFECT_TITLES = [
  'T4 was never implemented: trash-plan and trash-apply do not exist anywhere in the tree',
  'The coverage caveat is undisclosed in every deliverable',
  'No test covers the zero-args path, so the contract is unproven',
  'openDelta THREW on the recovered base snapshot token',
  'The DQ4 identity is not satisfied on 12 of 3,027 rows',
  'Missing denominator on the STALENESS headline rate',
  'refresh-drain.test.ts was edited by task T5, which the plan forbids',
  'The acceptance criterion names no command, so nothing was verified',
  'A2 is violated: standard errors are not clustered anywhere in first_stage.py',
  'No finding is recorded for D19, but the chain does not close',
]

test('real defect titles are NOT routed — including ones containing no/not/missing/satisfied', async () => {
  for (const title of REAL_DEFECT_TITLES) {
    const { result } = await run(
      lensOnly(),
      reports({ findings: [{ title, severity: 'major', detail: 'src/x.py:10 — the measured output was wrong.', ownerTask: 'plan' }] }))
    expect(result.dispositions, `must not route: ${title}`).toEqual([])
    expect(result.findings, `must still gate: ${title}`).toHaveLength(1)
    expect(result.overallPass).toBe(false)
  }
})

test('a detail that merely mentions "not a defect" mid-body still gates — the pattern is anchored to the opening', async () => {
  const detail = 'src/x.py:44 computes the wrong denominator. ' + 'Filler. '.repeat(40) +
    'Note that the adjacent helper is not a defect; only this line is.'
  const { result } = await run(
    lensOnly(),
    reports({ findings: [{ title: 'wrong denominator in the coverage rate', severity: 'major', detail, ownerTask: 'plan' }] }))
  expect(result.dispositions).toEqual([])
  expect(result.overallPass).toBe(false)
})

test('dispositions are absent-as-empty, and the gate log stays silent, when no lens reports one', async () => {
  const { result, logs } = await run(lensOnly(), replies())
  expect(result.dispositions).toEqual([])
  expect(result.scoreTable.dispositions).toBe(0)
  expect(logs.join('\n')).not.toMatch(/disposition/)
})

test('the gate log names the routed count, so a mis-filing lens is visible behind a PASS', async () => {
  const { logs } = await run(
    lensOnly(),
    reports({
      findings: [{ title: 'E1/E4 determinism in the reviewed scripts — satisfied', severity: 'major', detail: 'd', ownerTask: 'plan' }],
      dispositions: [{ title: 'A2 holds', detail: 'e' }],
    }))
  const gate = logs.find(l => l.startsWith('gate:')) || ''
  expect(gate).toContain('2 positive disposition(s) reported, not gated')
  expect(gate).toContain('1 routed out of findings')
})

test('a dead lens still reports dispositions as [] — an empty list is honest, not clean', async () => {
  const { result } = await run(lensOnly(), replies({ lens: null }))
  expect(result.dispositions).toEqual([])
  // The dimension failed on the synthesized critical, not on a missing disposition list.
  expect(result.overallPass).toBe(false)
  expect(result.scoreTable.lensesReported).toBe(0)
})

// ================================================================ THE ONE-LENS CONTRACT
// One lens, dispatched AFTER the per-task verifiers and the mechanical checks, over a digest of what
// they reported. Measured 2026-09-29/30: 4–10 parallel lenses plus one refuter per finding were 55%
// of the agents in a round and changed 0 verdicts, while a single Sonnet lens on one open-ended
// prompt re-found 7/7 reconstructed correctness defects. Each test below pins one numbered item of
// that contract; deleting one deletes the only thing that says the item is required.

// ---------------------------------------------------------------- (1) the reviewLenses migration error

test('reviewLenses migration error: passing the old array throws and names `lens` as its replacement', async () => {
  for (const v of [[{ key: 'alpha', prompt: 'p' }], [], null]) {
    const r = await runCatching({ ...baseArgs, tasks: one, reviewLenses: v as any }, replies())
    expect(r.threw).toBe(true)
    expect(String(r.error)).toMatch(/reviewLenses is gone/)
    expect(String(r.error)).toMatch(/`lens`/)
    // Arg-time, before a single agent is spent: a migration error that costs a round is not a
    // migration error, it is a bill.
    expect(r.dispatched).toEqual([])
  }
  // The key genuinely absent (an explicit undefined from a spread) is NOT a migration error.
  expect((await runCatching({ ...baseArgs, tasks: one, reviewLenses: undefined }, replies())).threw).toBe(false)
})

test('a non-object lens throws at arg time', async () => {
  for (const v of [[], 'p', 7]) {
    const r = await runCatching({ ...baseArgs, tasks: one, lens: v as any }, replies())
    expect(r.threw).toBe(true)
    expect(String(r.error)).toMatch(/lens must be an object/)
  }
})

test('exactly ONE lens is dispatched, under the bare label `lens`', async () => {
  const { dispatched } = await run({ ...baseArgs, tasks: one }, replies())
  expect(dispatched.filter(l => l === 'lens')).toHaveLength(1)
  expect(dispatched.filter(l => l.startsWith('lens:'))).toEqual([])
  // No refuter and no ranker leg exists any more.
  expect(dispatched.filter(l => /^refute|^rank/.test(l))).toEqual([])
})

test('an absent lens prompt falls back to the built-in four-dimension default', async () => {
  const { prompts } = await run({ ...baseArgs, tasks: one }, replies())
  const p = prompts.get('lens') || ''
  for (const dim of ['CORRECTNESS', 'SPEC FIDELITY', 'TESTS', 'METHODOLOGY']) expect(p).toContain(dim)
  // A caller's own prompt REPLACES it rather than being appended to it.
  const custom = await run({ ...baseArgs, tasks: one, lens: { prompt: 'ZZ-MY-OWN-PROMPT-ZZ' } }, replies())
  expect(custom.prompts.get('lens')).toContain('ZZ-MY-OWN-PROMPT-ZZ')
  expect(custom.prompts.get('lens')).not.toContain('METHODOLOGY')
})

test('the lens refs are named with a read-in-full instruction, and absent refs add nothing', async () => {
  const withRefs = await run({ ...baseArgs, tasks: one, lens: { prompt: 'p', refs: ['/abs/rules.md'] } }, replies())
  expect(withRefs.prompts.get('lens')).toContain('/abs/rules.md')
  expect(withRefs.prompts.get('lens')).toMatch(/IN FULL/)
  const without = await run({ ...baseArgs, tasks: one, lens: { prompt: 'p' } }, replies())
  expect(without.prompts.get('lens')).not.toMatch(/IN FULL before judging/)
})

// ---------------------------------------------------------------- (2) the lens runs AFTER the checks

test('lens runs after mechanical: completion barrier over parallel verify and scored legs, then the scripted checks', async () => {
  // verify and scored are agents and run together inside the workflow; mechanical is work-checks.sh,
  // which runs once the agents stage has returned. The lens is the farm row after all of them.
  const agentChecks = ['verify:T1', 'scored:slides:L1', 'scored:slides:L2']
  const checks = [...agentChecks, 'mechanical:lint']
  const events: string[] = []
  const completed = new Set<string>()
  const reply = scoredReplies()
  const { order } = await run(
    { ...baseArgs, tasks: one, mechanicalChecks: [{ name: 'lint', cmd: 'x' }],
      scoredChecks: [scoredCheck()] },
    async (label: string, prompt: string, opts: any) => {
      events.push(`start:${label}`)
      if (checks.includes(label)) {
        await new Promise(resolve => setTimeout(resolve, 5))
        completed.add(label)
        events.push(`end:${label}`)
      }
      if (label === 'lens') expect([...completed].sort()).toEqual([...checks].sort())
      return reply(label, prompt, opts)
    })
  const firstEnd = events.findIndex(e => e.startsWith('end:'))
  for (const label of agentChecks) {
    // Starting the lens last is not enough: the independent checks must start together AND finish first.
    expect(events.indexOf(`start:${label}`)).toBeLessThan(firstEnd)
  }
  for (const label of checks) {
    expect(events.indexOf(`end:${label}`)).toBeLessThan(events.indexOf('start:lens'))
    expect(order.indexOf(label)).toBeGreaterThan(order.indexOf('implement:T1'))
  }
  for (const label of agentChecks) expect(events.indexOf(`end:${label}`)).toBeLessThan(events.indexOf('start:mechanical:lint'))
  expect(order.indexOf('lens')).toBe(order.length - 1)
})

test('the digest carries the flagged tasks, the verifier failures and the red outcomes', async () => {
  const { prompts } = await run(
    { ...baseArgs, tasks: [task({ id: 'T1', redCommand: 'pytest x' }), task({ id: 'T2', writablePaths: ['b'] })] },
    replies({
      verify: { T1: { id: 'T1', pass: false, evidence: 'e', failures: ['the acceptance command exits 1'] } },
      red: { before: 1, after: 0 },
    }))
  const p = prompts.get('lens') || ''
  expect(p).toContain('T1: its blind verifier judged the acceptance criterion unmet')
  expect(p).toContain('the acceptance command exits 1')
  expect(p).toContain('T1: red-green')
  expect(p).toContain('pytest x')
})

test('the digest carries a mechanical failure with its name, exit code and the last 60 lines', async () => {
  // 200 lines in: only the tail may reach the digest, and the tail is where a runner puts the summary.
  const output = Array.from({ length: 200 }, (_v, i) => `line-${i}`).join('\n')
  const { prompts } = await run(
    { ...baseArgs, tasks: one, mechanicalChecks: [{ name: 'suite', cmd: 'bun test' }] },
    replies({ mech: { suite: { name: 'suite', exitCode: 7, output } } }))
  const p = prompts.get('lens') || ''
  expect(p).toContain('### suite — exitCode 7')
  expect(p).toContain('line-199')
  expect(p).toContain('line-140')     // the 60th line from the end
  expect(p).not.toContain('line-139') // one line further back is truncated
})

test('the digest carries every carried finding, by id, with the rule that silence leaves it open', async () => {
  const { prompts } = await run(
    { ...baseArgs, tasks: one, carriedFindings: [{ id: 'C7', title: 'the denominator is wrong', severity: 'major', detail: 'src/x.py:44', ownerTask: 'T1' }] },
    replies())
  const p = prompts.get('lens') || ''
  expect(p).toContain('id=C7')
  expect(p).toContain('the denominator is wrong')
  expect(p).toContain('owner=T1')
  expect(p).toMatch(/stays OPEN/)
})

test('a run with nothing to report carries no empty digest headings', async () => {
  const { prompts } = await run({ ...baseArgs, tasks: one }, replies())
  const p = prompts.get('lens') || ''
  for (const heading of ['TASKS THIS ROUND FLAGGED', 'VERIFIER FAILURES', 'RED-GATE OUTCOMES', 'CARRIED FINDINGS', 'MECHANICAL CHECKS THAT FAILED']) {
    expect(p, `should be silent about ${heading}`).not.toContain(heading)
  }
})

// ---------------------------------------------------------------- (3) the two modes

test('GREEN mode when everything passed: the lens is told to make one open-ended pass', async () => {
  const { prompts, result } = await run({ ...baseArgs, tasks: one, mechanicalChecks: [{ name: 'm', cmd: 'c' }] }, replies())
  const p = prompts.get('lens') || ''
  expect(p).toContain('MODE: GREEN')
  expect(p).toMatch(/ONE OPEN-ENDED PASS/)
  expect(result.scoreTable.lensMode).toBe('GREEN')
})

test('RED mode when a task flagged or a check failed: the lens is told to diagnose and route', async () => {
  for (const c of [
    { args: { tasks: one }, reply: replies({ verify: { T1: { id: 'T1', pass: false, evidence: '', failures: ['no'] } } }) },
    { args: { tasks: one, mechanicalChecks: [{ name: 'm', cmd: 'c' }] }, reply: replies({ mech: { m: { name: 'm', exitCode: 1, output: '' } } }) },
  ]) {
    const { prompts, result } = await run({ ...baseArgs, ...c.args }, c.reply)
    const p = prompts.get('lens') || ''
    expect(p).toContain('MODE: RED')
    expect(p).toMatch(/DIAGNOSIS AND ROUTING/)
    expect(result.scoreTable.lensMode).toBe('RED')
  }
})

test('the MODE is computed by the JS from the same arrays the gate reads — the lens never chooses it', async () => {
  // The lens is handed a mode it cannot argue with. A lens that picked its own would be choosing how
  // hard to be judged, which is gate-laws L5 with the roles reversed.
  const { result } = await run(
    { ...baseArgs, tasks: one, mechanicalChecks: [{ name: 'm', cmd: 'c' }] },
    replies({
      mech: { m: { name: 'm', exitCode: 1, output: 'boom' } },
      // The lens claims everything is fine and returns a GREEN-shaped result. The mode stays RED.
      lens: { routes: [], findings: [], carried: [], dispositions: [{ title: 'all good', detail: 'e' }] },
    }))
  expect(result.scoreTable.lensMode).toBe('RED')
  expect(result.overallPass).toBe(false)
})

// ---------------------------------------------------------------- (5) routing

const routed = (ownerTask: string, failure = 'mechanical check "suite" exited 7') => ({
  routes: [{ failure, ownerTask, cause: 'the assertion was never updated', fix: 'update it' }],
  findings: [], carried: [], dispositions: [],
})

test('RED routes a mechanical failure to its owner task, which joins tasksThatFlagged', async () => {
  // M2: before this, a mechanical failure was attributable to no task, so the next round re-ran every
  // task in the plan. The lens's route is what narrows it.
  const two = [task({ id: 'T1', writablePaths: ['a'] }), task({ id: 'T2', writablePaths: ['b'] })]
  const { result } = await run(
    { ...baseArgs, tasks: two, mechanicalChecks: [{ name: 'suite', cmd: 'bun test' }] },
    replies({ mech: { suite: { name: 'suite', exitCode: 7, output: 'boom' } }, lens: routed('T2') }))
  expect(result.overallPass).toBe(false)
  expect(result.mechanicalThatFailed.map((m: any) => m.name)).toEqual(['suite'])
  // The narrowing: T2 and only T2.
  expect(result.tasksThatFlagged).toEqual(['T2'])
  expect(result.routes).toHaveLength(1)
  expect(result.routes[0].ownerTask).toBe('T2')
})

test('ownerTask "plan" lands in planFindings, not in tasksThatFlagged', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, mechanicalChecks: [{ name: 'suite', cmd: 'bun test' }] },
    replies({ mech: { suite: { name: 'suite', exitCode: 7, output: 'boom' } }, lens: routed('plan') }))
  expect(result.overallPass).toBe(false)
  expect(result.planFindings).toHaveLength(1)
  expect(result.planFindings[0].ownerTask).toBe('plan')
  // No task can fix it, so no task is re-run for it.
  expect(result.tasksThatFlagged).toEqual([])
  expect(result.scoreTable.planFindings).toBe(1)
})

test('an ownerTask that is neither a task id nor "plan" narrows nothing, and the log says so', async () => {
  const { result, logs } = await run(
    { ...baseArgs, tasks: one, mechanicalChecks: [{ name: 'suite', cmd: 'bun test' }] },
    replies({ mech: { suite: { name: 'suite', exitCode: 7, output: 'boom' } }, lens: routed('T-NOPE') }))
  expect(result.overallPass).toBe(false)
  expect(result.tasksThatFlagged).toEqual([])
  expect(result.planFindings).toEqual([])
  // The run still FAILS on the mechanical check, so nothing escapes — but a reader has to be able to
  // see why the re-run was not narrowed.
  expect(result.mechanicalThatFailed).toHaveLength(1)
  expect(logs.join('\n')).toMatch(/name no valid ownerTask/)
})

test('a route missing its failure or ownerTask is dropped rather than routed to nothing', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, mechanicalChecks: [{ name: 'suite', cmd: 'bun test' }] },
    replies({
      mech: { suite: { name: 'suite', exitCode: 7, output: 'boom' } },
      lens: { routes: [{ cause: 'c', fix: 'f' }, { failure: 'x', cause: 'c', fix: 'f' }], findings: [], carried: [] },
    }))
  expect(result.routes).toEqual([])
  // Still FAILS: the mechanical failure is its own selector, so nothing is laundered by a bad route.
  expect(result.overallPass).toBe(false)
  expect(result.mechanicalThatFailed).toHaveLength(1)
})

test('GREEN blocking finding fails the gate, and its ownerTask joins tasksThatFlagged', async () => {
  const two = [task({ id: 'T1', writablePaths: ['a'] }), task({ id: 'T2', writablePaths: ['b'] })]
  const { result } = await run({ ...baseArgs, tasks: two },
    replies({ lens: { routes: [], carried: [], findings: [
      { title: 'the retry loop never terminates', severity: 'critical', detail: 'd', file: 'src/a.ts', line: 41, ownerTask: 'T2' },
    ] } }))
  expect(result.overallPass).toBe(false)
  expect(result.lensesThatFlagged).toEqual(['lens'])
  expect(result.tasksThatFlagged).toEqual(['T2'])
  expect(result.scoreTable.survivingBlocking).toBe(1)
  // `line` stays its own field: a `file` of "src/a.ts:41" matches no path in the task table.
  expect(result.findings[0].line).toBe(41)
  expect(result.findings[0].file).toBe('src/a.ts')
})

test('a GREEN MINOR finding does not fail the gate and names no selector', async () => {
  const { result } = await run({ ...baseArgs, tasks: one },
    replies({ lens: { routes: [], carried: [], findings: [
      { title: 'a stale comment', severity: 'minor', detail: 'd', ownerTask: 'T1' },
    ] } }))
  expect(result.overallPass).toBe(true)
  expect(result.lensesThatFlagged).toEqual([])
  expect(result.tasksThatFlagged).toEqual([])
  expect(result.scoreTable.survivingMinor).toBe(1)
  // Reported, though: a minor finding is not a deleted one.
  expect(result.findings).toHaveLength(1)
})

test('an OPEN carried finding routes to its ownerTask, so the next round is narrowed to it', async () => {
  const two = [task({ id: 'T1', writablePaths: ['a'] }), task({ id: 'T2', writablePaths: ['b'] })]
  const { result } = await run(
    {
      ...baseArgs, tasks: two, freezeFindingSet: true,
      carriedFindings: [{ id: 'C1', title: 'the denominator is wrong', severity: 'major', detail: 'd', ownerTask: 'T2' }],
    },
    replies({ lens: { routes: [], findings: [], carried: [{ id: 'C1', status: 'open', evidence: 'still wrong' }] } }))
  expect(result.overallPass).toBe(false)
  expect(result.tasksThatFlagged).toEqual(['T2'])
  expect(result.lensesThatFlagged).toEqual(['lens'])
})

test('an OPEN carried finding owned by the PLAN lands in planFindings, not on a task', async () => {
  const { result } = await run(
    {
      ...baseArgs, tasks: one, freezeFindingSet: true,
      carriedFindings: [{ id: 'C1', title: 'the fix needs a path no task may write', severity: 'critical', detail: 'd', ownerTask: 'plan' }],
    },
    replies({ lens: { routes: [], findings: [], carried: [{ id: 'C1', status: 'open', evidence: 'unchanged' }] } }))
  expect(result.overallPass).toBe(false)
  expect(result.planFindings.map((f: any) => f.id)).toEqual(['C1'])
  expect(result.tasksThatFlagged).toEqual([])
  expect(result.lensesThatFlagged).toEqual(['lens'])
})

test('lensesThatFlagged is ["lens"] iff a blocking finding stands, and [] otherwise', async () => {
  const blocking = await run({ ...baseArgs, tasks: one },
    replies({ lens: { routes: [], carried: [], findings: [{ title: 't', severity: 'major', detail: 'd', ownerTask: 'T1' }] } }))
  expect(blocking.result.lensesThatFlagged).toEqual(['lens'])
  const clean = await run({ ...baseArgs, tasks: one }, replies())
  expect(clean.result.lensesThatFlagged).toEqual([])
})

// ---------------------------------------------------------------- (7) taskFixes (M3)

test('taskFixes appear in the implementer prompt for THAT task, under the FIX FIRST heading', async () => {
  // M3: before this the carried findings reached only the review legs, so the one agent that could act
  // on them was the one agent never shown them.
  const two = [task({ id: 'T1', writablePaths: ['a'] }), task({ id: 'T2', writablePaths: ['b'] })]
  const { prompts } = await run(
    {
      ...baseArgs, tasks: two,
      taskFixes: {
        T2: [
          { title: 'the denominator is wrong', severity: 'major', file: 'src/x.py', line: 44, detail: 'it divides by the wrong count' },
          { failure: 'mechanical suite exited 7', cause: 'the assertion was never updated', fix: 'update the expected value' },
          'and re-run the suite afterwards',
        ],
      },
    },
    replies())
  const p2 = prompts.get('implement:T2') || ''
  expect(p2).toContain("FIX FIRST (from last round's review):")
  expect(p2).toContain('the denominator is wrong (major) [src/x.py:44]: it divides by the wrong count')
  expect(p2).toContain('mechanical suite exited 7: the assertion was never updated — update the expected value')
  expect(p2).toContain('and re-run the suite afterwards')
  // Only that task's implementer. A fix leaked into a sibling's prompt is an edit outside its paths.
  expect(prompts.get('implement:T1')).not.toContain('FIX FIRST')
})

test('absent taskFixes adds nothing to the implementer prompt — not a heading, not a blank line', async () => {
  const withNone = await run({ ...baseArgs, tasks: one }, replies())
  const withEmpty = await run({ ...baseArgs, tasks: one, taskFixes: { T1: [] } }, replies())
  expect(withNone.prompts.get('implement:T1')).not.toContain('FIX FIRST')
  expect(withEmpty.prompts.get('implement:T1')).toBe(withNone.prompts.get('implement:T1'))
})

test('taskFixes naming an unknown task id throws — a typo silently drops the fixes it carries', async () => {
  const r = await runCatching({ ...baseArgs, tasks: one, taskFixes: { NOPE: ['fix this'] } }, replies())
  expect(r.threw).toBe(true)
  expect(String(r.error)).toContain('unknown task id')
  expect(r.dispatched).toEqual([])
  for (const bad of [[], 'x', { T1: 'not an array' }]) {
    expect((await runCatching({ ...baseArgs, tasks: one, taskFixes: bad as any }, replies())).threw).toBe(true)
  }
})

// ---------------------------------------------------------------- (8) the zero-implementer round

const carriedAll = (ids: string[]) => ({
  implemented: ids.map(id => ({ id, done: true, changedFiles: ['x'], evidence: 'e' })),
  verified: ids.map(id => ({ id, pass: true, evidence: 'e', failures: [] })),
})

test('onlyTasks [] is a zero-implementer round: no implementer, no verifier, but the checks and the lens run', async () => {
  // M2's second half: a failure the lens routed to the PLAN is fixed by amending the plan, not by a
  // task — so the next round has to be able to re-run the checks over a tree nobody touched.
  const two = [task({ id: 'T1', writablePaths: ['a'] }), task({ id: 'T2', writablePaths: ['b'] })]
  const { dispatched, scripted, result } = await run(
    {
      ...baseArgs, tasks: two, onlyTasks: [],
      mechanicalChecks: [{ name: 'suite', cmd: 'bun test' }],
      priorResults: carriedAll(['T1', 'T2']),
    },
    replies())
  expect(dispatched.filter(l => l.startsWith('implement:'))).toEqual([])
  expect(dispatched.filter(l => l.startsWith('verify:'))).toEqual([])
  expect(scripted).toContain('mechanical:suite')
  expect(dispatched).toContain('lens')
  // The carried records are what make the task dimensions clean — not an empty set (gate-laws L2a).
  expect(result.scoreTable.tasksJudgedThisRun).toBe(0)
  expect(result.scoreTable.implementedDone).toBe(2)
  expect(result.scoreTable.verifyPassed).toBe(2)
  expect(result.overallPass).toBe(true)
})

test('onlyTasks [] with a task NOT carried throws — an empty set must never read as clean', async () => {
  const two = [task({ id: 'T1', writablePaths: ['a'] }), task({ id: 'T2', writablePaths: ['b'] })]
  for (const priorResults of [undefined, carriedAll(['T1']), { implemented: [{ id: 'T1', done: true }, { id: 'T2', done: true }] }]) {
    const r = await runCatching({ ...baseArgs, tasks: two, onlyTasks: [], priorResults: priorResults as any }, replies())
    expect(r.threw).toBe(true)
    expect(String(r.error)).toMatch(/ZERO-IMPLEMENTER/)
    expect(r.dispatched).toEqual([])
  }
})

test('a zero-implementer round still fails on a mechanical failure, and still routes it', async () => {
  const { result } = await run(
    {
      ...baseArgs, tasks: one, onlyTasks: [],
      mechanicalChecks: [{ name: 'suite', cmd: 'bun test' }],
      priorResults: carriedAll(['T1']),
    },
    replies({ mech: { suite: { name: 'suite', exitCode: 7, output: 'boom' } }, lens: routed('T1') }))
  expect(result.overallPass).toBe(false)
  expect(result.tasksThatFlagged).toEqual(['T1'])
})

test('a NON-empty onlyTasks matching nothing still throws — [] is the only legal empty slice', async () => {
  const r = await runCatching({ ...baseArgs, tasks: one, onlyTasks: ['NOPE'] }, replies())
  expect(r.threw).toBe(true)
  expect(String(r.error)).toContain('matched none')
})

// ---------------------------------------------------------------- (9) a carried proven red is not re-probed

const redTask = (id: string, paths: string[]) => task({ id, writablePaths: paths, redCommand: `pytest ${id}` })

test('carried proven red is not re-probed on a FULL re-run, and does not re-read as unproven', async () => {
  // M1's dead end: after the fix landed, a second `before` probe observes exit 0 and the verdict is
  // `red-not-red` — on a task that is in fact done. The run then refuses the already-fixed task and
  // dead-ends, which is exactly what the measured loop did.
  const tasks = [redTask('T1', ['a']), redTask('T2', ['b'])]
  const priorResults = {
    ...carriedAll(['T1', 'T2']),
    red: [{ id: 'T2', command: 'pytest T2', verdict: 'red-green', beforeExit: 1, afterExit: 0, beforeOutput: 'o', afterOutput: 'o' }],
  }
  // No onlyTasks: a FULL re-run, where the ordinary carry-forward would drop T2's adjudication.
  const { dispatched, scripted, result } = await run({ ...baseArgs, tasks, priorResults },
    replies({ red: { before: 1, after: 0 } }))
  expect(dispatched.filter(l => l.includes(':T2'))).toEqual(['implement:T2', 'verify:T2'])
  expect(scripted.filter(l => l.includes(':T2'))).toEqual([])
  expect(scripted).toContain('red:before:T1')
  // The carried verdict survives, so redMissing does not flag T2.
  expect(result.red.find((r: any) => r.id === 'T2').verdict).toBe('red-green')
  expect(result.scoreTable.redCarried).toBe(1)
  expect(result.scoreTable.redProven).toBe(2)
  expect(result.tasksThatFlagged).toEqual([])
  expect(result.overallPass).toBe(true)
})

test('an UNPROVEN carried red IS re-probed — only a proven pair is evidence', async () => {
  for (const verdict of ['red-not-red', 'green-not-green', 'red-unproven']) {
    const { scripted } = await run(
      { ...baseArgs, tasks: [redTask('T1', ['a'])], priorResults: { ...carriedAll(['T1']), red: [{ id: 'T1', verdict }] } },
      replies({ red: { before: 1, after: 0 } }))
    expect(scripted, `${verdict} must be re-probed`).toContain('red:before:T1')
  }
})

test('a carried proven red is not probed at all — and probing never cost an agent', async () => {
  const tasks = [redTask('T1', ['a'])]
  const fits = async (priorResults: any, n: number) =>
    !(await runCatching({ ...baseArgs, tasks, priorResults, maxAgents: n }, replies({ red: { before: 1, after: 0 } }))).threw
  const proven = { ...carriedAll(['T1']), red: [{ id: 'T1', command: 'pytest T1', verdict: 'red-green' }] }
  let probedMin = 0, provenMin = 0
  for (let n = 1; n <= 40 && !probedMin; n++) if (await fits(carriedAll(['T1']), n)) probedMin = n
  for (let n = 1; n <= 40 && !provenMin; n++) if (await fits(proven, n)) provenMin = n
  expect(probedMin).toBeGreaterThan(0)
  expect(probedMin).toBe(provenMin)
  const probed = await run({ ...baseArgs, tasks, priorResults: carriedAll(['T1']) }, replies({ red: { before: 1, after: 0 } }))
  const skipped = await run({ ...baseArgs, tasks, priorResults: proven }, replies({ red: { before: 1, after: 0 } }))
  expect(probed.scripted).toEqual(['red:before:T1', 'red:after:T1'])
  expect(skipped.scripted).toEqual([])
})

// ---------------------------------------------------------------- (11) red proof belongs to the current command

const oldRedProof = {
  id: 'T1', command: 'pytest T1', verdict: 'red-green',
  beforeExit: 1, afterExit: 0, beforeOutput: 'old failure', afterOutput: 'old pass',
}

test('carried red for a changed redCommand is re-probed', async () => {
  for (const before of [1, 0]) {
    const command = 'pytest T1-amended'
    const { scripted, order, prompts, result } = await run({
      ...baseArgs, tasks: [{ ...redTask('T1', ['a']), redCommand: command }],
      priorResults: { ...carriedAll(['T1']), red: [oldRedProof] },
    }, replies({ red: { before, after: 0 } }))
    expect(scripted.filter(l => l.startsWith('red:'))).toEqual(['red:before:T1', 'red:after:T1'])
    expect(order.indexOf('red:before:T1')).toBeLessThan(order.indexOf('implement:T1'))
    expect(order.indexOf('implement:T1')).toBeLessThan(order.indexOf('red:after:T1'))
    // A scripted command's "prompt" is the command line itself — the amended one, never the carried one.
    for (const label of ['red:before:T1', 'red:after:T1']) expect(prompts.get(label)).toBe(command)
    expect(result.red).toHaveLength(1)
    expect(result.red[0]).toMatchObject({ command, beforeExit: before, afterExit: 0,
      verdict: before === 0 ? 'red-not-red' : 'red-green' })
    expect(result.scoreTable.redCarried).toBe(0)
    expect(result.scoreTable.redProven).toBe(before === 0 ? 0 : 1)
    expect(result.overallPass).toBe(before !== 0)
    expect(result.tasksThatFlagged).toEqual(before === 0 ? ['T1'] : [])
  }
})

test('carried red with no command or a non-identical command is re-probed', async () => {
  for (const command of [undefined, 'pytest T1 ']) {
    const { scripted, result } = await run({
      ...baseArgs, tasks: [redTask('T1', ['a'])],
      priorResults: { ...carriedAll(['T1']), red: [{ ...oldRedProof, command }] },
    }, replies({ red: { before: 0, after: 0 } }))
    expect(scripted).toContain('red:before:T1')
    expect(scripted).toContain('red:after:T1')
    expect(result.red).toMatchObject([{ command: 'pytest T1', verdict: 'red-not-red' }])
    expect(result.scoreTable.redCarried).toBe(0)
    expect(result.overallPass).toBe(false)
  }
})

test('stale red proof for an inactive task is dropped and flags it as unproven', async () => {
  const tasks = [redTask('T1', ['a']), task({ id: 'T2', writablePaths: ['b'] })]
  for (const onlyTasks of [['T2'], []]) {
    const { dispatched, result } = await run({
      ...baseArgs, tasks, onlyTasks,
      priorResults: { ...carriedAll(['T1', 'T2']), red: [{ ...oldRedProof, command: 'pytest old' }] },
    }, replies())
    expect(dispatched.filter(l => l.startsWith('red:'))).toEqual([])
    expect(result.red).toEqual([])
    expect(result.scoreTable.redProven).toBe(0)
    expect(result.scoreTable.redUnproven).toBe(1)
    expect(result.scoreTable.redCarried).toBe(0)
    expect(result.tasksThatFlagged).toEqual(['T1'])
    expect(result.overallPass).toBe(false)
  }
})

test('stale red proof cannot skip the probe plan for a changed redCommand', async () => {
  // Probes cost no agent now, so the hazard moved from fan-out to the PLAN: a stale proof must not
  // drop the task from the red probes work-dispatch.sh runs before launch.
  const args = { ...baseArgs, tasks: [task({ redCommand: 'pytest new' })], priorResults: { ...carriedAll(['T1']), red: [oldRedProof] } }
  const { result: plan } = await run({ ...args, round: { plan: true } }, replies())
  expect(plan.stage).toBe('plan')
  expect(plan.checkPlan.red).toEqual([{ id: 'T1', command: 'pytest new' }])
  const { scripted, result } = await run(args, replies({ red: { before: 1, after: 0 } }))
  expect(scripted).toEqual(['red:before:T1', 'red:after:T1'])
  expect(result.scoreTable.redCarried).toBe(0)
})

test('red proof is not carried for a task whose redCommand was removed', async () => {
  const { result } = await run({
    ...baseArgs, tasks: [task({ id: 'T1', writablePaths: ['a'] }), redTask('T2', ['b'])], onlyTasks: ['T2'],
    priorResults: { ...carriedAll(['T1']), red: [{ ...oldRedProof, verdict: 'red-not-red' }] },
  }, replies())
  expect(result.red.map((r: any) => r.id)).toEqual(['T2'])
  expect(result.tasksThatFlagged).toEqual([])
  expect(result.overallPass).toBe(true)
})

// ---------------------------------------------------------------- (10) the refuter machinery is gone

test('the fan-out breakdown counts the lens as 1 and names no refuter term', async () => {
  const r = await runCatching({ ...baseArgs, tasks: one, maxAgents: 1 }, replies())
  expect(r.threw).toBe(true)
  expect(r.error.message).toContain('"lens":1')
  expect(r.error.message).not.toMatch(/refut/i)
  // implementers + verifiers + lens = 3 for a one-task run, so 3 fits and 2 does not.
  expect((await runCatching({ ...baseArgs, tasks: one, maxAgents: 3 }, replies())).threw).toBe(false)
  expect((await runCatching({ ...baseArgs, tasks: one, maxAgents: 2 }, replies())).threw).toBe(true)
})

test('no refuter keys survive in the return or the score table', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, carriedFindings: [{ id: 'C1', title: 't', severity: 'major', detail: 'd' }] },
    replies({ lens: { routes: [], findings: [], carried: [{ id: 'C1', status: 'closed', evidence: 'ran it' }] } }))
  expect('refuted' in result).toBe(false)
  for (const k of ['refuted', 'priorFindingsSubmitted', 'priorFindingsSurviving']) {
    expect(k in result.scoreTable, `scoreTable must not carry ${k}`).toBe(false)
  }
  // ...and the keys that replaced them are there.
  for (const k of ['carriedSubmitted', 'carriedOpen', 'routes', 'planFindings', 'lensMode']) {
    expect(k in result.scoreTable, `scoreTable must carry ${k}`).toBe(true)
  }
  for (const k of ['routes', 'planFindings', 'carried']) {
    expect(k in result, `the return must carry ${k}`).toBe(true)
  }
})

test('refuterRanker, refutersPerLens, refuterModel and refuterEffort are inert — no leg reads them', async () => {
  // They are not refused (an old caller's stale key must not cost a round); they simply do nothing.
  const { dispatched, result } = await run(
    { ...baseArgs, tasks: one, refuterRanker: 'coinflip', refutersPerLens: 99, refuterModel: 'opus', refuterEffort: 'xhigh' } as any,
    replies())
  expect(dispatched.filter(l => /refut|rank/i.test(l))).toEqual([])
  expect(result.overallPass).toBe(true)
})

test('lens schema requires carried rulings and the mode-specific channel, including a GREEN finding file', async () => {
  for (const red of [false, true]) {
    const opts = await dispatchOpts(
      { ...baseArgs, tasks: one, mechanicalChecks: [{ name: 'suite', cmd: 'bun test' }] },
      replies({ mech: { suite: { name: 'suite', exitCode: red ? 1 : 0, output: '' } } }))
    const schema = opts.get('lens').schema
    expect(schema.required).toEqual(['carried', red ? 'routes' : 'findings'])
    expect(schema.properties[red ? 'findings' : 'routes'].maxItems).toBe(0)
    expect(schema.properties.findings.items.required).toEqual(['title', 'severity', 'file', 'detail', 'ownerTask'])
    expect(schema.properties.routes.items.required).toEqual(['failure', 'ownerTask', 'cause', 'fix'])
    expect(schema.properties.carried.items.required).toEqual(['id', 'status', 'evidence'])
    expect(schema.properties.dispositions).toBeDefined()
  }
})

test('mechanical digest stamps the declared check name rather than the probe claim', async () => {
  const { result, prompts } = await run(
    { ...baseArgs, tasks: one, mechanicalChecks: [{ name: 'suite', cmd: 'bun test' }] },
    replies({ mech: { suite: { name: 'invented-name', exitCode: 7, output: 'failed assertion' } }, lens: routed('T1', 'suite') }))
  expect(result.mechanicalThatFailed.map((m: any) => m.name)).toEqual(['suite'])
  expect(prompts.get('lens')).toContain('### suite — exitCode 7')
  expect(prompts.get('lens')).not.toContain('invented-name')
})

// 'mechanical output preserves the last 60 lines rather than 2000 characters' moved with the leg:
// work-checks.sh tails every command's output, asserted in work-checks.test.ts.

test('zero-implementer round keeps carried task failures and missing red adjudications in the gate', async () => {
  const priorResults = carriedAll(['T1'])
  priorResults.verified[0].pass = false
  const failed = await run({ ...baseArgs, tasks: one, onlyTasks: [], priorResults }, replies())
  expect(failed.result.overallPass).toBe(false)
  expect(failed.result.tasksThatFlagged).toEqual(['T1'])
  expect(failed.result.scoreTable.lensMode).toBe('RED')
  const missingRed = await run({ ...baseArgs, tasks: [redTask('T1', ['a'])], onlyTasks: [],
    priorResults: carriedAll(['T1']) }, replies())
  expect(missingRed.result.overallPass).toBe(false)
  expect(missingRed.result.tasksThatFlagged).toEqual(['T1'])
  expect(missingRed.dispatched.filter((l: string) => l.startsWith('red:'))).toEqual([])
})

test('throwing lens fails closed even with the carried finding set frozen', async () => {
  for (const freezeFindingSet of [false, true]) {
    const reply = replies()
    const { result } = await run({ ...baseArgs, tasks: one, freezeFindingSet },
      (label: string, prompt: string, opts: any) => {
        if (label === 'lens') throw new Error('review failed')
        return reply(label, prompt, opts)
      })
    expect(result.overallPass).toBe(false)
    expect(result.lensesThatFlagged).toEqual(['lens'])
    expect(result.findings).toMatchObject([{ severity: 'critical', syntheticDeadLens: true }])
    expect(result.scoreTable.lensesReported).toBe(0)
  }
})

test('attempts run in the barrier before the lens', async () => {
  const args = { ...baseArgs, tasks: [task()], attempts: [{ key: 'k1', prompt: 'p', refs: [] }] }
  const { dispatched } = await run(args, replies())
  const kIndex = dispatched.indexOf('attempt:k1')
  const lIndex = dispatched.indexOf('lens')
  expect(kIndex).toBeGreaterThan(-1)
  expect(lIndex).toBeGreaterThan(kIndex)
})

test('an attempt prompt carries no lens refs and no task refs', async () => {
  const args = {
    ...baseArgs,
    tasks: [{ ...task(), refs: ['t.txt'] }],
    lens: { prompt: 'lp', refs: ['l.txt'] },
    attempts: [{ key: 'k1', prompt: 'ap', refs: ['a.txt'] }]
  }
  const { prompts, optsMap } = await run(args, replies())
  const ap = prompts.get('attempt:k1')
  const ao = optsMap.get('attempt:k1')
  expect(ap).toContain('ap')
  expect(ao.refs).toContain('a.txt')
  expect(ao.refs).not.toContain('t.txt')
  expect(ao.refs).not.toContain('l.txt')
  expect(ap).not.toContain('t.txt')
  expect(ap).not.toContain('l.txt')
})

test('attempt answers appear in the lens prompt', async () => {
  const args = { ...baseArgs, tasks: [task()], attempts: [{ key: 'k1', prompt: 'p', refs: [] }] }
  const rep = replies({ attempt: { k1: { key: 'k1', answer: 'my secret answer' } } })
  const { prompts } = await run(args, rep)
  const lp = prompts.get('lens')
  expect(lp).toContain('[Attempt k1]')
  expect(lp).toContain('my secret answer')
})

test('a dead attempt fails the gate with lensesThatFlagged lens', async () => {
  const args = { ...baseArgs, tasks: [task()], attempts: [{ key: 'k1', prompt: 'p', refs: [] }] }
  const rep = replies({ attempt: { k1: null } })
  const { result } = await run(args, rep)
  expect(result.overallPass).toBe(false)
  expect(result.lensesThatFlagged).toEqual(['lens'])
  expect(result.findings.some(f => f.syntheticDeadAttempt)).toBe(true)
})

test('a thrown attempt fails closed', async () => {
  const args = { ...baseArgs, tasks: [task()], attempts: [{ key: 'k1', prompt: 'p', refs: [] }] }
  const { result } = await run(args, (label, prompt, opts) => {
    if (label === 'attempt:k1') throw new Error('bang')
    return replies()(label, prompt, opts)
  })
  expect(result.overallPass).toBe(false)
  expect(result.lensesThatFlagged).toEqual(['lens'])
  expect(result.findings.some(f => f.syntheticDeadAttempt)).toBe(true)
})

test('a dead attempt gates under freezeFindingSet', async () => {
  const args = { ...baseArgs, tasks: [task()], freezeFindingSet: true, attempts: [{ key: 'k1', prompt: 'p', refs: [] }] }
  const rep = replies({ attempt: { k1: null } })
  const { result } = await run(args, rep)
  expect(result.overallPass).toBe(false)
  expect(result.lensesThatFlagged).toEqual(['lens'])
  expect(result.residue).toEqual([])
})

test('duplicate attempt keys throw', async () => {
  const args = { ...baseArgs, tasks: [task()], attempts: [{ key: 'k1', prompt: 'p', refs: [] }, { key: 'k1', prompt: 'p2', refs: [] }] }
  const { threw, error } = await runCatching(args, replies())
  expect(threw).toBe(true)
  expect(error.message).toMatch(/duplicate attempt key k1/)
})

test('fan-out counts attempts', async () => {
  const args = { ...baseArgs, tasks: [task()], attempts: [{ key: 'k1', prompt: 'p', refs: [] }, { key: 'k2', prompt: 'p', refs: [] }] }
  const { result } = await run(args, replies())
  expect(result.scoreTable.attempts.length).toBe(2)
  expect(result.scoreTable.attempts[0].reported).toBe(true)
})


// ---------------------------------------------------------------- rule checks
test('ruleChecks p at block-at fails the gate via rulesThatFailed', async () => {
  const stdout = JSON.stringify({ verdicts: [{ rule: 'R1', p: 0.85, verdict: 'fail' }], unavailable: [] })
  const { result } = await run(
    { ...baseArgs, tasks: one, ruleChecks: { name: 'rules', cmd: 'x', blockAt: 0.85 } },
    replies({ rules: { rules: { name: 'rules', exitCode: 0, stdout } } })
  )
  expect(result.overallPass).toBe(false)
  expect(result.rulesThatFailed).toEqual(['R1'])
  expect(result.ruleVerdicts).toEqual([{ rule: 'R1', p: 0.85, verdict: 'fail' }])
})

test('ruleChecks below block-at is advisory and passes', async () => {
  const stdout = JSON.stringify({ verdicts: [{ rule: 'R1', p: 0.84, verdict: 'warn' }], unavailable: [] })
  const { result } = await run(
    { ...baseArgs, tasks: one, ruleChecks: { name: 'rules', cmd: 'x', blockAt: 0.85 } },
    replies({ rules: { rules: { name: 'rules', exitCode: 0, stdout } } })
  )
  expect(result.overallPass).toBe(true)
  expect(result.rulesThatFailed).toEqual([])
  expect(result.ruleVerdicts).toEqual([{ rule: 'R1', p: 0.84, verdict: 'warn' }])
})

test('advisory rule checklist reaches the GREEN lens prompt ranked by p', async () => {
  const stdout = JSON.stringify({ verdicts: [
    { rule: 'R2', p: 0.5, verdict: 'ok' },
    { rule: 'R1', p: 0.84, verdict: 'warn' }
  ], unavailable: [] })
  const { prompts } = await run(
    { ...baseArgs, tasks: one, ruleChecks: { name: 'rules', cmd: 'x', blockAt: 0.85 } },
    replies({ rules: { rules: { name: 'rules', exitCode: 0, stdout } } })
  )
  const p = prompts.get('lens')
  expect(p).toContain('RULE CHECKLIST (advisory, ranked by p):')
  const idx1 = p.indexOf('R1: p=0.84')
  const idx2 = p.indexOf('R2: p=0.5')
  expect(idx1).toBeLessThan(idx2)
  expect(idx1).toBeGreaterThan(-1)
})

test('a dead rule-check runner fails closed', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, ruleChecks: { name: 'rules', cmd: 'x' } },
    replies({ rules: { rules: null } })
  )
  expect(result.overallPass).toBe(false)
  expect(result.rulesThatFailed).toEqual(['ruleChecks:rules'])
})

test('an unparsable rule-check line fails closed', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, ruleChecks: { name: 'rules', cmd: 'x' } },
    replies({ rules: { rules: { name: 'rules', exitCode: 0, stdout: 'not json' } } })
  )
  expect(result.overallPass).toBe(false)
  expect(result.rulesThatFailed).toEqual(['ruleChecks:rules'])
})

test('rulesThatFailed gates under freezeFindingSet', async () => {
  const stdout = JSON.stringify({ verdicts: [{ rule: 'R1', p: 0.85, verdict: 'fail' }], unavailable: [] })
  const { result } = await run(
    { ...baseArgs, tasks: one, freezeFindingSet: true, ruleChecks: { name: 'rules', cmd: 'x', blockAt: 0.85 } },
    replies({ rules: { rules: { name: 'rules', exitCode: 0, stdout } } })
  )
  expect(result.overallPass).toBe(false)
  expect(result.rulesThatFailed).toEqual(['R1'])
})

test('ruleChecks costs no agent: the shell runs it, so fan-out stays 3 under maxAgents 3', async () => {
  const r = await runCatching(
    { ...baseArgs, tasks: one, maxAgents: 3, ruleChecks: { name: 'rules', cmd: 'x' } },
    replies()
  )
  expect(r.threw).toBe(false)
  expect((r as any).fanOut.ruleChecks).toBeUndefined()
  expect((r as any).scripted).toContain('rules:rules')
  expect((r as any).workflowDispatched.filter((l: string) => l.startsWith('rules:'))).toEqual([])
  expect((r as any).checkPlan.rules).toEqual([{ name: 'rules', cmd: 'x' }])
})

test('a rules record work-checks.sh never wrote fails closed', async () => {
  const { result } = await run(
    { ...baseArgs, tasks: one, ruleChecks: { name: 'rules', cmd: 'x' } },
    replies(), undefined, { checks: { rules: [] } }
  )
  expect(result.overallPass).toBe(false)
  expect(result.rulesThatFailed).toEqual(['ruleChecks:rules'])
})

test('invalid blockAt throws', async () => {
  for (const bad of [-1, 0, 1.1, '0.5', null]) {
    const r = await runCatching({ ...baseArgs, tasks: one, ruleChecks: { name: 'rules', cmd: 'x', blockAt: bad } }, replies())
    expect(r.threw).toBe(true)
    expect(String(r.error)).toMatch(/blockAt must be a number in \(0,1\]/)
  }
})
