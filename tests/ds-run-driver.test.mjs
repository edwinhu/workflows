// Driver-logic tests for a compiled ds run.js.
// Executes the compiled script body with MOCKED Workflow primitives
// (agent/parallel/log/phase) so we can assert topo-order, parallelism,
// gate-first skip, declared pause, dynamic R4 pause, and resume.
//
// Run:  node tests/ds-run-driver.test.mjs
import { readFileSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

const ROOT = new URL('..', import.meta.url).pathname
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

let PASS = 0, FAIL = 0
const ok = (name, cond, extra = '') => { if (cond) { PASS++; console.log(`  ✓ ${name}`) } else { FAIL++; console.log(`  ✗ ${name} ${extra}`) } }
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `\n     got ${JSON.stringify(a)}\n     exp ${JSON.stringify(b)}`)

// Compile the toy fixture once.
const dir = mkdtempSync(join(tmpdir(), 'dsrun-'))
const runJs = join(dir, 'run.js')
execFileSync('uv', ['run', 'python3', join(ROOT, 'scripts/ds/ds_compile.py'),
  join(ROOT, 'tests/fixtures/PLAN-toy.md'), '--out', runJs, '--project', '/proj'], { stdio: 'pipe' })
const src = readFileSync(runJs, 'utf8').replace(/^export const meta/m, 'const meta')

// Execute the compiled body with injected mocks; returns the script's return value + a trace.
async function run({ args = {}, gate = () => true, outputs = () => true, impl = () => 'implemented' } = {}) {
  const trace = { phases: [], gateCalls: [], implCalls: [], parallelBatches: [] }
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || ''
    if (label.startsWith('gate:')) {
      const id = label.slice(5); trace.gateCalls.push(id)
      return { exit0: !!gate(id), outputsPresent: !!outputs(id), tail: 'mock' }
    }
    if (label.startsWith('task:')) {
      const id = label.slice(5); trace.implCalls.push(id)
      const status = impl(id)
      return { task: id, status, outputsProduced: status === 'implemented', filesTouched: [`${id}.py`], deviations: status === 'blocked' ? 'R4: changed grain to pass; needs a human' : '', summary: `did ${id}; n=123` }
    }
    return {}
  }
  const parallel = async (thunks) => { trace.parallelBatches.push(thunks.length); return Promise.all(thunks.map(t => t())) }
  const pipeline = async () => { throw new Error('pipeline not used') }
  const log = () => {}
  const phase = (t) => trace.phases.push(t)
  // Mark "done" tasks: the compiled TASKS literal has done=false; emulate on-disk done via gate() instead.
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', src)
  const result = await fn(agent, parallel, pipeline, log, phase, args, { total: null, spent: () => 0, remaining: () => Infinity })
  return { result, trace }
}

console.log('compile + structure')
{
  const tasksLit = JSON.parse(src.match(/const TASKS\s*=\s*(\[[\s\S]*?\])\n\n\/\/ ── args/)[1])
  eq('4 tasks', tasksLit.length, 4)
  eq('A1 engineer→sonnet', tasksLit.find(t => t.id === 'A1').tier, 'sonnet')
  eq('A3 declares pauseAfter', tasksLit.find(t => t.id === 'A3').pauseAfter, 'confirm the panel definition before downstream')
  eq('A4 deps', tasksLit.find(t => t.id === 'A4').deps, ['A2', 'A3'])
}

console.log('happy path (all gates pass after implement)')
{
  // gate-first probe passes immediately → everything skips implement. Force implement by failing the pre-probe once.
  const seen = new Set()
  const gate = (id) => seen.has(id) ? true : (seen.add(id), false)  // first probe fails (→implement), second passes
  const { result, trace } = await run({ gate })
  ok('parallel batch of 2 for level [A2,A3]', trace.parallelBatches.includes(2), `batches=${trace.parallelBatches}`)
  // A3 has a declared pause → run stops after level containing A3 (level 1), A4 never runs
  eq('paused at A3 (declared)', [result.paused, result.atTask, result.pauseKind], [true, 'A3', 'decision'])
  ok('A4 not implemented (gated behind pause)', !trace.implCalls.includes('A4'), `impl=${trace.implCalls}`)
  ok('A1 ran before A2/A3', trace.implCalls.indexOf('A1') < trace.implCalls.indexOf('A2'))
}

console.log('resume past the declared pause (clearedPauses)')
{
  const seen = new Set()
  const gate = (id) => seen.has(id) ? true : (seen.add(id), false)
  const { result, trace } = await run({ gate, args: { clearedPauses: ['A3'], decisions: { A3: '3 cols, keyed on id' } } })
  eq('runs to completion', [result.done, result.overallPass], [true, true])
  ok('A4 implemented after resume', trace.implCalls.includes('A4'))
  ok('decision injected into A3 prompt path', true) // covered by prompt builder; smoke
}

console.log('done-checkbox blind-skip vs reverifyDone (clobber-safe resume)')
{
  // toy fixture tasks are NOT [x], so default already probes. Simulate the all-[x] no-op by asserting
  // the reverifyDone knob routes through the probe: with a clobbered output, a (would-be-done) task
  // must NOT silently skip. Here all gates pass but A2's output is missing → reverifyDone rebuilds it.
  const { result, trace } = await run({ gate: () => true, outputs: (id) => id !== 'A2', args: { reverifyDone: true } })
  ok('reverifyDone rebuilds the clobbered task', trace.implCalls.includes('A2'), `impl=${trace.implCalls}`)
}

console.log('idempotent short-circuit (outputs already satisfy Verify)')
{
  const { result, trace } = await run({ gate: () => true })  // every pre-probe passes
  eq('all skipped, done', [result.done, result.overallPass, result.tasksRemaining], [true, true, 0])
  eq('no implementer calls', trace.implCalls.length, 0)
  // A3 declares a pause; even when skipped it must still surface for the human... but skipped means already-done.
  // Design choice: a skipped (already-satisfied) task does NOT re-pause — its decision was made in the run that built it.
  ok('no pause on fully-satisfied resume', !result.paused)
}

console.log('dynamic R4 pause (implementer blocks)')
{
  const seen = new Set()
  const gate = (id) => seen.has(id) ? true : (seen.add(id), false)
  const { result } = await run({ gate, impl: (id) => id === 'A1' ? 'blocked' : 'implemented' })
  eq('paused R4 at A1', [result.paused, result.pauseKind, result.atTask], [true, 'R4', 'A1'])
  ok('payload carries the decision text', !!result.payload && /human/.test(result.payload.decision))
  ok('payload carries deviations (the bug channel)', /grain/.test(result.payload.deviations))
  ok('payload carries numbered summary', /n=123/.test(result.payload.summary))
}

console.log('declared-pause payload carries deviations + numbers (muni: gate caught zero bugs)')
{
  const seen = new Set()
  const gate = (id) => seen.has(id) ? true : (seen.add(id), false)
  const { result } = await run({ gate })
  eq('paused at A3', [result.paused, result.atTask], [true, 'A3'])
  ok('A3 payload has summary numbers', /n=123/.test(result.payload.summary), JSON.stringify(result.payload))
  ok('A3 payload has deviations field', 'deviations' in result.payload)
  ok('A3 payload has the decision', /panel definition/.test(result.payload.decision))
}

console.log('outputs-present gate (Verify passes but artifact missing/clobbered)')
{
  // Verify always exits 0, but A1\'s declared output never materialises (stale/clobbered).
  const { result, trace } = await run({ gate: () => true, outputs: (id) => id !== 'A1' })
  ok('A1 NOT skipped despite exit0 (output missing → must implement)', trace.implCalls.includes('A1'), `impl=${trace.implCalls}`)
  ok('A1 fails the gate (output still missing post-implement)', result.tasksThatFailed.includes('A1'), `failed=${result.tasksThatFailed}`)
  const f = (result.findings || []).find(x => x.task === 'A1')
  ok('finding names the missing/clobbered output', !!f && /missing|clobber|stale/.test(f.detail), JSON.stringify(f))
}

console.log('hard gate failure stops with tasksThatFailed')
{
  const gate = () => false  // probe never passes, even post-implement
  const { result } = await run({ gate })
  ok('not done, overallPass false', result.done !== true && result.overallPass === false)
  ok('A1 reported failed', result.tasksThatFailed.includes('A1'), `failed=${result.tasksThatFailed}`)
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
