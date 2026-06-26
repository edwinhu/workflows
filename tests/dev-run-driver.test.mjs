// Driver-logic tests for a compiled dev run.js.
// Executes the compiled script body with MOCKED Workflow primitives so we can assert
// topo-order, SEQUENTIAL-within-level (not parallel), gate-first TDD skip, declared pause,
// dynamic R4 (architectural) pause, resume, the hybrid full-suite checkpoint, and the
// testPresent (fake/missing test) gate.
//
// Run:  node tests/dev-run-driver.test.mjs
import { readFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

const ROOT = new URL('..', import.meta.url).pathname
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

let PASS = 0, FAIL = 0
const ok = (name, cond, extra = '') => { if (cond) { PASS++; console.log(`  ✓ ${name}`) } else { FAIL++; console.log(`  ✗ ${name} ${extra}`) } }
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `\n     got ${JSON.stringify(a)}\n     exp ${JSON.stringify(b)}`)

// Compile the toy fixture once.
const dir = mkdtempSync(join(tmpdir(), 'devrun-'))
const runJs = join(dir, 'run.js')
execFileSync('uv', ['run', 'python3', join(ROOT, 'scripts/dev/dev_compile.py'),
  join(ROOT, 'tests/fixtures/dev-PLAN-toy.md'), '--out', runJs, '--project', '/proj'], { stdio: 'pipe' })
const src = readFileSync(runJs, 'utf8').replace(/^export const meta/m, 'const meta')

// Execute the compiled body with injected mocks; returns the script's return value + a trace.
// `parallel` THROWS — the dev driver must NOT use it (sequential-within-level invariant).
async function run({ args = {}, gate = () => true, files = () => true, test = () => true, impl = () => 'implemented' } = {}) {
  const trace = { phases: [], gateCalls: [], implCalls: [], implPrompts: {}, usedParallel: false }
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || ''
    if (label.startsWith('gate:')) {
      const id = label.slice(5); trace.gateCalls.push(id)
      return { exit0: !!gate(id), filesPresent: !!files(id), testPresent: !!test(id), tail: 'mock' }
    }
    if (label.startsWith('task:')) {
      const id = label.slice(5); trace.implCalls.push(id); trace.implPrompts[id] = prompt
      const status = impl(id)
      return { task: id, status, testWritten: status === 'implemented', verifyPassed: status === 'implemented', verifyOutput: 'mock tail', filesTouched: [`${id}.ts`], deviations: status === 'blocked' ? 'R4 architectural: needs a new service / breaking API change; a human must decide' : '', summary: `did ${id}; 12 passed / 0 failed` }
    }
    return {}
  }
  const parallel = async (thunks) => { trace.usedParallel = true; return Promise.all(thunks.map(t => t())) }
  const pipeline = async () => { throw new Error('pipeline not used') }
  const log = () => {}
  const phase = (t) => trace.phases.push(t)
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', src)
  const result = await fn(agent, parallel, pipeline, log, phase, args, { total: null, spent: () => 0, remaining: () => Infinity })
  return { result, trace }
}

// first probe fails (→ forces implement), later probes for the same id pass (→ gate passes)
const redThenGreen = () => { const seen = new Set(); return (id) => seen.has(id) ? true : (seen.add(id), false) }

console.log('compile + structure')
{
  const tasksLit = JSON.parse(src.match(/const TASKS\s*=\s*(\[[\s\S]*?\])\nconst GLOBAL_CONSTRAINTS/)[1])
  eq('4 tasks', tasksLit.length, 4)
  eq('no tier field (dev inherits session model)', tasksLit.some(t => 'tier' in t), false)
  eq('task1 N/A failing test', tasksLit.find(t => t.id === '1').failingTest.toLowerCase().startsWith('n/a'), true)
  eq('task3 declares pauseAfter', tasksLit.find(t => t.id === '3').pauseAfter, 'confirm the API shape before downstream')
  eq('task4 deps fan-in', tasksLit.find(t => t.id === '4').deps, ['2', '3'])
  eq('task2 interface block carried', tasksLit.find(t => t.id === '2').interfaces.includes('validate(req)'), true)
  ok('GLOBAL_CONSTRAINTS inlined', /const GLOBAL_CONSTRAINTS = "- CON-1/.test(src))
}

console.log('SEQUENTIAL within level (must NOT call parallel())')
{
  const { trace } = await run({ gate: redThenGreen(), args: { clearedPauses: ['3'], clearedFullSuite: [1], decisions: { 3: 'shape ok' } } })
  ok('parallel() never used', trace.usedParallel === false)
  ok('task1 ran before 2 and 3', trace.implCalls.indexOf('1') < trace.implCalls.indexOf('2') && trace.implCalls.indexOf('1') < trace.implCalls.indexOf('3'))
}

console.log('global constraints + interfaces injected into implementer prompt')
{
  const { trace } = await run({ gate: redThenGreen(), args: { clearedPauses: ['3'], clearedFullSuite: [1], decisions: { 3: 'ok' } } })
  ok('task2 prompt carries GLOBAL CONSTRAINTS', /GLOBAL CONSTRAINTS/.test(trace.implPrompts['2']) && /CON-1/.test(trace.implPrompts['2']))
  ok('task2 prompt carries its INTERFACES', /INTERFACES/.test(trace.implPrompts['2']) && /validate\(req\)/.test(trace.implPrompts['2']))
  ok('task1 (N/A) prompt has the no-test branch', /Failing Test = N\/A|types-only\/meta/.test(trace.implPrompts['1']))
  ok('task2 prompt has TDD RED-first + no-phantom-RED', /see it RED/.test(trace.implPrompts['2']) && /fixture\/type bug/.test(trace.implPrompts['2']))
}

console.log('declared pause at task 3 (TDD: RED→GREEN forces implement, then pause)')
{
  const { result, trace } = await run({ gate: redThenGreen() })
  eq('paused at 3 (declared)', [result.paused, result.atTask, result.pauseKind], [true, '3', 'decision'])
  ok('task4 not implemented (gated behind pause)', !trace.implCalls.includes('4'), `impl=${trace.implCalls}`)
  ok('payload carries numbered summary', /12 passed/.test(result.payload.summary), JSON.stringify(result.payload))
  ok('payload carries the decision', /API shape/.test(result.payload.decision))
}

console.log('resume past declared pause → hybrid full-suite checkpoint at level 1 (cross-level overlap on src/types.ts)')
{
  const { result } = await run({ gate: redThenGreen(), args: { clearedPauses: ['3'], decisions: { 3: 'ok' } } })
  eq('paused fullsuite at level 1', [result.paused, result.pauseKind, result.atLevel], [true, 'fullsuite', 1])
  ok('fullsuite payload names the overlap level', /full test suite/.test(result.payload.decision))
}

console.log('resume past fullsuite checkpoint (clearedFullSuite) → completion')
{
  const { result, trace } = await run({ gate: redThenGreen(), args: { clearedPauses: ['3'], clearedFullSuite: [1], decisions: { 3: 'ok' } } })
  eq('runs to completion', [result.done, result.overallPass, result.tasksRemaining], [true, true, 0])
  ok('task4 implemented after both resumes', trace.implCalls.includes('4'))
  ok('decision injected into task3 prompt', /HUMAN DECISION/.test(trace.implPrompts['3'] || ''))
}

console.log('idempotent short-circuit (all probes pass first try → skip every implementer)')
{
  const { result, trace } = await run({ gate: () => true })
  eq('all skipped, done', [result.done, result.overallPass, result.tasksRemaining], [true, true, 0])
  eq('no implementer calls', trace.implCalls.length, 0)
  ok('no pause on fully-satisfied resume', !result.paused)
}

console.log('dynamic R4 architectural pause (implementer blocks)')
{
  const { result } = await run({ gate: redThenGreen(), impl: (id) => id === '1' ? 'blocked' : 'implemented' })
  eq('paused R4 at 1', [result.paused, result.pauseKind, result.atTask], [true, 'R4', '1'])
  ok('payload carries deviations (the bug channel)', /architectural/.test(result.payload.deviations))
  ok('payload carries numbered summary', /12 passed/.test(result.payload.summary))
}

console.log('testPresent gate: Verify exits 0 but the failing test is missing/faked → must NOT pass')
{
  // every Verify exits 0 and files present, but task 2 has NO real test in the tree.
  const { result, trace } = await run({ gate: redThenGreen(), files: () => true, test: (id) => id !== '2' })
  ok('task2 NOT skipped despite exit0 (test missing → implement)', trace.implCalls.includes('2'), `impl=${trace.implCalls}`)
  ok('task2 fails the gate (test still missing post-implement)', result.tasksThatFailed.includes('2'), `failed=${result.tasksThatFailed}`)
  const f = (result.findings || []).find(x => x.task === '2')
  ok('finding names the missing/faked test', !!f && /test (not present|missing|fake)/i.test(f.detail), JSON.stringify(f))
}

console.log('filesPresent gate: Verify exits 0 but a declared file is missing → must NOT pass')
{
  const { result, trace } = await run({ gate: redThenGreen(), files: (id) => id !== '1', test: () => true })
  ok('task1 NOT skipped (file missing → implement)', trace.implCalls.includes('1'))
  ok('task1 fails the gate', result.tasksThatFailed.includes('1'), `failed=${result.tasksThatFailed}`)
}

console.log('hard gate failure stops with tasksThatFailed')
{
  const { result } = await run({ gate: () => false })  // probe never passes
  ok('not done, overallPass false', result.done !== true && result.overallPass === false)
  ok('task1 reported failed', result.tasksThatFailed.includes('1'), `failed=${result.tasksThatFailed}`)
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
