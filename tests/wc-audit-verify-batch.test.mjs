// Regression tests for workflow-creator-verify.js's Phase 3 Verify batching (item 2 of the perf batch: one verifier
// agent per architecture cluster re-checks ALL of that cluster's flagged gaps in one context, instead
// of one agent per gap). Executes workflow-creator-verify.js with MOCKED Workflow primitives — static/extract-based
// like the sibling *-run-driver / *-engine-discover tests, no real agents spawned.
//
// Asserts:
//   (a) with onlyChecks set, gapsToVerify is populated for the LIVE (re-audited) clusters only, and
//       exactly one verify agent is dispatched PER CLUSTER (not per gap).
//   (b) verifier corrections are written back into the returned reviews records (not just scoreById).
//   (c) the P22-P30 (runner-architecture) principle-id labeling survives a selective re-audit unchanged.
//
// Run:  node tests/wc-audit-verify-batch.test.mjs
import { readFileSync } from 'fs'

const ROOT = new URL('..', import.meta.url).pathname
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let PASS = 0, FAIL = 0
const ok = (n, c, x = '') => { if (c) { PASS++ } else { FAIL++; console.log(`FAIL  ${n} ${x}`) } }

const src = readFileSync(ROOT + 'workflows/workflow-creator-verify.js', 'utf8').replace(/^export const meta/m, 'const meta')

async function exec(args, onAgent) {
  const trace = { labels: [], prompts: {} }
  const agent = async (prompt, opts = {}) => {
    const l = opts.label || ''
    trace.labels.push(l); trace.prompts[l] = prompt
    return onAgent(l, prompt, opts)
  }
  const parallel = async (thunks) => Promise.all(thunks.map(t => t()))
  const pipeline = async () => { throw new Error('pipeline unused') }
  const log = () => {}, phase = () => {}
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', src)
  const result = await fn(agent, parallel, pipeline, log, phase, args, { total: null, spent: () => 0, remaining: () => Infinity })
  return { result, trace }
}

// A flat "everything scores 10, no gaps" principle-list helper for the dims we carry forward untouched.
const clean = (ids) => ids.map(id => ({ id, score: 10, evidence: `ok:${id}`, gap: '', domainCeiling: false }))

const PRIOR = [
  { dimension: 'arch-verify-review', principles: clean(['P04', 'P05', 'P10', 'P17']), findings: [] },
  { dimension: 'arch-skill-family', principles: clean(['P06', 'P07', 'P08', 'P20', 'P21']), findings: [] },
  { dimension: 'arch-state-traceability', principles: clean(['P11', 'P12', 'P13', 'P15', 'P16', 'P18', 'P19', 'P19b']), findings: [] },
  { dimension: 'enforcement-checklist', patterns: [{ pattern: 'Iron Laws', status: 'Present', weakOrAbsentPhases: [], note: '' }], findings: [] },
  { dimension: 'path-portability', status: 'Clean', violations: [], hookCommandViolations: [], contentPluginRootViolations: [], findings: [] },
  { dimension: 'candidacy-scan', candidates: [], summary: 'no ultracode-workflow candidates' },
  { dimension: 'runner-architecture', executionClass: 'compiled-runner', applicable: true, principles: clean(['P22', 'P23', 'P24', 'P25', 'P26', 'P27', 'P28', 'P29', 'P30']), findings: [] },
]

const discoverMock = {
  isMetaTool: false, wcSkillPath: '/wf/skills/workflow-creator/SKILL.md',
  enforcementChecklistPath: '/wf/references/enforcement-checklist.md', migrationPlaybookPath: '',
  skillFiles: [{ path: '/p/skills/test-target/SKILL.md', role: 'entry' }],
  phases: ['discover', 'review', 'gate'],
}

console.log('(a) onlyChecks scopes gapsToVerify + verify agents to the LIVE cluster only')
{
  // arch-decomp-gates re-audited live with ONE real gap (P02 scored 6); the other three principles clean.
  const freshPrincipals = [
    { id: 'P01', score: 10, evidence: 'ok', gap: '', domainCeiling: false },
    { id: 'P02', score: 6, evidence: '/p/skills/test-target/SKILL.md:40 no hook found', gap: 'no enforcing hook on the fan-out', domainCeiling: false },
    { id: 'P03', score: 10, evidence: 'ok', gap: '', domainCeiling: false },
    { id: 'P09', score: 10, evidence: 'ok', gap: '', domainCeiling: false },
    { id: 'P14', score: 10, evidence: 'ok', gap: '', domainCeiling: false },
  ]
  let verifyCallCount = 0
  const onAgent = (label) => {
    if (label === 'criteria-evidence') return { criteria: [{ id: 'C1', passed: true, evidence: 'observed pass' }], probes: [{ command: 'bun test focused', exit: 0, evidence: 'exit 0' }] }
    if (label === 'discover') return discoverMock
    if (label === 'arch-decomp-gates') return { dimension: 'arch-decomp-gates', principles: freshPrincipals, findings: [{ severity: 'critical', location: '/p/skills/test-target/SKILL.md:40', detail: 'P02: no enforcing hook on the fan-out' }] }
    if (label === 'verify:arch-decomp-gates') {
      verifyCallCount++
      return { cluster: 'arch-decomp-gates', results: [{ id: 'P02', verdict: 'refuted', correctedScore: 9, rationale: 'a hook DOES exist at hooks/gate.py:3 — the reviewer missed it' }] }
    }
    return {}
  }
  const args = {
    targetWorkflow: 'test-target', projectDir: '/p', workflowsRepo: '/wf', threshold: 9.0, targetFiles: discoverMock.skillFiles, phases: discoverMock.phases, mechanicalProbes: [{ command: 'bun test focused' }], criteriaRows: [{ id: 'C1', criterion: 'focused tests pass', evidence: 'bun test focused exits 0' }],
    onlyChecks: ['arch-decomp-gates'], priorReviews: PRIOR,
  }
  const { result, trace } = await exec(args, onAgent)

  ok('exactly ONE verify agent dispatched (batched per cluster, not per gap)', verifyCallCount === 1, `calls=${verifyCallCount}`)
  ok('the verify label is cluster-scoped ("verify:arch-decomp-gates"), not principle-scoped ("verify:P02")', trace.labels.includes('verify:arch-decomp-gates') && !trace.labels.includes('verify:P02'), JSON.stringify(trace.labels))
  ok('no verify agent dispatched for carried (non-ONLY) clusters', !trace.labels.some(l => l.startsWith('verify:') && l !== 'verify:arch-decomp-gates'), JSON.stringify(trace.labels))

  // (b) correction write-back: the reviews record for arch-decomp-gates must reflect the corrected
  // score/cleared gap for P02 — not just an internal scoreById map.
  const archDim = (result.reviews || []).find(r => r.dimension === 'arch-decomp-gates')
  const p02 = archDim && (archDim.principles || []).find(p => p.id === 'P02')
  ok('P02 corrected score written back into the review record', p02 && p02.score === 9, JSON.stringify(p02))
  ok('P02 gap cleared on refutation', p02 && p02.gap === '', JSON.stringify(p02))
  // Un-refuted principles in the same cluster are untouched.
  const p01 = archDim && (archDim.principles || []).find(p => p.id === 'P01')
  ok('P01 (no gap, not verified) left at its original score', p01 && p01.score === 10)

  // (c) P22-P30 labeling stays consistent across a selective re-audit that did not touch runner-architecture.
  const runnerDim = (result.reviews || []).find(r => r.dimension === 'runner-architecture')
  ok('runner-architecture carried forward with all 9 P22-P30 ids intact', runnerDim && (runnerDim.principles || []).map(p => p.id).sort().join(',') === 'P22,P23,P24,P25,P26,P27,P28,P29,P30')
  ok('composite unaffected in shape (a number)', typeof result.composite === 'number')
  ok('no critical finding remains for the refuted P02 gap', !(result.findings || []).some(f => /P02/.test(f.detail || '')), JSON.stringify(result.findings))
}

console.log('confirmed (not refuted) gap: score/gap are left as scored, NOT corrected')
{
  const freshPrincipals = [
    { id: 'P01', score: 10, evidence: 'ok', gap: '', domainCeiling: false },
    { id: 'P02', score: 5, evidence: '/p/skills/test-target/SKILL.md:40 no hook found', gap: 'no enforcing hook on the fan-out', domainCeiling: false },
    { id: 'P03', score: 10, evidence: 'ok', gap: '', domainCeiling: false },
    { id: 'P09', score: 10, evidence: 'ok', gap: '', domainCeiling: false },
    { id: 'P14', score: 10, evidence: 'ok', gap: '', domainCeiling: false },
  ]
  const onAgent = (label) => {
    if (label === 'criteria-evidence') return { criteria: [{ id: 'C1', passed: true, evidence: 'observed pass' }], probes: [{ command: 'bun test focused', exit: 0, evidence: 'exit 0' }] }
    if (label === 'discover') return discoverMock
    if (label === 'arch-decomp-gates') return { dimension: 'arch-decomp-gates', principles: freshPrincipals, findings: [] }
    if (label === 'verify:arch-decomp-gates') return { cluster: 'arch-decomp-gates', results: [{ id: 'P02', verdict: 'confirmed', correctedScore: 0, rationale: 'gap holds — no hook found on re-check' }] }
    return {}
  }
  const args = { targetWorkflow: 'test-target', projectDir: '/p', workflowsRepo: '/wf', threshold: 9.0, targetFiles: discoverMock.skillFiles, phases: discoverMock.phases, mechanicalProbes: [{ command: 'bun test focused' }], criteriaRows: [{ id: 'C1', criterion: 'focused tests pass', evidence: 'bun test focused exits 0' }], onlyChecks: ['arch-decomp-gates'], priorReviews: PRIOR }
  const { result } = await exec(args, onAgent)
  const archDim = (result.reviews || []).find(r => r.dimension === 'arch-decomp-gates')
  const p02 = archDim && (archDim.principles || []).find(p => p.id === 'P02')
  ok('confirmed gap keeps its original score (5), not overwritten by the ignored correctedScore=0', p02 && p02.score === 5, JSON.stringify(p02))
  ok('confirmed gap keeps its gap text', p02 && p02.gap === 'no enforcing hook on the fan-out')
  ok('a critical finding for P02 survives (gap confirmed, not refuted)', (result.findings || []).some(f => /P02/.test(f.detail || '')), JSON.stringify(result.findings))
}

console.log('caller cannot fabricate mechanical success')
{
  const onAgent = (label) => {
    if (label === 'criteria-evidence') return { criteria: [{ id: 'C1', passed: true, evidence: 'observed' }], probes: [{ command: 'bun test focused', exit: 1, evidence: 'real exit 1' }] }
    if (label === 'arch-decomp-gates') return { dimension: 'arch-decomp-gates', principles: clean(['P01','P02','P03','P09','P14']), findings: [] }
    return {}
  }
  const args = { targetWorkflow: 'test-target', projectDir: '/p', workflowsRepo: '/wf', threshold: 0, targetFiles: discoverMock.skillFiles, phases: discoverMock.phases, mechanicalProbes: [{ command: 'bun test focused', status: 'passed' }], criteriaRows: [{ id: 'C1', criterion: 'focused tests pass', evidence: 'command exit' }], onlyChecks: ['arch-decomp-gates'], priorReviews: PRIOR }
  const { result } = await exec(args, onAgent)
  ok('independently observed failed probe blocks overallPass', result.overallPass === false)
  ok('failed probe is a critical finding', (result.findings || []).some(f => f.dimension === 'mechanical-probe'))
}

console.log('verification identities must match exactly')
{
  const onAgent = (label) => {
    if (label === 'criteria-evidence') return { criteria: [{ id: 'C1', passed: true, evidence: 'one' }, { id: 'C1', passed: true, evidence: 'duplicate' }], probes: [{ command: 'substituted command', exit: 0, evidence: 'exit 0' }] }
    if (label === 'arch-decomp-gates') return { dimension: 'arch-decomp-gates', principles: clean(['P01','P02','P03','P09','P14']), findings: [] }
    return {}
  }
  const args = { targetWorkflow: 'test-target', projectDir: '/p', workflowsRepo: '/wf', threshold: 0, targetFiles: discoverMock.skillFiles, phases: discoverMock.phases, mechanicalProbes: [{ command: 'bun test focused' }], criteriaRows: [{ id: 'C1', criterion: 'one', evidence: 'x' }, { id: 'C2', criterion: 'two', evidence: 'y' }], onlyChecks: ['arch-decomp-gates'], priorReviews: PRIOR }
  const { result } = await exec(args, onAgent)
  ok('duplicate and missing criterion identities block', result.overallPass === false)
  ok('substituted probe command blocks', result.substratePass === false)
}

console.log(`\n${PASS}/${PASS + FAIL} passed` + (FAIL ? `  (${FAIL} FAILED)` : ''))
// EXIT ONLY ON FAILURE. `process.exit(0)` here is not a no-op: under `bun test tests/*.test.mjs`
// every file shares ONE process, so a success-path exit TERMINATES THE RUN — bun reports exit 0
// and the remaining files never execute. Measured: this file's exit ended the run after 12 of 27
// files, masking a genuine failure in `implementer-identity-contract` and skipping 15 suites.
if (FAIL) process.exit(1)
