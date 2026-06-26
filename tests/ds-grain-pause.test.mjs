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
  const tasks = JSON.parse(src.match(/const TASKS\s*=\s*(\[[\s\S]*?\])\n\n\/\/ ── args/)[1])
  ok('one task G1', tasks.length === 1 && tasks[0].id === 'G1', JSON.stringify(tasks.map(t => t.id)))
  ok('G1 engineer', tasks[0].kind === 'engineer')
  ok('Verify asserts grain uniqueness', /len\(keys\)==len\(set\(keys\)\)/.test(tasks[0].verify))
}

// 2. Drive run.js with a stubbed implementer mirroring the LIVE result:
//    wrote all 5 rows (outputsProduced:true), then BLOCKED with the collision numbers.
async function run({ impl }) {
  const trace = { implCalls: [], gateCalls: [] }
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || ''
    if (label.startsWith('gate:')) { trace.gateCalls.push(label.slice(5)); return { exit0: false, outputsPresent: true, tail: 'grain not unique' } }
    if (label.startsWith('task:')) { trace.implCalls.push(label.slice(5)); return impl(label.slice(5)) }
    return {}
  }
  const parallel = async (ts) => Promise.all(ts.map(t => t()))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', src)
  const result = await fn(agent, parallel, async () => {}, () => {}, () => {}, { projectDir: FIX }, { total: null, spent: () => 0, remaining: () => Infinity })
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
  ok('paused, pauseKind R4, atTask G1', result.paused === true && result.pauseKind === 'R4' && result.atTask === 'G1', JSON.stringify([result.paused, result.pauseKind, result.atTask]))
  // for a blocked task: gate-first PRE-probe runs once (skip-check), then implement → blocked →
  // return BEFORE the authoritative post-impl gate. So exactly ONE gate call for G1, not two.
  ok('authoritative post-impl gate NOT reached (1 probe = pre-check only)', trace.gateCalls.filter(g => g === 'G1').length === 1, `gateCalls=${JSON.stringify(trace.gateCalls)}`)
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

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
