// Deterministic CI gate for the ds-grain-pause fixture.
// Compiles the REAL fixture PLAN.md and drives the compiled run.js with a STUBBED
// blocked-implementer that mirrors the live result the muni session observed
// (2026-06-26). Proves compiler + driver produce the R4 pause with the collision
// numbers in the payload — WITHOUT a live LLM (that flaky behavioral check lives
// in the fixture README and is run periodically, not in CI).
//
// Run:  node tests/ds-grain-pause.test.mjs
import { readFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

const ROOT = new URL('..', import.meta.url).pathname
const FIX = join(ROOT, 'tests/fixtures/ds-grain-pause')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

let PASS = 0, FAIL = 0
const ok = (n, c, x = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`) } else { FAIL++; console.log(`  ✗ ${n} ${x}`) } }

// 1. Compile the real fixture PLAN.md → run.js
const dir = mkdtempSync(join(tmpdir(), 'grain-'))
const runJs = join(dir, 'run.js')
execFileSync('uv', ['run', 'python3', join(ROOT, 'scripts/ds/ds_compile.py'),
  join(FIX, 'PLAN.md'), '--out', runJs, '--project', FIX], { stdio: 'pipe' })
const src = readFileSync(runJs, 'utf8').replace(/^export const meta/m, 'const meta')

console.log('compile the fixture plan')
{
  const tasks = JSON.parse(src.match(/const TASKS\s*=\s*(\[[\s\S]*?\])\nconst GLOBAL_CONSTRAINTS/)[1])
  ok('one task G1', tasks.length === 1 && tasks[0].id === 'G1', JSON.stringify(tasks.map(t => t.id)))
  ok('G1 engineer', tasks[0].kind === 'engineer')
  ok('Verify asserts grain uniqueness', /len\(keys\)==len\(set\(keys\)\)/.test(tasks[0].verify))
}

// Drive a compiled run.js with stubbed agent + gate. `source` lets us load a different
// compiled plan (the original pause plan vs the resolved +price plan).
async function run({ impl, gate = () => ({ exit0: false, outputsPresent: true, tail: 'grain not unique' }), args = { projectDir: FIX }, source = src }) {
  const trace = { implCalls: [], gateCalls: [] }
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || ''
    if (label.startsWith('gate:')) { trace.gateCalls.push(label.slice(5)); return { outputsPresent: true, tail: 'mock', ...gate(label.slice(5)) } }
    if (label.startsWith('task:')) { trace.implCalls.push(label.slice(5)); return impl(label.slice(5)) }
    return {}
  }
  const parallel = async (ts) => Promise.all(ts.map(t => t()))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', source)
  const result = await fn(agent, parallel, async () => {}, () => {}, () => {}, args, { total: null, spent: () => 0, remaining: () => Infinity })
  return { result, trace }
}

const blockedImpl = () => ({
  task: 'G1', status: 'blocked', outputsProduced: true, filesTouched: ['out/master.csv'],
  deviations: 'R4 ESCALATION — grain not unique on (cusip,event_ts): len(keys)=5 vs len(set(keys))=4; collision at (AAA, 2020-01-01T10:00:00) prices 100.0 and 101.0. Cannot satisfy both without dropping a row (forbidden by "no dedup") or changing the grain key. Human must decide: extend grain to cusip×event_ts×price, or treat one AAA row as an upstream data error.',
  summary: 'G1 (GRAIN-01): out/master.csv produced — 5 rows, 5 prints but only 4 unique (cusip,event_ts) pairs; collision at (AAA, 2020-01-01T10:00:00).',
})

console.log('blocked implementer → R4 pause with collision numbers (mirrors live run)')
{
  const { result, trace } = await run({ impl: blockedImpl })
  ok('implementer ran (G1)', trace.implCalls.includes('G1'))
  ok('did NOT silently pass — overallPass false', result.overallPass === false)
  ok('paused, pauseKind R4, atTask G1', result.returnReason === 'pause-human' && result.pauseKind === 'R4' && result.atTask === 'G1', JSON.stringify([result.returnReason, result.pauseKind, result.atTask]))
  // G1 is fresh (not [x], no reverifyDone/onlyChecks) → the pre-implement gate-first probe is now
  // SKIPPED entirely (a guaranteed miss on a fresh task is pure waste; run-core.js runTask doctrine
  // (1)). Implement runs straight away → blocked → return BEFORE the authoritative post-impl gate.
  // So ZERO gate calls for G1 (was 1 pre-check-only call before the pre-probe-skip fix).
  ok('no gate call reached for G1 (pre-probe skipped for a fresh task; blocked before post-impl gate)', trace.gateCalls.filter(g => g === 'G1').length === 0, `gateCalls=${JSON.stringify(trace.gateCalls)}`)
  ok('payload.deviations carries the collision count (5 vs 4)', /len\(keys\)=5/.test(result.payload.deviations) && /set\(keys\)\)=4/.test(result.payload.deviations), result.payload.deviations)
  ok('payload.summary carries the numbers', /5 rows/.test(result.payload.summary) && /4 unique/.test(result.payload.summary))
  ok('proposes +price tiebreaker WITHOUT applying (still blocked)', /event_ts×price|event_ts x price|\+price|×price/.test(result.payload.deviations))
  ok('G1 in tasksThatFailed', result.tasksThatFailed.includes('G1'))
}

// 3. Counter-case: an implementer that SILENTLY DEDUPED (the bug) would report
//    status:implemented + a passing gate — the test asserts our gate still fails it
//    because outputs disagree with "keep all 5". (Here the stubbed gate fails, modeling
//    the probe catching the lost print.)
console.log('counter-case: silent dedup must NOT pass the gate')
{
  const dedupImpl = () => ({ task: 'G1', status: 'implemented', outputsProduced: true, filesTouched: ['out/master.csv'], deviations: '', summary: 'deduped to 4 rows to satisfy grain' })
  const { result } = await run({ impl: dedupImpl })   // stubbed gate returns exit0:false
  ok('silent dedup fails the gate (not a false green)', result.overallPass === false && result.tasksThatFailed.includes('G1'))
}

// ── Resume protocol: the two kinds of R4 decision (resume-leg finding, 2026-06-26) ──

console.log('GATE-CHANGING decision injected WITHOUT editing Verify → implementer RE-BLOCKS (backstop)')
{
  // Leg A: decisions injected into the SAME (stale-gate) plan. The implementer honors the +price
  // grain in data but the Verify still checks (cusip,event_ts), so it correctly re-blocks rather
  // than reverting to a dedup. Stubbed to mirror that live behavior.
  const reblockImpl = () => ({
    task: 'G1', status: 'blocked', outputsProduced: true, filesTouched: ['out/master.csv'],
    deviations: 'Honored decision: grain cusip×event_ts×price, kept all 5. BUT Verify still asserts (cusip,event_ts): 5 rows, 4 unique (cusip,event_ts), 5 unique (cusip,event_ts,price). REQUIRED HUMAN ACTION: update the Verify assertion to (cusip,event_ts,price) and recompile. Refusing to dedup to satisfy the stale gate.',
    summary: 'G1: +price grain written, all 5 kept; stale Verify still on (cusip,event_ts).',
  })
  const { result } = await run({ impl: reblockImpl, args: { projectDir: FIX, decisions: { G1: 'extend grain to cusip×event_ts×price' } } })
  ok('re-blocks (does not silently pass a stale gate)', result.returnReason === 'pause-human' && result.pauseKind === 'R4')
  ok('deviations demand the Verify be updated', /update the Verify|Verify (still )?assert/i.test(result.payload.deviations), result.payload.deviations)
}

console.log('GATE-CHANGING decision baked into PLAN (RESOLVED variant) → resumes to gate-passing done')
{
  // Leg B: the decision is baked into the Verify (PLAN-resolved.md, +price grain) + recompiled.
  // Now the implementer produces a master that is genuinely unique on the new grain and the
  // authoritative gate passes.
  const resolvedRun = join(dir, 'run-resolved.js')
  execFileSync('uv', ['run', 'python3', join(ROOT, 'scripts/ds/ds_compile.py'),
    join(FIX, 'PLAN-resolved.md'), '--out', resolvedRun, '--project', FIX], { stdio: 'pipe' })
  const resolvedSrc = readFileSync(resolvedRun, 'utf8').replace(/^export const meta/m, 'const meta')
  const goodImpl = () => ({ task: 'G1', status: 'implemented', outputsProduced: true, filesTouched: ['out/master.csv'], deviations: 'None. All 5 rows unique on (cusip,event_ts,price); no dedup.', summary: 'G1: 5 rows, unique on +price grain.' })
  const { result } = await run({ impl: goodImpl, gate: () => ({ exit0: true, outputsPresent: true }), source: resolvedSrc, args: { projectDir: FIX, decisions: { G1: 'extend grain to cusip×event_ts×price' } } })
  ok('resolved plan: done + overallPass', result.returnReason === 'done' && result.overallPass === true, JSON.stringify([result.returnReason, result.overallPass]))
  ok('G1 not in tasksThatFailed', !result.tasksThatFailed.includes('G1'))
  ok('not paused (loop closes)', result.returnReason === 'done')
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
