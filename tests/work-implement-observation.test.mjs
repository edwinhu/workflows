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

  // EVERY hostile shape, not just unparseable bytes. This suite originally tried only `{not json`
  // and passed, while `null`, `[]` and `"str"` all exited 1 — a non-zero PreToolUse exit is a SILENT
  // ALLOW, so the hook was failing in the one way it must never fail. The cause was borrowing
  // `parsePayload`, whose `requireObject` calls process.exit(1) by design because it is built for
  // gates that deny. tests/pretooluse-crash-closure.test.mjs caught it by RUNNING the hook; this
  // covers it here too, where the hook's own semantics are defined.
  for (const hostile of ['{not json', 'null', '[]', '"str"', '', '123']) {
    const pre = Bun.spawnSync(['bun', HOOK, '--phase', 'pre'], { stdin: Buffer.from(hostile), stdout: 'pipe', stderr: 'pipe' })
    ok(`payload ${JSON.stringify(hostile)} never denies and never exits nonzero`,
      pre.exitCode === 0 && !/deny/.test(pre.stdout.toString()), `exit ${pre.exitCode} ${pre.stderr.toString().slice(0, 80)}`)
    const post = Bun.spawnSync(['bun', HOOK, '--phase', 'post'], { stdin: Buffer.from(hostile), stdout: 'pipe', stderr: 'pipe' })
    ok(`payload ${JSON.stringify(hostile)} never blocks and never exits nonzero`,
      post.exitCode === 0 && !/"decision"\s*:\s*"block"/.test(post.stdout.toString()), `exit ${post.exitCode} ${post.stderr.toString().slice(0, 80)}`)
  }
}

// Task ids are opaque strings in the shared task contract, and /writing keys its tasks by SECTION
// NAME — "Part I", "Introduction". An earlier `^TASK (\S+):` marker could not match those lines at
// all, so a spaced id read as a non-implement dispatch and was left completely unadjudicated. That is
// the silent failure this case exists to prevent, and it fires for the workflow being onboarded.
console.log('a task id containing spaces is correlated, not silently skipped')
{
  const run = dispatch({
    tasks: [task('Part I', ['drafts/part-i.md'])],
    taskId: 'Part I',
    mutate: project => { mkdirSync(join(project, 'drafts'), { recursive: true }); writeFileSync(join(project, 'drafts/part-i.md'), 'prose') },
    reported: ['drafts/part-i.md'],
  })
  ok('a spaced task id is adjudicated', run.adjudication?.status === 'clean', JSON.stringify(run.adjudication))
  const violating = dispatch({
    tasks: [task('Part I', ['drafts/part-i.md'])],
    taskId: 'Part I',
    mutate: project => {
      mkdirSync(join(project, 'drafts'), { recursive: true })
      writeFileSync(join(project, 'drafts/part-i.md'), 'prose')
      writeFileSync(join(project, 'drafts/part-ii.md'), 'not mine')
    },
    reported: ['drafts/part-i.md', 'drafts/part-ii.md'],
  })
  ok('a spaced task id is still bounds-checked', violating.adjudication?.status === 'violated', JSON.stringify(violating.adjudication))
}

// A colon in a task id is ordinary, not contrived — /writing keys tasks by section name and academic
// titles routinely read "Part I: Foundations". The marker is `TASK <id>: <name>`, so a blind parse
// cannot tell that id from a task called "Part I" named "Foundations": it resolved to "Part I",
// matched no bounds, and the task went unadjudicated. Resolving against the ids the authenticated
// plan actually names removes the guess.
console.log('a task id containing a colon resolves against the authenticated plan, not a guess')
{
  const run = dispatch({
    tasks: [task('Part I: Foundations', ['drafts/part-i.md'])],
    taskId: 'Part I: Foundations',
    mutate: project => { mkdirSync(join(project, 'drafts'), { recursive: true }); writeFileSync(join(project, 'drafts/part-i.md'), 'prose') },
    reported: ['drafts/part-i.md'],
  })
  ok('a colon-bearing id is adjudicated', run.adjudication?.status === 'clean', JSON.stringify(run.adjudication))

  // And the prefix case: two ids where one is a prefix of the other must not collide.
  const ambiguous = dispatch({
    tasks: [task('Part I', ['drafts/a.md']), task('Part I: Foundations', ['drafts/b.md'])],
    taskId: 'Part I: Foundations',
    mutate: project => { mkdirSync(join(project, 'drafts'), { recursive: true }); writeFileSync(join(project, 'drafts/b.md'), 'prose') },
    reported: ['drafts/b.md'],
  })
  ok('longest match wins, so a prefix id does not steal the dispatch',
    ambiguous.adjudication?.status === 'clean', JSON.stringify(ambiguous.adjudication))
}

// EVIDENCE IDENTITY MUST SURVIVE THE FILENAME. Careful marker parsing at the prompt layer is
// worthless if identity is destroyed at the storage layer — and it was: `recordPath` sanitized the
// task id to [A-Za-z0-9._-] and truncated at 96 chars, so `a/b`, `a?b` and `a b` shared one evidence
// file, as did any two ids agreeing on their first 96 sanitized characters. One task's clean record
// could then satisfy the gate for a different task. Task ids are opaque strings in the shared
// contract and /writing keys them by section name, so both shapes are reachable.
console.log('distinct task ids never share an evidence file')
{
  const ids = ['a/b', 'a?b', 'a b', 'Part I', 'Part I: Foundations', `${'x'.repeat(100)}ONE`, `${'x'.repeat(100)}TWO`]
  const paths = new Map()
  let collisions = 0
  for (const id of ids) {
    const file = recordPath('s', 'f', id, 'pre')
    if (paths.has(file)) { collisions++; console.log(`  collide: ${JSON.stringify(id)} vs ${JSON.stringify(paths.get(file))}`) }
    paths.set(file, id)
  }
  ok('seven distinct ids produce seven distinct paths', collisions === 0 && paths.size === ids.length)
  ok('the filename still carries a human-readable prefix', recordPath('s', 'f', 'Part I', 'pre').includes('Part_I'))
  ok('and a digest that makes it injective', /-[0-9a-f]{24}--pre\.json$/.test(recordPath('s', 'f', 'Part I', 'pre')))
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

// ── RED/GREEN IS ENFORCED BY **THIS HOOK**, not only by the CLI gate ─────────
//
// The whole point of that change was that the runtime invokes the hook while the gate's only caller
// is a bash line in a SKILL.md. Every redCommand test lived in tests/implement-gate.test.mjs — the
// OTHER copy — so the headline behaviour had no coverage where it actually runs, and the two
// `unusable` implementations had already drifted apart unnoticed.
{
  const session = nextSession()
  const project = projectFor()
  const src = join(project, 'src'); mkdirSync(src, { recursive: true })
  // OUTSIDE the project: a marker written inside it is an untracked file beyond the task's
  // writablePaths, which the bounds check correctly blocks. The fixture, not the rule, was wrong.
  const marker = join(tmpdir(), `redgate-${process.pid}-${sessionCounter}.flag`)
  // A real command whose verdict flips: fails while the flag is absent, passes once it exists.
  const redCommand = `test -e ${marker}`
  writeFileSync(expectationPath(sessionFlagKey({ session_id: session })), JSON.stringify({
    waveFingerprint: 'f'.repeat(64), projectDir: project, workflow: 'dev',
    tasks: { t1: { writablePaths: ['src/a.js'], outputs: ['src/a.js'], redCommand } },
  }))

  fire('pre', payloadFor(session, project, 'TASK t1: build it'))
  writeFileSync(join(src, 'a.js'), 'export const a = 1\n')
  writeFileSync(marker, 'green\n'); cleanup.push(marker)   // the work makes the command pass
  const post = fire('post', payloadFor(session, project, 'TASK t1: build it', { changedFiles: ['src/a.js'] }))
  ok('a genuine RED→GREEN transition is not blocked by the hook', post.json?.decision !== 'block', post.stdout.slice(0, 200))
}
{
  // The vacuous green: the command passed BEFORE the work, so it pins nothing. The gate catches this;
  // the hook must too, or an orchestrator that never runs the gate faces no enforcement at all.
  const session = nextSession()
  const project = projectFor()
  const src = join(project, 'src'); mkdirSync(src, { recursive: true })
  const redCommand = 'true'
  writeFileSync(expectationPath(sessionFlagKey({ session_id: session })), JSON.stringify({
    waveFingerprint: 'f'.repeat(64), projectDir: project, workflow: 'dev',
    tasks: { t1: { writablePaths: ['src/a.js'], outputs: ['src/a.js'], redCommand } },
  }))
  fire('pre', payloadFor(session, project, 'TASK t1: build it'))
  writeFileSync(join(src, 'a.js'), 'export const a = 1\n')
  const post = fire('post', payloadFor(session, project, 'TASK t1: build it', { changedFiles: ['src/a.js'] }))
  ok('the hook BLOCKS a redCommand that already passed before implementation', post.json?.decision === 'block', post.stdout.slice(0, 200))
  ok('the hook names it as not pinning the behaviour', /does not pin the behaviour/.test(post.json?.reason ?? ''), post.json?.reason)
}
{
  // ORDINARY TEST LITTER MUST NOT BLOCK. The post probe runs after the capture, so a command that
  // rewrites untracked-but-unignored files (.coverage, __pycache__) changes the whole-tree digest.
  // The first version of the mutation check compared digests and failed clean runs for exactly this.
  const session = nextSession()
  const project = projectFor()
  const src = join(project, 'src'); mkdirSync(src, { recursive: true })
  const goFlag = join(tmpdir(), `redgate-go-${process.pid}-${sessionCounter}.flag`)
  const redCommand = `test -e ${goFlag}`
  writeFileSync(expectationPath(sessionFlagKey({ session_id: session })), JSON.stringify({
    waveFingerprint: 'f'.repeat(64), projectDir: project, workflow: 'dev',
    tasks: { t1: { writablePaths: ['src/a.js'], outputs: ['src/a.js'], redCommand } },
  }))
  fire('pre', payloadFor(session, project, 'TASK t1: build it'))
  writeFileSync(join(src, 'a.js'), 'export const a = 1\n')
  writeFileSync(goFlag, 'go\n'); cleanup.push(goFlag)
  writeFileSync(join(project, 'coverage.xml'), 'litter\n')   // untracked, unignored: counted by the digest
  const post = fire('post', payloadFor(session, project, 'TASK t1: build it', { changedFiles: ['src/a.js'] }))
  ok('untracked test litter outside the declared paths does not block',
     !/modified declared output/.test(post.json?.reason ?? ''), post.json?.reason)
}

console.log(`\n${PASS}/${PASS + FAIL} passed`)
if (FAIL) throw new Error(`${FAIL} implement-observation contract check(s) failed`)
