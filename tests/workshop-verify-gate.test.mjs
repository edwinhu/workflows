// Regression tests for workshop-verify.js's null-guards and diagram-carry-forward gate (D-w-8 / #53),
// plus the consolidated per-slide reviewer (item 3 of the perf batch: 3 agents/slide -> 1).
// Static/extract-based like the sibling *-run-driver / *-engine-discover tests — no real agents spawned.
//
// Run:  node tests/workshop-verify-gate.test.mjs
import { execFileSync } from 'child_process'
import { mkdirSync, realpathSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const ROOT = new URL('..', import.meta.url).pathname
const AUTHENTICATOR = ROOT + 'scripts/workshop/workshop_plan_auth.py'
mkdirSync('/tmp/workshop-verify-receipt-test/.planning/.state', { recursive: true })
// workshop-verify compares every authenticated artifact path against a path built from
// projectReal, so the harness must speak in resolved paths too.
const TEST_ROOT = realpathSync('/tmp/workshop-verify-receipt-test')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let PASS = 0, FAIL = 0
const ok = (n, c, x = '') => { if (c) { PASS++ } else { FAIL++; console.log(`FAIL  ${n} ${x}`) } }

const verSrc = readFileSync(ROOT + 'workflows/workshop-verify.js', 'utf8').replace(/^export const meta/m, 'const meta')
const PLAN_BYTES = '# workshop generated plan\n'
const PLAN_HASH = createHash('sha256').update(PLAN_BYTES).digest('hex')
writeFileSync(`${TEST_ROOT}/.planning/workshop-generated.md`, PLAN_BYTES)
writeFileSync(`${TEST_ROOT}/.planning/.state/review.json`, JSON.stringify({ workflow: 'workshop', plan_file: 'workshop-generated.md', plan_hash: PLAN_HASH, approved_session_id: 'approval', approved_at: '2026-07-30T10:00:00.000Z', status: 'APPROVED', reviewer_session_id: 'review', reviewed_at: '2026-07-30T11:00:00.000Z' }))
const INDEX = { ok: true, planPath: '/p/.planning/workshop-generated.md', planFile: 'workshop-generated.md', planHash: PLAN_HASH, reviewStatePath: '/p/.planning/.state/review.json', receipt: { workflow: 'workshop', plan_file: 'workshop-generated.md', plan_hash: PLAN_HASH, status: 'APPROVED' }, reviewStatus: 'APPROVED', violations: [], slides: [{ num: 1 }], sourcesInventory: [], groupOrder: [], sectionOrder: [] }

async function exec(src, { args, onAgent }) {
  const trace = { labels: [], prompts: {} }
  const agent = async (prompt, opts = {}) => {
    const l = opts.label || ''
    trace.labels.push(l); trace.prompts[l] = prompt
    return onAgent(l, prompt, opts)
  }
  const parallel = async (thunks) => Promise.all(thunks.map(t => t()))
  const pipeline = async () => { throw new Error('pipeline unused') }
  const log = () => {}, phase = () => {}
  // `process`, `Buffer`, `require`, `module`, and `exports` are declared as trailing
  // parameters so they are `undefined` inside the script — matching the Workflow runtime,
  // which exposes none of them.
  const fn = new AsyncFunction(
    'agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget',
    'process', 'Buffer', 'require', 'module', 'exports',
    src,
  )
  let result, error
  const portable = JSON.parse(JSON.stringify(args).replaceAll('/p', TEST_ROOT))
  const fallback = JSON.parse(JSON.stringify(INDEX).replaceAll('/p', TEST_ROOT))
  // The deterministic authenticate pre-step the workshop skill now runs before dispatch:
  // it snapshots the receipt + receipt-selected plan under TOCTOU discipline and hands the
  // bundle to the workflow, which cannot open a file itself.
  const bundle = JSON.parse(execFileSync('python3', [AUTHENTICATOR, '--authenticate', TEST_ROOT], { encoding: 'utf8' }))
  const normalized = {
    ...portable,
    slideIndex: portable.slideIndex || fallback,
    planPath: portable.planPath || (portable.slideIndex || fallback).planPath,
    planHash: portable.planHash || (portable.slideIndex || fallback).planHash,
    projectReal: bundle.projectReal, artifacts: bundle.artifacts,
  }
  try {
    result = await fn(
      agent, parallel, pipeline, log, phase, normalized,
      { total: null, spent: () => 0, remaining: () => Infinity },
      undefined, undefined, undefined, undefined, undefined,
    )
  } catch (e) { error = e }
  return { result, error, trace }
}

console.log('null-guard: Discover returns null → clear error, no crash on disc.slides')
{
  const { error } = await exec(verSrc, { args: { projectDir: '/p' }, onAgent: (label) => label === 'discover' ? null : {} })
  ok('throws a named error rather than a TypeError on null.slides', !!error && /Discover agent returned null/.test(error.message), error && error.message)
}

console.log('null-guard: Mechanical returns null → synthesized critical short-circuit, no crash')
{
  const onAgent = (label) => {
    if (label === 'discover') return {
      presentationDir: '/p/presentation', slidesPath: '/p/s.typ', notesPath: '/p/n.typ', sourcesPath: '/p/.planning/SOURCES.md',
      checkAllPath: '/c.py', detectWidowsPath: '', lookAtPath: '',
      slides: [{ id: 'S1', title: 'T', inventoryRefs: [] }], diagrams: [],
    }
    if (label === 'mechanical') return null
    return {}
  }
  const { result, error } = await exec(verSrc, { args: { projectDir: '/p' }, onAgent })
  ok('no crash (error undefined)', !error, error && error.message)
  ok('overallPass false', result && result.overallPass === false)
  ok('verdict ISSUES FOUND', result && result.verdict === 'ISSUES FOUND')
  ok('exactly one synthesized critical finding', result && result.findings.length === 1 && result.findings[0].severity === 'critical', JSON.stringify(result && result.findings))
}

console.log('ONLY set + diagram belongs to an ONLY-targeted slide → diagram review RUNS (not skipped)')
{
  const onAgent = (label) => {
    if (label === 'discover') return {
      presentationDir: '/p/presentation', slidesPath: '/p/s.typ', notesPath: '/p/n.typ', sourcesPath: '/p/.planning/SOURCES.md',
      checkAllPath: '/c.py', detectWidowsPath: '', lookAtPath: '/l.py',
      slides: [{ id: 'S1', title: 'Diagram slide', inventoryRefs: [] }, { id: 'S2', title: 'Other slide', inventoryRefs: [] }],
      diagrams: [{ id: 'D1', slideTitle: 'Diagram slide', kind: 'cetz' }],
    }
    if (label === 'mechanical') return { slidesCompiled: true, notesCompiled: true, compileErrors: [], constraintsPassed: true, constraintFailures: [], widows: 0, overflow: 0 }
    if (label === 'S1:review') return { slide: 'S1', itemsChecked: 1, notesSectionFound: true, claimsChecked: 0, claimsGrounded: 0, findings: [] }
    if (label === 'D1:visual') return { diagram: 'D1', defectsFound: 0, findings: [] }
    return {}
  }
  const priorS2 = { slide: 'S2', title: 'Other slide', findings: [], notesSectionFound: true, claimsChecked: 0, claimsGrounded: 0 }
  const { result, trace } = await exec(verSrc, { args: { projectDir: '/p', onlyChecks: ['S1'], priorReviews: [priorS2] }, onAgent })
  ok('diagram review ran for the ONLY-targeted slide\'s diagram', trace.labels.includes('D1:visual'), JSON.stringify(trace.labels))
  ok('scoreTable Visual row is NOT the carry-forward skip text (a real review ran)', !/skipped \(carry-forward/.test(result.scoreTable), result.scoreTable)
  ok('overallPass true (clean)', result.overallPass === true)
}

console.log('ONLY set + diagrams exist but NONE belong to an ONLY-targeted slide → Visual reported skipped (carry-forward), never silently passed')
{
  const onAgent = (label) => {
    if (label === 'discover') return {
      presentationDir: '/p/presentation', slidesPath: '/p/s.typ', notesPath: '/p/n.typ', sourcesPath: '/p/.planning/SOURCES.md',
      checkAllPath: '/c.py', detectWidowsPath: '', lookAtPath: '/l.py',
      slides: [{ id: 'S1', title: 'Text-only slide', inventoryRefs: [] }, { id: 'S2', title: 'Diagram slide', inventoryRefs: [] }],
      diagrams: [{ id: 'D1', slideTitle: 'Diagram slide', kind: 'cetz' }],
    }
    if (label === 'mechanical') return { slidesCompiled: true, notesCompiled: true, compileErrors: [], constraintsPassed: true, constraintFailures: [], widows: 0, overflow: 0 }
    if (label === 'S1:review') return { slide: 'S1', itemsChecked: 1, notesSectionFound: true, claimsChecked: 0, claimsGrounded: 0, findings: [] }
    return {}
  }
  const priorS2 = { slide: 'S2', title: 'Diagram slide', findings: [], notesSectionFound: true, claimsChecked: 0, claimsGrounded: 0 }
  const { result, trace } = await exec(verSrc, { args: { projectDir: '/p', onlyChecks: ['S1'], priorReviews: [priorS2] }, onAgent })
  ok('no visual agent ran (D1 belongs to a carried, non-ONLY slide)', !trace.labels.includes('D1:visual'), JSON.stringify(trace.labels))
  ok('scoreTable reports skipped (carry-forward), not a false pass', /skipped \(carry-forward/.test(result.scoreTable), result.scoreTable)
  ok('overallPass unaffected by the carried skip (substrate still clean)', result.overallPass === true)
}

console.log(`\n${PASS}/${PASS + FAIL} passed` + (FAIL ? `  (${FAIL} FAILED)` : ''))
// EXIT ONLY ON FAILURE. `process.exit(0)` here is not a no-op: under `bun test tests/*.test.mjs`
// every file shares ONE process, so a success-path exit TERMINATES THE RUN — bun reports exit 0
// and the remaining files never execute. Measured: this file's exit ended the run after 12 of 27
// files, masking a genuine failure in `implementer-identity-contract` and skipping 15 suites.
if (FAIL) process.exit(1)
