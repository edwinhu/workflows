// Contract tests for the IMPLEMENT beat's deterministic pre-step.
//
// PROVENANCE — READ THIS BEFORE DELETING ANYTHING HERE
//   These assertions were re-homed from tests/beat-implement-runner.test.mjs and
//   tests/beat-implement-extension.test.mjs when `workflows/beat-implement.js` was retired. That
//   script could never execute under the Workflow runtime, but the ~105 assertions pinned against it
//   were the safety property, so retiring it was a migration and not a delete.
//
//   Everything the old suites checked BEFORE dispatch lives here. Everything they checked BETWEEN
//   dispatches — the git delta and the output-contract adjudication — lives in
//   tests/work-implement-observation.test.mjs, because a pre-step cannot observe a moment that does
//   not exist yet. If a property from the old suites appears in neither file, it was lost; that is
//   the failure this comment exists to make visible.
//
// Run: bun test tests/beat-implement-preflight.test.mjs
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureApprovalBundle } from '../workflows/lib/approval-bundle.ts'
import { captureGitObservation } from '../workflows/lib/git-observation.ts'
import { createCandidateState } from '../workflows/lib/candidate-state.ts'
import { fingerprint } from '../workflows/lib/task-contract.ts'
import { preflight } from '../scripts/beat/preflight.ts'

let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}
const rejects = (name, thunk, pattern) => {
  try { thunk(); ok(name, false, 'did not throw') }
  catch (error) { ok(name, !pattern || pattern.test(String(error)), String(error)) }
}

const plan = '# Approved plan\n'
const hash = createHash('sha256').update(plan).digest('hex')
const planFile = 'jazzy-leaping-scroll.md'
const reset = { planFile, planHash: hash }
const cleanup = []
const SESSION = 'preflight-dispatch-session'

function projectFor(options = {}) {
  const project = mkdtempSync(join(tmpdir(), 'beat-preflight-'))
  cleanup.push(project)
  const planning = join(project, '.planning')
  const state = join(planning, '.state')
  const approvedPlan = options.plan || plan
  const approvedHash = createHash('sha256').update(approvedPlan).digest('hex')
  mkdirSync(state, { recursive: true })
  const selectedPlanFile = options.planFile || planFile
  writeFileSync(join(planning, selectedPlanFile), approvedPlan)
  writeFileSync(join(state, 'review.json'), JSON.stringify({
    workflow: options.workflow || 'ds',
    plan_file: options.statePlanFile || selectedPlanFile,
    plan_hash: options.reviewHash || approvedHash,
    approved_session_id: options.approvedSession || 's-123',
    approved_at: options.approvedAt || '2026-01-01T00:00:00.000Z',
    status: options.reviewStatus || 'APPROVED',
    reviewer_session_id: options.reviewStatus === 'PENDING' ? '' : (options.reviewerSession || 'reviewer-456'),
    reviewed_at: options.reviewStatus === 'PENDING' ? '' : (options.reviewedAt || '2026-01-01T00:00:01.000Z'),
    ...(options.metaExtra || {}),
  }))
  Bun.spawnSync(['git', 'init', '-q'], { cwd: project })
  Bun.spawnSync(['git', 'config', 'user.email', 'test@example.invalid'], { cwd: project })
  Bun.spawnSync(['git', 'config', 'user.name', 'Test'], { cwd: project })
  Bun.spawnSync(['git', 'add', '.'], { cwd: project })
  Bun.spawnSync(['git', 'commit', '-qm', 'fixture'], { cwd: project })
  return project
}

const task = (id, outputs, extra = {}) => ({
  id, name: `Task ${id}`, work: `Implement task ${id}.`, criteria: `Criterion ${id}.`,
  outputs, writablePaths: outputs, instructionFiles: ['/plugin/references/constraints/ds-common-constraints.md'],
  model: 'sonnet', effort: 'high', dependencyProof: 'independent', ...extra,
})

const run = (args, options = {}) => preflight({
  workflow: 'ds',
  projectDir: options.project || projectFor(options),
  dispatchSession: options.session === null ? undefined : (options.session || SESSION),
  planReset: reset,
  ...args,
})

console.log('a clean wave authenticates, routes, and yields dispatchable prompts')
{
  const result = run({ readyWave: [task('a', ['src/a.js']), task('b', ['src/b.js'])] })
  ok('returns one prompt per task in deterministic order', result.tasks.map(t => t.id).join(',') === 'a,b')
  ok('uses conservative sequential mode', result.executionMode === 'sequential', result.executionReason)
  ok('carries task-specific captured approval evidence', result.approvals.every(a => /^[0-9a-f]{64}$/.test(a.approvalBundleDigest)), JSON.stringify(result.approvals))
  ok('binds one approval per dispatched task', result.approvals.map(a => a.taskId).join(',') === 'a,b')
  ok('anchors the wave to a real pre-dispatch observation', /^[0-9a-f]{64}$/.test(result.preDispatchObservationDigest))
  ok('prompt excludes mutable planning files', !/STATE\.md|SPEC\.md|LEARNINGS\.md|agent-memory/.test(result.tasks[0].prompt), result.tasks[0].prompt)
  ok('prompt requires caller-selected constraints', /ds-common-constraints\.md/.test(result.tasks[0].prompt))
  ok('prompt carries the TASK marker the observation hook correlates on', /^TASK a:/m.test(result.tasks[0].prompt))
  ok('prompt declares the exclusive writable authority', /EXCLUSIVE WRITABLE PATHS/.test(result.tasks[0].prompt) && /- src\/a\.js/.test(result.tasks[0].prompt))
}

console.log('the expectation the hook adjudicates against is derived here, from the authenticated plan')
{
  const result = run({ readyWave: [task('a', ['src/a.js'], { writablePaths: ['src/a.js', 'src/aux.js'] })] })
  const expectation = JSON.parse(readFileSync(result.expectationPath, 'utf8'))
  ok('expectation is keyed by the wave fingerprint', expectation.waveFingerprint === result.waveFingerprint)
  ok('expectation carries the plan-declared writable bounds', JSON.stringify(expectation.tasks.a.writablePaths) === JSON.stringify(['src/a.js', 'src/aux.js']))
  ok('expectation carries the plan-declared outputs', JSON.stringify(expectation.tasks.a.outputs) === JSON.stringify(['src/a.js']))
  ok('expectation names the project the hook must observe', expectation.projectDir.startsWith(tmpdir()), expectation.projectDir)
  ok('expectation names the workflow', expectation.workflow === 'ds')
  // The bounds must NOT be recoverable from the prompt alone — that is the whole reason the hook
  // reads this file instead of the dispatch it is adjudicating.
  ok('a differing wave produces a differing fingerprint',
    run({ readyWave: [task('a', ['src/other.js'])] }).waveFingerprint !== result.waveFingerprint)
}

console.log('every built-in workflow authenticates through the shared approved-plan lifecycle')
for (const workflow of ['ds', 'dev', 'work', 'writing', 'workshop', 'workflow-creator']) {
  const project = projectFor({ workflow })
  const result = preflight({ workflow, projectDir: project, dispatchSession: SESSION, planReset: reset, readyWave: [task('a', ['src/a.js'])] })
  ok(`${workflow} authenticates through shared approved-plan lifecycle`, result.approvals.length === 1)
}

console.log('approval-mode and policy exclusivity is enforced before anything is dispatched')
rejects('unsupported workflow without explicit policy rejected',
  () => run({ workflow: 'unknown', readyWave: [] }), /approvalMode/)
rejects('cross-workflow receipt rejected',
  () => run({ workflow: 'workshop', readyWave: [] }), /review state|workflow/)
rejects('built-in approval paths cannot be overridden',
  () => run({ approvalPolicy: { schemaVersion: 1, workflow: 'ds', planPath: 'PLAN.md', metadataPath: 'PLAN.meta.json', verdictPath: 'PLAN_REVIEWED.md' }, readyWave: [] }), /cannot override/)
rejects('built-in captured bundle rejected',
  () => run({ readyWave: [task('approved', ['src/approved.js'])], capturedApprovalBundle: { schemaVersion: 1 } }), /do not accept captured approval bundles/)

console.log('durable plan review and reset gates reject invalid state')
for (const [name, options] of [
  ['stale plan review hash', { reviewHash: '0'.repeat(64) }],
  ['unapproved plan review', { reviewStatus: 'ISSUES_FOUND' }],
  ['reviewer approval session reused', { reviewerSession: 's-123' }],
  ['implementation session equals reviewer session', { session: 'reviewer-456' }],
  ['approval timestamp lacks UTC Z', { approvedAt: '2026-01-01T00:00:00+00:00' }],
  ['review timestamp lacks UTC Z', { reviewedAt: '2026-01-01T00:00:00+00:00' }],
  ['review predates approval', { approvedAt: '2026-01-01T00:01:00.000Z', reviewedAt: '2026-01-01T00:00:00.000Z' }],
  ['review equals approval timestamp', { approvedAt: '2026-01-01T00:00:00.000Z', reviewedAt: '2026-01-01T00:00:00.000Z' }],
  ['unexpected PLAN metadata key', { metaExtra: { forged: true } }],
]) {
  rejects(`rejects ${name}`, () => run({ readyWave: [task('a', ['src/a.js'])] }, options))
}

// The beat is a DISPATCHER, not an implementer: it hands each task to an agent that gets its own
// identity. So the dispatching session may equal the approving session — the single-conversation flow
// approves the plan and then dispatches — while the REVIEWER must still differ from both.
// approver != implementer is enforced where the implementer's identity exists, on that subagent's own
// tool calls (see tests/implementer-identity-contract.test.mjs).
console.log('dispatch by the approving session is admitted; reviewer separation still holds')
{
  const result = run({ readyWave: [task('a', ['src/a.js'])] }, { session: 's-123' })
  ok('approving session may dispatch implementation', result.approvals.length === 1)
}

// F2: the runner read process.env.CLAUDE_SESSION_ID, which Claude Code never sets. That reached
// .trim() with no type guard and threw an uncaught TypeError instead of a controlled failure. With no
// identity available at all it must fail CLOSED with a clear message, and it must never crash.
console.log('the preflight fails closed, never crashes, when it cannot authenticate its session')
{
  const previous = process.env.CLAUDE_CODE_SESSION_ID
  delete process.env.CLAUDE_CODE_SESSION_ID
  try {
    let message = ''
    try { run({ readyWave: [task('a', ['src/a.js'])] }, { session: null }) } catch (error) { message = String(error) }
    ok('names the missing dispatching-session identity', /dispatch|session/i.test(message), message)
    ok('does not surface a TypeError', !/TypeError/.test(message), message)
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
    else process.env.CLAUDE_CODE_SESSION_ID = previous
  }
}
rejects('rejects a blank dispatching-session identity',
  () => run({ readyWave: [task('a', ['src/a.js'])] }, { session: '   ' }), /^(?!.*TypeError).*(dispatch|session)/is)

console.log('overlapping declarations are named as the reason dispatch stays sequential')
{
  const shared = run({ readyWave: [task('a', ['src/shared.js']), task('b', ['src/shared.js'])] })
  ok('shared outputs are reported as the overlap reason', /writable paths overlap/.test(shared.executionReason), shared.executionReason)
  const nested = run({ readyWave: [task('a', ['src/generated']), task('b', ['src/generated/types.ts'])] })
  ok('ancestor overlaps descendant remains sequential', nested.executionMode === 'sequential', nested.executionReason)
  const manifest = run({ readyWave: [
    task('a', ['src/a.js'], { writablePaths: ['src/a.js', 'package.json'] }),
    task('b', ['src/b.js'], { writablePaths: ['src/b.js', 'package.json'] }),
  ] })
  ok('shared manifest writable path forces sequential dispatch', manifest.executionMode === 'sequential', manifest.executionReason)
}
for (const [name, outputs] of [
  ['glob declaration', [['src/*.js'], ['src/a.js']]],
  ['directory declaration', [['src/'], ['src/a.js']]],
  ['traversal declaration', [['src/../src/a.js'], ['src/a.js']]],
]) {
  rejects(`rejects ${name}`, () => run({ readyWave: [task('a', outputs[0]), task('b', outputs[1])] }))
}

console.log('writable path declarations enforce safe dispatch')
for (const [name, writablePaths] of [
  ['traversal', ['src/../src/a.js']],
  ['absolute path', ['/tmp/a.js']],
  ['backslash path', ['src\\a.js']],
  ['glob', ['src/*.js']],
  ['directory', ['src/']],
]) {
  rejects(`rejects ${name} writable path before dispatch`, () => run({ readyWave: [task('a', ['src/a.js'], { writablePaths })] }))
}
rejects('rejects duplicate task ids', () => run({ readyWave: [task('a', ['src/a.js']), task('a', ['src/b.js'])] }), /duplicate task id/)

console.log('canonical writable paths reject symlink authority escapes')
{
  const external = mkdtempSync(join(tmpdir(), 'beat-preflight-external-'))
  cleanup.push(external)
  const project = projectFor()
  symlinkSync(external, join(project, 'allowed'))
  rejects('rejects external directory symlink before dispatch', () => run({ readyWave: [task('a', ['allowed/file.js'])] }, { project }))
}
for (const [name, target] of [['internal alias', 'real'], ['dangling alias', 'missing'], ['chained alias', 'middle']]) {
  const project = projectFor()
  if (name === 'internal alias') mkdirSync(join(project, 'real'))
  if (name === 'chained alias') symlinkSync('final', join(project, 'middle'))
  symlinkSync(target, join(project, 'allowed'))
  rejects(`rejects ${name} before dispatch`, () => run({ readyWave: [task('a', ['allowed/file.js'])] }, { project }))
}
{
  const result = run({ readyWave: [task('a', ['safe/new/nested/file.js'])] })
  ok('allows safe non-existing nested writable path', result.tasks.map(t => t.id).join(',') === 'a')
}

console.log('candidate configuration is fully validated before dispatch')
for (const [name, candidateState, affectedChecks] of [
  ['blank affected check', { manifestDigest: 'd'.repeat(64), status: 'eligible', releaseEligible: true, checks: { tests: 'passed' }, supersededManifestDigests: [] }, ['']],
  ['unknown affected check', { manifestDigest: 'd'.repeat(64), status: 'eligible', releaseEligible: true, checks: { tests: 'passed' }, supersededManifestDigests: [] }, ['missing']],
  ['duplicate affected check', { manifestDigest: 'd'.repeat(64), status: 'eligible', releaseEligible: true, checks: { tests: 'passed' }, supersededManifestDigests: [] }, ['tests', 'tests']],
  ['stale affected check', { manifestDigest: 'd'.repeat(64), status: 'eligible', releaseEligible: true, checks: { tests: 'invalidated' }, supersededManifestDigests: [] }, ['tests']],
  ['malformed candidate state', { manifestDigest: 'not-a-digest', status: 'eligible', releaseEligible: true, checks: { tests: 'passed' }, supersededManifestDigests: [] }, ['tests']],
]) {
  rejects(`rejects ${name} without dispatch`, () => run({ readyWave: [task('a', ['src/a.js'])], candidateState, affectedChecks }))
}
rejects('rejects affectedChecks without candidateState',
  () => run({ readyWave: [task('a', ['src/a.js'])], affectedChecks: ['tests'] }), /require candidateState/)

console.log('resume includes only proven attempted work')
{
  const wave = [task('a', ['src/a.js']), task('b', ['src/b.js'])]
  const priorRecords = wave.map(t => ({
    taskId: t.id, taskFingerprint: fingerprint(t), planFile, planHash: hash,
    status: 'failed', summary: 'previous attempt', reusableFacts: [], changedFiles: [],
  }))
  const result = run({ readyWave: wave, resume: { attemptedTaskIds: ['a'], attemptRecords: priorRecords } })
  ok('only proven attempted task is resumed', result.tasks.map(t => t.id).join(',') === 'a', JSON.stringify(result.tasks.map(t => t.id)))
  ok('resume is reported as such', result.resumedAttemptedWorkOnly === true)
  ok('resume binds an approval only for the resumed task', result.approvals.map(a => a.taskId).join(',') === 'a')
}
for (const [name, attemptRecords] of [['no prior attempt proof', []], ['forged partial record', [{ taskId: 'a' }]]]) {
  rejects(`rejects retry with ${name}`, () => run({ readyWave: [task('a', ['src/a.js'])], resume: { attemptedTaskIds: ['a'], attemptRecords } }))
}
{
  const t = task('a', ['src/a.js'])
  const stale = [{
    taskId: 'a', taskFingerprint: fingerprint(t), planFile: 'replacement-generated.md', planHash: '1'.repeat(64),
    status: 'failed', summary: 'attempted', reusableFacts: [], changedFiles: [],
  }]
  rejects('rejects retry records from a prior plan hash before dispatch',
    () => run({ workflow: 'work', readyWave: [t], resume: { attemptedTaskIds: ['a'], attemptRecords: stale } }, { workflow: 'work' }),
    /complete records for this approved plan identity/)
}
rejects('rejects resume naming a task outside the wave',
  () => run({ readyWave: [task('a', ['src/a.js'])], resume: { attemptedTaskIds: ['ghost'], attemptRecords: [] } }))

console.log('plan-reset cross-check identity is strict')
for (const [name, badReset] of [
  ['unexpected marker field', { ...reset, marker: true }],
  ['blank hash', { ...reset, planHash: '  ' }],
  ['object plan file', { ...reset, planFile: {} }],
  ['hash that differs from the receipt', { ...reset, planHash: '0'.repeat(64) }],
]) {
  rejects(`rejects ${name}`, () => run({ readyWave: [task('a', ['src/a.js'])], planReset: badReset }))
}

console.log('external approval policy: schema v1 live approval and captured bundles')
{
  const workflow = 'opaque-extension-7f3a'
  const externalPlan = '# External approved plan\n'
  const externalHash = createHash('sha256').update(externalPlan).digest('hex')
  const approvalPolicy = {
    schemaVersion: 1, workflow,
    planPath: '.approval/CURRENT.md',
    metadataPath: '.approval/CURRENT.meta.json',
    verdictPath: '.approval/CURRENT_REVIEWED.md',
  }
  const externalProject = () => {
    const project = mkdtempSync(join(tmpdir(), 'beat-preflight-external-'))
    cleanup.push(project)
    mkdirSync(join(project, '.approval'), { recursive: true })
    writeFileSync(join(project, approvalPolicy.planPath), externalPlan)
    writeFileSync(join(project, approvalPolicy.metadataPath), JSON.stringify({
      schemaVersion: 1, workflow, planHash: externalHash,
      approvedSession: 'external-approval-session', approvedAt: '2026-01-01T00:00:00.000Z',
    }))
    writeFileSync(join(project, approvalPolicy.verdictPath), `---\nplan_hash: ${externalHash}\nstatus: APPROVED\nreviewer_session_id: external-review-session\nreviewed_at: 2026-01-01T00:00:01.000Z\n---\n`)
    Bun.spawnSync(['git', 'init', '-q'], { cwd: project })
    Bun.spawnSync(['git', 'config', 'user.email', 'test@example.invalid'], { cwd: project })
    Bun.spawnSync(['git', 'config', 'user.name', 'Test'], { cwd: project })
    Bun.spawnSync(['git', 'add', '.'], { cwd: project })
    Bun.spawnSync(['git', 'commit', '-qm', 'fixture'], { cwd: project })
    return project
  }
  const externalReset = { approvedBodyHash: externalHash, session: 'external-approval-session' }
  const externalRun = (overrides = {}, project = externalProject()) => preflight({
    projectDir: project, workflow, approvalMode: 'external-fixed-v1', approvalPolicy,
    dispatchSession: 'external-implementation-session',
    readyWave: [task('external', ['src/external.js'])], planReset: externalReset, ...overrides,
  })
  {
    const result = externalRun()
    ok('external schema-v1 live approval binds without a captured bundle', result.approvals.length === 1 && /^[0-9a-f]{64}$/.test(result.approvals[0].approvalBundleDigest), JSON.stringify(result.approvals))
    ok('external mode keeps the external planReset shape', result.generatedPlanMode === false)
  }
  rejects('requires an explicit approval mode for external workflows',
    () => externalRun({ approvalMode: undefined }), /approvalMode/i)
  rejects('rejects fixed external workflows without a policy',
    () => externalRun({ approvalPolicy: undefined }), /explicit approval policy|unknown workflow/i)
  rejects('rejects ambiguous built-in workflow plus external policy',
    () => externalRun({ workflow: 'ds' }), /cannot override|ambiguous|mutually exclusive/i)
  rejects('rejects weakened and unknown policy fields',
    () => externalRun({ approvalPolicy: { ...approvalPolicy, requireCurrentHash: false } }), /schema|policy/i)
  rejects('rejects policy identity mismatches',
    () => externalRun({ approvalPolicy: { ...approvalPolicy, workflow: 'other-extension' } }), /mismatch|authorizes/i)

  // Generated-plan receipt identity for an EXTERNAL workflow.
  const generatedProject = () => {
    const project = mkdtempSync(join(tmpdir(), 'beat-preflight-generated-'))
    cleanup.push(project)
    const planning = join(project, '.planning')
    mkdirSync(join(planning, '.state'), { recursive: true })
    writeFileSync(join(planning, 'external-generated.md'), externalPlan)
    writeFileSync(join(planning, '.state/review.json'), JSON.stringify({
      workflow, plan_file: 'external-generated.md', plan_hash: externalHash,
      approved_session_id: 'approval-session', approved_at: '2026-07-30T10:00:00.000Z',
      status: 'APPROVED', reviewer_session_id: 'review-session', reviewed_at: '2026-07-30T11:00:00.000Z',
    }))
    Bun.spawnSync(['git', 'init', '-q'], { cwd: project })
    Bun.spawnSync(['git', 'config', 'user.email', 'test@example.invalid'], { cwd: project })
    Bun.spawnSync(['git', 'config', 'user.name', 'Test'], { cwd: project })
    Bun.spawnSync(['git', 'add', '.'], { cwd: project })
    Bun.spawnSync(['git', 'commit', '-qm', 'fixture'], { cwd: project })
    return project
  }
  const generatedRun = (overrides = {}) => preflight({
    projectDir: generatedProject(), workflow, approvalMode: 'generated-plan-receipt-v1',
    dispatchSession: 'implementation-session',
    readyWave: [task('external', ['src/external.js'])],
    planReset: { planFile: 'external-generated.md', planHash: externalHash }, ...overrides,
  })
  {
    const result = generatedRun()
    ok('external workflow dispatches from a generated-plan receipt identity',
      result.generatedPlanMode === true && result.planReset.planFile === 'external-generated.md' && /^[0-9a-f]{64}$/.test(result.approvals[0].approvalBundleDigest), JSON.stringify(result.approvals))
  }
  rejects('rejects generated-plan receipt tampering before dispatch',
    () => generatedRun({ planReset: { planFile: 'external-generated.md', planHash: '0'.repeat(64) } }),
    /planReset|receipt-selected generated plan/i)
}

console.log('routing decides the dispatch shape, and only a workflow route emits a script')
{
  const single = run({ readyWave: [task('a', ['src/a.js'])] })
  ok('one task routes to a single subagent', single.routing.route === 'single-subagent', JSON.stringify(single.routing))
  ok('a single-subagent route emits no script', single.emittedWorkflowPath === undefined)

  const project = projectFor()
  const fanOut = run({ readyWave: ['a', 'b', 'c', 'd', 'e', 'f'].map(id => task(id, [`src/${id}.js`])), phases: ['Implement'] }, { project })
  ok('a fan-out wave routes to a generated workflow', fanOut.routing.route === 'workflow', JSON.stringify(fanOut.routing))
  ok('the generated script lands in the project workflows directory',
    fanOut.emittedWorkflowPath === join(project, '.claude/workflows/ds-implement.js'), String(fanOut.emittedWorkflowPath))
  const source = readFileSync(fanOut.emittedWorkflowPath, 'utf8')
  ok('the generated script is bound to the approved plan hash', source.includes(hash))
  ok('the generated script carries every task', ['a', 'b', 'c', 'd', 'e', 'f'].every(id => source.includes(`"id": "${id}"`)), source.slice(0, 200))
  // The emitted script wraps each preflight prompt with plan identity and its own `TASK <id>:` line,
  // so the dispatched prompt carries the marker TWICE. That is benign only because both interpolate
  // the SAME task object — if they could ever disagree, the hook would correlate a task's filesystem
  // delta to a different task's bounds. Asserted rather than assumed.
  ok('the generated script keeps the TASK marker the hook correlates on', /TASK \$\{task\.id\}:/.test(source))
  ok('every TASK marker in the dispatched prompt resolves to the same task id',
    new Set([...fanOut.tasks[0].prompt.matchAll(/^TASK (\S+):/gm)].map(m => m[1])).size === 1, fanOut.tasks[0].prompt.slice(0, 120))
  ok('the generated script is free of the runtime-forbidden constructs',
    !/\bimport\s*\(|\bimport\s*\.\s*meta\b|\bprocess\s*\.|\bBuffer\b/.test(source.replace(/^\s*\/\/.*$/gm, '')))
}

for (const path of cleanup) rmSync(path, { recursive: true, force: true })
console.log(`\n${PASS}/${PASS + FAIL} passed`)
if (FAIL) throw new Error(`${FAIL} beat-implement preflight contract check(s) failed`)
