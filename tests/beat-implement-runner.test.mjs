// Contract tests for the shared beat IMPLEMENT runner. Executes the workflow with mocked
// primitives so the dispatch policy is tested without spawning implementation agents.
// Run: bun test tests/beat-implement-runner.test.mjs
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

const source = readFileSync(ROOT + 'workflows/beat-implement.js', 'utf8')
  .replace(/^export const meta/m, 'const meta')
  // AsyncFunction is not an ES module, so make module-relative imports explicit here.
  .replace("new URL('./lib/approved-artifact.ts', import.meta.url).href", JSON.stringify(ROOT + 'workflows/lib/approved-artifact.ts'))
  .replace("new URL('./lib/task-contract.ts', import.meta.url).href", JSON.stringify(ROOT + 'workflows/lib/task-contract.ts'))
const plan = '# Approved plan\n'
const hash = createHash('sha256').update(plan).digest('hex')
const reset = { approvedBodyHash: hash, session: 's-123' }

function projectFor(options = {}) {
  const project = mkdtempSync(join(tmpdir(), 'beat-implement-'))
  const planning = join(project, '.planning')
  mkdirSync(planning)
  writeFileSync(join(planning, 'PLAN.md'), plan)
  const metadata = { schemaVersion: 1, workflow: options.workflow || 'ds', planHash: hash, approvedSession: 's-123', approvedAt: options.approvedAt || '2026-01-01T00:00:00.000Z', ...(options.metaExtra || {}) }
  writeFileSync(join(planning, 'PLAN.meta.json'), JSON.stringify(metadata))
  writeFileSync(join(planning, 'PLAN_REVIEWED.md'), `---\nplan_hash: ${options.reviewHash || hash}\nstatus: ${options.reviewStatus || 'APPROVED'}\nreviewer_session_id: ${options.reviewerSession || 'reviewer-456'}\nreviewed_at: ${options.reviewedAt || '2026-01-01T00:00:01.000Z'}\n---\n\nreview`)
  return project
}

async function exec(args, onAgent, options = {}) {
  const project = options.project || projectFor(options)
  const trace = { labels: [], prompts: {}, options: {} }
  const agent = async (prompt, agentOptions = {}) => {
    const label = agentOptions.label || ''
    trace.labels.push(label)
    trace.prompts[label] = prompt
    trace.options[label] = agentOptions
    return onAgent(label, prompt, agentOptions)
  }
  const parallel = async (thunks) => Promise.all(thunks.map(thunk => thunk()))
  const log = () => {}, phase = () => {}
  const fn = new AsyncFunction('agent', 'parallel', 'log', 'phase', 'args', source)
  const originalSession = process.env.CLAUDE_SESSION_ID
  process.env.CLAUDE_SESSION_ID = options.session || 'different-session'
  try {
    return { result: await fn(agent, parallel, log, phase, { workflow: 'ds', ...args, projectDir: project }), trace }
  } finally {
    if (originalSession === undefined) delete process.env.CLAUDE_SESSION_ID
    else process.env.CLAUDE_SESSION_ID = originalSession
    rmSync(project, { recursive: true, force: true })
  }
}

const task = (id, outputs, extra = {}) => ({
  id, name: `Task ${id}`, work: `Implement task ${id}.`, criteria: `Criterion ${id}.`,
  outputs, writablePaths: outputs, instructionFiles: ['/plugin/references/constraints/ds-common-constraints.md'],
  model: 'sonnet', effort: 'high', dependencyProof: 'independent', ...extra,
})

console.log('all implementation waves dispatch sequentially until filesystem isolation exists')
{
  const { result, trace } = await exec({ readyWave: [task('a', ['src/a.js']), task('b', ['src/b.js'])], planReset: reset }, label => ({ taskId: label.slice('implement:'.length), status: 'implemented', summary: 'done', reusableFacts: ['a fact'], changedFiles: label === 'implement:a' ? ['src/a.js'] : ['src/b.js'] }))
  ok('dispatches both tasks directly in deterministic order', trace.labels.join(',') === 'implement:a,implement:b', JSON.stringify(trace.labels))
  ok('uses conservative sequential mode', result.executionMode === 'sequential', result.executionReason)
  ok('passes task model', trace.options['implement:a']?.model === 'sonnet')
  ok('passes task effort', trace.options['implement:a']?.effort === 'high')
  ok('records implemented results', result.results.every(r => r.status === 'implemented'), JSON.stringify(result.results))
  ok('returns reusable facts for caller curation', result.reusableFacts.length === 2, JSON.stringify(result.reusableFacts))
  ok('prompt includes only immutable reset identity', new RegExp(hash).test(trace.prompts['implement:a']) && /s-123/.test(trace.prompts['implement:a']))
  ok('prompt excludes mutable planning files', !/STATE\.md|SPEC\.md|LEARNINGS\.md|agent-memory/.test(trace.prompts['implement:a']))
  ok('prompt requires caller-selected constraints', /ds-common-constraints\.md/.test(trace.prompts['implement:a']))
}

console.log('workflow authentication supports native-plan domains and rejects unsupported ones')
for (const workflow of ['writing', 'workshop', 'workflow-creator']) {
  const project = projectFor({ workflow })
  const { result } = await exec({ workflow, readyWave: [task('a', ['src/a.js'])], planReset: reset }, label => ({ taskId: label.slice('implement:'.length), status: 'implemented', summary: 'done', reusableFacts: [], changedFiles: ['src/a.js'] }), { project })
  ok(`${workflow} authenticates through shared approved-plan lifecycle`, result.results[0]?.status === 'implemented')
}
try {
  await exec({ workflow: 'work', readyWave: [], planReset: reset }, () => null)
  ok('unsupported work workflow rejected', false)
} catch (error) { ok('unsupported work workflow rejected', /args\.workflow/.test(String(error))) }
try {
  await exec({ workflow: 'workshop', readyWave: [], planReset: reset }, () => null)
  ok('cross-workflow metadata rejected', false)
} catch (error) { ok('cross-workflow metadata rejected', /authorizes ds, not workshop/.test(String(error))) }

console.log('durable plan review and reset gates reject invalid state')
for (const [name, options] of [
  ['stale plan review hash', { reviewHash: '0'.repeat(64) }],
  ['unapproved plan review', { reviewStatus: 'ISSUES_FOUND' }],
  ['same approval session', { session: 's-123' }],
  ['same approval session despite irrelevant marker file', { session: 's-123', contextReset: true }],
  ['reviewer approval session reused', { reviewerSession: 's-123' }],
  ['implementation session equals reviewer session', { session: 'reviewer-456' }],
  ['approval timestamp lacks UTC Z', { approvedAt: '2026-01-01T00:00:00+00:00' }],
  ['review timestamp lacks UTC Z', { reviewedAt: '2026-01-01T00:00:00+00:00' }],
  ['review predates approval', { approvedAt: '2026-01-01T00:01:00.000Z', reviewedAt: '2026-01-01T00:00:00.000Z' }],
  ['review equals approval timestamp', { approvedAt: '2026-01-01T00:00:00.000Z', reviewedAt: '2026-01-01T00:00:00.000Z' }],
  ['unexpected PLAN metadata key', { metaExtra: { forged: true } }],
]) {
  try {
    await exec({ readyWave: [task('a', ['src/a.js'])], planReset: reset }, () => ({}), options)
    ok(`rejects ${name}`, false)
  } catch { ok(`rejects ${name}`, true) }
}
console.log('shared or ambiguous output tasks dispatch sequentially')
{
  const { trace } = await exec({ readyWave: [task('a', ['src/shared.js']), task('b', ['src/shared.js'])], planReset: reset }, async label => ({ taskId: label.slice('implement:'.length), status: 'implemented', summary: 'done', reusableFacts: [], changedFiles: [] }))
  ok('shared outputs warn and use deterministic order', trace.labels.join(',') === 'implement:a,implement:b')
}
for (const [name, outputs] of [
  ['glob declaration', [['src/*.js'], ['src/a.js']]],
  ['directory declaration', [['src/'], ['src/a.js']]],
  ['traversal declaration', [['src/../src/a.js'], ['src/a.js']]],
]) {
  try {
    await exec({ readyWave: [task('a', outputs[0]), task('b', outputs[1])], planReset: reset }, () => ({}))
    ok(`rejects ${name}`, false)
  } catch { ok(`rejects ${name}`, true) }
}
{
  const { result } = await exec({ readyWave: [task('a', ['src/generated']), task('b', ['src/generated/types.ts'])], planReset: reset }, label => ({ taskId: label.slice('implement:'.length), status: 'implemented', summary: 'done', reusableFacts: [], changedFiles: [] }))
  ok('ancestor overlaps descendant remains sequential', result.executionMode === 'sequential', result.executionReason)
}

console.log('writable path declarations enforce safe dispatch and result reporting')
for (const [name, writablePaths] of [
  ['traversal', ['src/../src/a.js']],
  ['absolute path', ['/tmp/a.js']],
  ['backslash path', ['src\\a.js']],
  ['glob', ['src/*.js']],
  ['directory', ['src/']],
]) {
  try {
    await exec({ readyWave: [task('a', ['src/a.js'], { writablePaths })], planReset: reset }, () => {
      throw new Error('invalid task must not dispatch an agent')
    })
    ok(`rejects ${name} writable path before agent invocation`, false)
  } catch { ok(`rejects ${name} writable path before agent invocation`, true) }
}
{
  const { result } = await exec({
    readyWave: [
      task('a', ['src/a.js'], { writablePaths: ['src/a.js', 'package.json'] }),
      task('b', ['src/b.js'], { writablePaths: ['src/b.js', 'package.json'] }),
    ], planReset: reset,
  }, label => ({ taskId: label.slice('implement:'.length), status: 'implemented', summary: 'done', reusableFacts: [], changedFiles: [] }))
  ok('shared manifest writable path forces sequential dispatch', result.executionMode === 'sequential', result.executionReason)
}
{
  const { result } = await exec({ readyWave: [task('a', ['src/a.js'])], planReset: reset }, () => ({
    taskId: 'a', status: 'implemented', summary: 'done', reusableFacts: [], changedFiles: ['package.json'],
  }))
  ok('undeclared changed file is rejected', result.results[0].status === 'failed' && /outside/.test(result.results[0].summary))
}
{
  const project = projectFor()
  writeFileSync(join(project, 'src-a.js'), 'before')
  writeFileSync(join(project, 'src-b.js'), 'before')
  const { result } = await exec({ readyWave: [task('a', ['src-a.js', 'src-b.js'])], planReset: reset }, () => {
    writeFileSync(join(project, 'src-a.js'), 'after')
    writeFileSync(join(project, 'src-b.js'), 'after')
    return { taskId: 'a', status: 'implemented', summary: 'done', reusableFacts: [], changedFiles: ['src-a.js', 'src-a.js'] }
  }, { project })
  ok('duplicate manifest entries cannot omit an observed change', result.results[0].status === 'failed', JSON.stringify(result.results))
}

console.log('canonical writable paths reject symlink authority escapes')
{
  const external = mkdtempSync(join(tmpdir(), 'beat-implement-external-'))
  const project = projectFor()
  symlinkSync(external, join(project, 'allowed'))
  try {
    const { trace } = await exec({ readyWave: [task('a', ['allowed/file.js'])], planReset: reset }, () => ({}), { project })
    ok('rejects external directory symlink before dispatch', trace.labels.length === 0)
  } catch { ok('rejects external directory symlink before dispatch', true) }
  rmSync(external, { recursive: true, force: true })
}
for (const [name, target] of [['internal alias', 'real'], ['dangling alias', 'missing'], ['chained alias', 'middle']]) {
  const project = projectFor()
  if (name === 'internal alias') mkdirSync(join(project, 'real'))
  if (name === 'chained alias') symlinkSync('final', join(project, 'middle'))
  symlinkSync(target, join(project, 'allowed'))
  try {
    const { trace } = await exec({ readyWave: [task('a', ['allowed/file.js'])], planReset: reset }, () => ({}), { project })
    ok(`rejects ${name} before dispatch`, trace.labels.length === 0)
  } catch { ok(`rejects ${name} before dispatch`, true) }
}
{
  const project = projectFor()
  const { trace } = await exec({ readyWave: [task('a', ['safe/new/nested/file.js'])], planReset: reset }, () => ({ taskId: 'a', status: 'implemented', summary: 'done', reusableFacts: [], changedFiles: [] }), { project })
  ok('allows safe non-existing nested writable path', trace.labels.join(',') === 'implement:a')
}
{
  const project = projectFor()
  mkdirSync(join(project, 'allowed'))
  const { result } = await exec({ readyWave: [task('a', ['allowed'])], planReset: reset }, () => {
    symlinkSync('elsewhere', join(project, 'allowed', 'reported'))
    return { taskId: 'a', status: 'implemented', summary: 'done', reusableFacts: [], changedFiles: ['allowed/reported/file.js'] }
  }, { project })
  ok('rejects reported path through a newly created symlink', result.results[0].status === 'failed')
}

console.log('resume includes only proven attempted work and preserves structured blocked records')
{
  const wave = [task('a', ['src/a.js']), task('b', ['src/b.js'])]
  const project = projectFor()
  const { result: initial } = await exec({ readyWave: wave, planReset: reset }, () => ({ taskId: 'a', status: 'failed', summary: 'previous attempt', reusableFacts: [], changedFiles: [] }), { project })
  // The first exec owns cleanup; make a fresh equivalent project for retry records.
  const { result, trace } = await exec({ readyWave: wave, planReset: reset, resume: { attemptedTaskIds: ['a'], attemptRecords: initial.results } }, label => ({ taskId: label.slice('implement:'.length), status: 'blocked', summary: 'needs decision', reusableFacts: ['blocking fact'], changedFiles: [] }))
  ok('only proven attempted task is resumed', trace.labels.join(',') === 'implement:a', JSON.stringify(trace.labels))
  ok('blocked result preserved', result.results.length === 1 && result.results[0].status === 'blocked', JSON.stringify(result.results))
}
for (const [name, attemptRecords] of [['no prior attempt proof', []], ['forged partial record', [{ taskId: 'a' }]]]) {
  try { await exec({ readyWave: [task('a', ['src/a.js'])], planReset: reset, resume: { attemptedTaskIds: ['a'], attemptRecords } }, () => ({})); ok(`rejects retry with ${name}`, false) } catch { ok(`rejects retry with ${name}`, true) }
}

console.log('plan-reset cross-check identity is strict')
for (const [name, badReset] of [['unexpected marker field', { ...reset, marker: true }], ['blank hash', { ...reset, approvedBodyHash: '  ' }], ['object session', { ...reset, session: {} }]]) {
  try { await exec({ readyWave: [task('a', ['src/a.js'])], planReset: badReset }, () => ({})); ok(`rejects ${name}`, false) } catch { ok(`rejects ${name}`, true) }
}

console.log(`\n${PASS}/${PASS + FAIL} passed`)
process.exit(FAIL ? 1 : 0)
