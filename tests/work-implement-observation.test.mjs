// Contract tests for the IMPLEMENT-phase observation hook pair.
//
// PROVENANCE — READ THIS BEFORE DELETING ANYTHING HERE
//   These assertions were re-homed from tests/beat-implement-runner.test.mjs when
//   `workflows/beat-implement.js` was retired. The runner captured a git observation before and after
//   every dispatch inside its own loop and enforced the output contract on the delta. That work could
//   not move to a pre-step or a post-step — it needs the moment BETWEEN dispatches — so it moved to
//   this hook pair, and its assertions moved here with it.
//
//   The pre-dispatch half of the old suites lives in tests/beat-implement-preflight.test.mjs.
//
// THE HOOK IS RUN AS A REAL SUBPROCESS, ON REAL GIT FIXTURES.
//   Importing its functions and calling them would test a different program: the hook's contract is
//   its stdin payload, its exit code, and its stdout JSON, and every one of those is where the
//   failures have actually been (an explicit {"decision":"allow"} on PostToolUse is REJECTED and
//   discards the payload; a crash is a silent ALLOW). None of that is observable in-process.
//
// Run: bun tests/work-implement-observation.test.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { OBSERVATION_DIR, recordPath, expectationPath } from '../hooks/work-implement-observation.ts'
import { sessionFlagKey } from '../hooks/_gate_common.ts'
import { preflight } from '../scripts/beat/preflight.ts'

const ROOT = new URL('..', import.meta.url).pathname
const HOOK = join(ROOT, 'hooks/work-implement-observation.ts')
let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

const cleanup = []
const plan = '# Approved plan\n'
const hash = createHash('sha256').update(plan).digest('hex')
const planFile = 'jazzy-leaping-scroll.md'

function projectFor() {
  const project = mkdtempSync(join(tmpdir(), 'observation-'))
  cleanup.push(project)
  const state = join(project, '.planning/.state')
  mkdirSync(state, { recursive: true })
  writeFileSync(join(project, '.planning', planFile), plan)
  writeFileSync(join(state, 'review.json'), JSON.stringify({
    workflow: 'ds', plan_file: planFile, plan_hash: hash,
    approved_session_id: 's-123', approved_at: '2026-01-01T00:00:00.000Z',
    status: 'APPROVED', reviewer_session_id: 'reviewer-456', reviewed_at: '2026-01-01T00:00:01.000Z',
  }))
  for (const argv of [['init', '-q'], ['config', 'user.email', 'test@example.invalid'], ['config', 'user.name', 'Test'], ['add', '.'], ['commit', '-qm', 'fixture']]) {
    Bun.spawnSync(['git', ...argv], { cwd: project })
  }
  return project
}

const task = (id, outputs, writablePaths = outputs) => ({
  id, name: `Task ${id}`, work: `Implement task ${id}.`, criteria: `Criterion ${id}.`,
  outputs, writablePaths, instructionFiles: [], model: 'sonnet', effort: 'high', dependencyProof: 'independent',
})

let sessionCounter = 0
const nextSession = () => `observation-session-${++sessionCounter}-${process.pid}`

function fire(phase, payload) {
  const result = Bun.spawnSync(['bun', HOOK, '--phase', phase], {
    stdin: Buffer.from(JSON.stringify(payload)),
    stdout: 'pipe', stderr: 'pipe',
  })
  const stdout = result.stdout.toString()
  let json
  try { json = stdout.trim() ? JSON.parse(stdout) : undefined } catch { json = undefined }
  return { code: result.exitCode, stdout, json, stderr: result.stderr.toString() }
}

const payloadFor = (session, project, prompt, toolResponse) => ({
  session_id: session, cwd: project, tool_name: 'Agent',
  tool_input: { prompt }, ...(toolResponse ? { tool_response: toolResponse } : {}),
})

const promptFor = (id, name = `Task ${id}`) => `You are the direct implementation agent.\n\nTASK ${id}: ${name}\nWORK:\ndo it\n`
const key = session => sessionFlagKey({ session_id: session })
const readRecord = (session, fingerprint, id, phase) => {
  const path = recordPath(key(session), fingerprint, id, phase)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
}

// ── The wiring assertion. This is the one that fails when the two halves drift apart. ───────────
//
// The preflight writes the expectation; the hook reads it. They must agree on the KEY, and the key is
// not the raw session id — it is `sessionFlagKey`'s sanitised-and-hashed derivative. A mismatch is
// completely silent: preflight succeeds, the hook finds nothing, every dispatch is recorded under the
// "no-expectation" fingerprint and adjudicated against no bounds at all. Enforcement disappears with
// no error anywhere. (It was written under the raw id first; this check is why that was caught.)
console.log('the preflight expectation and the hook lookup agree on the session key')
{
  const session = nextSession()
  const project = projectFor()
  const result = preflight({
    workflow: 'ds', projectDir: project, dispatchSession: session,
    planReset: { planFile, planHash: hash }, readyWave: [task('a', ['src/a.js'])],
  })
  ok('preflight writes the expectation where the hook looks for it',
    result.expectationPath === expectationPath(key(session)), result.expectationPath)
  fire('pre', payloadFor(session, project, promptFor('a')))
  const record = readRecord(session, result.waveFingerprint, 'a', 'pre')
  ok('the hook resolves the authenticated expectation, not the no-expectation fallback',
    record?.status === 'observed', JSON.stringify(record))
  ok('the pre record is keyed by the authenticated wave fingerprint',
    readRecord(session, 'no-expectation', 'a', 'pre') === undefined)
}

// A shared harness: preflight, pre-hook, mutate the tree as the agent would, post-hook.
function dispatch({ tasks, mutate, reported, taskId = 'a' }) {
  const session = nextSession()
  const project = projectFor()
  const result = preflight({
    workflow: 'ds', projectDir: project, dispatchSession: session,
    planReset: { planFile, planHash: hash }, readyWave: tasks,
  })
  const pre = fire('pre', payloadFor(session, project, promptFor(taskId)))
  mutate?.(project)
  const post = fire('post', payloadFor(session, project, promptFor(taskId), { changedFiles: reported }))
  return {
    session, project, pre, post, fingerprint: result.waveFingerprint,
    adjudication: readRecord(session, result.waveFingerprint, taskId, 'adjudication'),
  }
}

console.log('a clean task is observed, adjudicated, and left alone')
{
  const run = dispatch({
    tasks: [task('a', ['src/a.js'])],
    mutate: project => { mkdirSync(join(project, 'src'), { recursive: true }); writeFileSync(join(project, 'src/a.js'), 'produced') },
    reported: ['src/a.js'],
  })
  ok('pre phase allows the dispatch', run.pre.code === 0)
  ok('post phase exits cleanly', run.post.code === 0, run.post.stderr)
  ok('a clean task is not blocked', !/"decision"\s*:\s*"block"/.test(run.post.stdout), run.post.stdout)
  // Silence is how a PostToolUse hook says "carry on". An explicit {"decision":"allow"} is REJECTED
  // as invalid and discards the whole payload, turning a pass into a deny.
  ok('a clean task emits no explicit allow decision', !/"decision"\s*:\s*"allow"/.test(run.post.stdout), run.post.stdout)
  ok('adjudication is recorded as clean', run.adjudication?.status === 'clean', JSON.stringify(run.adjudication))
  ok('the observed change is recorded', JSON.stringify(run.adjudication?.changedPaths) === JSON.stringify(['src/a.js']), JSON.stringify(run.adjudication))
}

console.log('writing outside the declared authority is detected and refused')
{
  const run = dispatch({
    tasks: [task('a', ['src/a.js'])],
    mutate: project => {
      mkdirSync(join(project, 'src'), { recursive: true })
      writeFileSync(join(project, 'src/a.js'), 'produced')
      writeFileSync(join(project, 'outside.js'), 'unauthorized')
    },
    reported: ['src/a.js', 'outside.js'],
  })
  ok('out-of-bounds write is adjudicated as a violation', run.adjudication?.status === 'violated', JSON.stringify(run.adjudication))
  ok('the violation names writable authority', /outside writable authority/.test(run.adjudication?.violations?.[0] || ''), JSON.stringify(run.adjudication))
  ok('the run is halted', run.post.json?.continue === false, run.post.stdout)
  ok('the decision is block', run.post.json?.decision === 'block', run.post.stdout)
  // The enforcement, such as it is: the model never sees the agent's own success report.
  ok('the agent\'s success report is replaced before the model sees it',
    /REJECTED/.test(run.post.json?.hookSpecificOutput?.updatedToolOutput || ''), run.post.stdout)
  ok('the replacement does not claim the write was prevented',
    /does not undo it|already on disk/.test(run.post.json?.hookSpecificOutput?.updatedToolOutput || ''), run.post.stdout)
}

// INTENDED PROPERTY, NOT REDUNDANT WITH THE BOUNDS CHECK. A bounds check catches writing the WRONG
// file; this catches LYING about which file was written. That self-vouching failure is what the whole
// redesign exists to remove, so do not merge the two cases.
console.log('an agent that misreports its own changes is caught')
{
  const run = dispatch({
    tasks: [task('a', ['src/a.js'], ['src/a.js', 'src/other.js'])],
    mutate: project => { mkdirSync(join(project, 'src'), { recursive: true }); writeFileSync(join(project, 'src/a.js'), 'produced') },
    reported: ['src/other.js'],
  })
  ok('a misreported change list is a violation', run.adjudication?.status === 'violated', JSON.stringify(run.adjudication))
  ok('the violation is a report mismatch, not a bounds failure',
    /report mismatch/.test(run.adjudication?.violations?.[0] || ''), JSON.stringify(run.adjudication))
}

console.log('a missing declared output is a violation')
{
  const run = dispatch({
    tasks: [task('a', ['src/a.js'], ['src/a.js', 'src/other.js'])],
    mutate: project => { mkdirSync(join(project, 'src'), { recursive: true }); writeFileSync(join(project, 'src/other.js'), 'other') },
    reported: ['src/other.js'],
  })
  ok('an unproduced declared output is a violation', run.adjudication?.status === 'violated', JSON.stringify(run.adjudication))
  ok('the violation names the required output', /required output/.test(run.adjudication?.violations?.[0] || ''), JSON.stringify(run.adjudication))
}

// THE THREE OUTCOMES MUST NOT COLLAPSE INTO TWO. `enforceTaskOutputs` throws for four causes and only
// one of them is the agent. A plan that declares an output outside its own task's writable authority
// is true before any agent runs and unavoidable by good behaviour; reporting it as a task violation
// sends someone to re-dispatch an agent that did nothing wrong.
console.log('a plan defect is reported as a plan defect, never as a task violation')
{
  const session = nextSession()
  const project = projectFor()
  const result = preflight({
    workflow: 'ds', projectDir: project, dispatchSession: session,
    planReset: { planFile, planHash: hash }, readyWave: [task('a', ['src/a.js'])],
  })
  // The preflight refuses this shape outright, which is the right place and the earlier one. Forge it
  // into the expectation directly to exercise the hook's own defence in depth.
  const expectation = JSON.parse(readFileSync(result.expectationPath, 'utf8'))
  expectation.tasks.a.outputs = ['elsewhere/forbidden.js']
  writeFileSync(result.expectationPath, JSON.stringify(expectation))
  fire('pre', payloadFor(session, project, promptFor('a')))
  mkdirSync(join(project, 'src'), { recursive: true })
  writeFileSync(join(project, 'src/a.js'), 'produced')
  const post = fire('post', payloadFor(session, project, promptFor('a'), { changedFiles: ['src/a.js'] }))
  const adjudication = readRecord(session, result.waveFingerprint, 'a', 'adjudication')
  ok('a plan defect is recorded as not-adjudicable', adjudication?.status === 'not-adjudicable', JSON.stringify(adjudication))
  ok('a plan defect does not halt the run as an agent violation', post.json?.continue !== false, post.stdout)
  ok('a plan defect says so in words', /PLAN or MACHINERY defect/.test(post.json?.hookSpecificOutput?.additionalContext || ''), post.stdout)
  ok('a plan defect explicitly disclaims agent fault',
    /NOT a task violation/.test(post.json?.hookSpecificOutput?.additionalContext || ''), post.stdout)
}

console.log('a task the authenticated plan does not name cannot be adjudicated')
{
  const run = dispatch({ tasks: [task('a', ['src/a.js'])], taskId: 'ghost', reported: [] })
  ok('an unexpected task id is surfaced, not silently passed',
    /not in the authenticated expectation/.test(run.post.json?.hookSpecificOutput?.additionalContext || ''), run.post.stdout)
}

// FAIL OPEN ON OUR OWN ERRORS, BUT NEVER FAIL SILENT. A hook that errors every time — plugin
// disabled, CLAUDE_PLUGIN_ROOT moved by a version bump, hooks stripped from settings — would allow
// every dispatch, observe nothing, and produce a run indistinguishable from a clean one. Every path
// leaves a record so the gate can treat ABSENCE as failure rather than as a pass.
console.log('a dispatch with no preflight is recorded distinctly, not treated as clean')
{
  const session = nextSession()
  const project = projectFor()
  fire('pre', payloadFor(session, project, promptFor('a')))
  ok('an unexpected dispatch still leaves a record', readRecord(session, 'no-expectation', 'a', 'pre')?.status === 'observed')
  ok('"never expected" is distinguishable from "expected but unobserved"',
    readRecord(session, 'no-expectation', 'a', 'pre')?.fingerprint === 'no-expectation')
}

console.log('non-implement agent calls and malformed payloads are left strictly alone')
{
  const session = nextSession()
  const project = projectFor()
  const before = existsSync(OBSERVATION_DIR) ? readdirSync(OBSERVATION_DIR).length : 0
  const verifier = fire('pre', payloadFor(session, project, 'You are a fresh verifier. Check the criteria.'))
  ok('a non-implement dispatch exits cleanly', verifier.code === 0)
  ok('a non-implement dispatch writes no record',
    (existsSync(OBSERVATION_DIR) ? readdirSync(OBSERVATION_DIR).length : 0) === before)
  ok('a non-implement dispatch is not denied', !/"permissionDecision"\s*:\s*"deny"/.test(verifier.stdout), verifier.stdout)

  const malformedPre = Bun.spawnSync(['bun', HOOK, '--phase', 'pre'], { stdin: Buffer.from('{not json'), stdout: 'pipe', stderr: 'pipe' })
  ok('a malformed payload never denies', malformedPre.exitCode === 0 && !/deny/.test(malformedPre.stdout.toString()), malformedPre.stdout.toString())
  const malformedPost = Bun.spawnSync(['bun', HOOK, '--phase', 'post'], { stdin: Buffer.from('{not json'), stdout: 'pipe', stderr: 'pipe' })
  ok('a malformed payload never blocks', malformedPost.exitCode === 0 && !/"decision"\s*:\s*"block"/.test(malformedPost.stdout.toString()), malformedPost.stdout.toString())
}

console.log('records are keyed per run, so one run cannot adjudicate another')
{
  // Task ids are unique within a wave, but a RESUMED run replays the same ids in a new process and a
  // user running the phase twice does the same. Keying on the id alone would let one run's
  // pre-observation adjudicate another run's task.
  const a = dispatch({
    tasks: [task('a', ['src/a.js'])],
    mutate: project => { mkdirSync(join(project, 'src'), { recursive: true }); writeFileSync(join(project, 'src/a.js'), 'produced') },
    reported: ['src/a.js'],
  })
  const b = dispatch({
    tasks: [task('a', ['src/b.js'])],
    mutate: project => { mkdirSync(join(project, 'src'), { recursive: true }); writeFileSync(join(project, 'src/b.js'), 'produced') },
    reported: ['src/b.js'],
  })
  ok('two runs of the same task id keep separate records', a.fingerprint !== b.fingerprint)
  ok('each run is adjudicated against its own bounds', a.adjudication?.status === 'clean' && b.adjudication?.status === 'clean',
    JSON.stringify([a.adjudication, b.adjudication]))
}

for (const path of cleanup) rmSync(path, { recursive: true, force: true })
console.log(`\n${PASS}/${PASS + FAIL} passed`)
if (FAIL) throw new Error(`${FAIL} implement-observation contract check(s) failed`)
