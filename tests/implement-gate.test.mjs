// The IMPLEMENT gate must REFUSE on absence, not pass on it.
//
// This is the assertion that makes the observation hook's fail-open design safe. The hook never
// denies a dispatch on its own malfunction — correct, because a gate that denies on its own bugs is
// worse than no gate — and that is only tolerable because a missing record is a HARD failure here.
// Every case below is a shape where the naive gate ("no violations recorded, therefore clean") would
// return PASS on a run that observed nothing.
//
// The v5.106.0 defect is the first case: the hook was registered nowhere, so no record existed for
// any task, and nothing anywhere treated that as a problem.
//
// Run: bun tests/implement-gate.test.mjs
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { gateWave } from '../scripts/beat/implement-gate.ts'
import { OBSERVATION_DIR, expectationPath, recordPath } from '../hooks/work-implement-observation.ts'
import { sessionFlagKey } from '../hooks/_gate_common.ts'

let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

const written = []
let counter = 0
const nextSession = () => `gate-session-${++counter}-${process.pid}`
const key = session => sessionFlagKey({ session_id: session })
const FP = 'a'.repeat(64)

function write(path, body) {
  mkdirSync(OBSERVATION_DIR, { recursive: true })
  writeFileSync(path, JSON.stringify(body))
  written.push(path)
}

function scenario({ tasks = { a: { writablePaths: ['src/a.js'], outputs: ['src/a.js'] } }, records = {} } = {}) {
  const session = nextSession()
  write(expectationPath(key(session)), { waveFingerprint: FP, projectDir: '/tmp/x', workflow: 'ds', tasks })
  for (const [taskId, phases] of Object.entries(records)) {
    for (const [phase, body] of Object.entries(phases)) {
      write(recordPath(key(session), FP, taskId, phase), body)
    }
  }
  return gateWave(session)
}

const observed = { status: 'observed', digest: 'd' }
const cleanRun = { pre: observed, post: observed, adjudication: { status: 'clean', violations: [], changedPaths: ['src/a.js'] } }

console.log('a fully observed, clean wave passes')
{
  const result = scenario({ records: { a: cleanRun } })
  ok('a clean wave passes', result.ok === true, JSON.stringify(result.verdicts))
  ok('the passing verdict names the reason', result.verdicts[0].reason === 'clean')
}

// THE v5.106.0 DEFECT. The hook was registered nowhere, so this is what every run looked like:
// an expectation on disk and not one record beside it.
console.log('an unobserved wave is REFUSED, not passed')
{
  const result = scenario({ records: {} })
  ok('a wave with no records at all is refused', result.ok === false)
  ok('the refusal names the missing baseline', result.verdicts[0].reason === 'missing-pre', JSON.stringify(result.verdicts))
}

console.log('a wave with no expectation at all is REFUSED')
{
  const session = nextSession()
  const result = gateWave(session)
  ok('no expectation is a refusal, not "nothing to check"', result.ok === false)
  ok('the refusal says the preflight did not run', result.verdicts[0].reason === 'no-expectation', JSON.stringify(result.verdicts))
  ok('the refusal explains that nothing was bounded', /nothing was bounded/.test(result.verdicts[0].detail || ''))
}

console.log('an expectation naming ZERO tasks is REFUSED')
{
  // `{}` is truthy, so a zero-task expectation walked past the `!expectation?.tasks` guard, produced
  // an empty `verdicts`, and `[].every(...)` returned true — the gate's strongest claim ("everything
  // expected was observed and clean") asserted over nothing at all. Reached from the other end by
  // preflight accepting an empty readyWave; both layers now refuse, so neither depends on the other.
  const result = scenario({ tasks: {} })
  ok('a zero-task expectation is a refusal, not a vacuous pass', result.ok === false, JSON.stringify(result.verdicts))
  ok('the refusal names it as an expectation problem', result.verdicts[0].reason === 'no-expectation', JSON.stringify(result.verdicts))
  ok('the refusal distinguishes zero tasks from a missing expectation', /zero tasks/.test(result.verdicts[0].detail || ''), result.verdicts[0].detail)
}

console.log('a declared redCommand is adjudicated from EXIT CODES, not from an agent report')
{
  // dev asserted TDD in four SKILL.md files and enforced it in none: nothing recorded whether a test
  // ran before the implementation or whether it failed, so an implementer could skip the RED step,
  // produce exactly the declared files, and pass. The command now runs in the hook — outside the party
  // being judged — and the gate reads the exit codes it observed.
  const RED = { writablePaths: ['src/a.js'], outputs: ['src/a.js'], redCommand: 'bun test x' }
  const probe = (exitCode, extra = {}) => ({ command: 'bun test x', exitCode, timedOut: false, tail: '', ...extra })

  const good = scenario({ tasks: { a: RED }, records: { a: {
    pre: { ...observed, redProbe: probe(1) }, post: { ...observed, redProbe: probe(0) },
    adjudication: { status: 'clean', violations: [], changedPaths: ['src/a.js'] } } } })
  ok('fails before and passes after is the only clean path', good.ok === true, JSON.stringify(good.verdicts))

  const skipped = scenario({ tasks: { a: RED }, records: { a: cleanRun } })
  ok('a declared redCommand that never ran is refused', skipped.ok === false)
  ok('the refusal says the command was never executed', skipped.verdicts[0].reason === 'red-unproven', JSON.stringify(skipped.verdicts))

  // The vacuous green: a test that ALREADY passed pins nothing, so implementing against it proves
  // nothing either. This is the shape a self-reported "RED confirmed" can never rule out.
  const alreadyGreen = scenario({ tasks: { a: RED }, records: { a: {
    pre: { ...observed, redProbe: probe(0) }, post: { ...observed, redProbe: probe(0) },
    adjudication: { status: 'clean', violations: [], changedPaths: ['src/a.js'] } } } })
  ok('a redCommand that passed BEFORE implementation is refused', alreadyGreen.ok === false)
  ok('the refusal names it as not-red', alreadyGreen.verdicts[0].reason === 'red-not-red', JSON.stringify(alreadyGreen.verdicts))

  const stillFailing = scenario({ tasks: { a: RED }, records: { a: {
    pre: { ...observed, redProbe: probe(1) }, post: { ...observed, redProbe: probe(1) },
    adjudication: { status: 'clean', violations: [], changedPaths: ['src/a.js'] } } } })
  ok('a redCommand still failing after implementation is refused', stillFailing.ok === false)
  ok('the refusal names it as not-green', stillFailing.verdicts[0].reason === 'green-not-green', JSON.stringify(stillFailing.verdicts))

  // A timeout is NOT a failure-and-therefore-a-valid-RED. "The suite never finished" says nothing
  // about whether the behaviour is absent, and reading it as RED would make hanging the easiest pass.
  const hung = scenario({ tasks: { a: RED }, records: { a: {
    pre: { ...observed, redProbe: probe(null, { timedOut: true }) }, post: { ...observed, redProbe: probe(0) },
    adjudication: { status: 'clean', violations: [], changedPaths: ['src/a.js'] } } } })
  ok('a timed-out redCommand is unproven, never a valid RED', hung.ok === false && hung.verdicts[0].reason === 'red-unproven', JSON.stringify(hung.verdicts))

  // The command is read from the AUTHENTICATED expectation. A probe that ran something else — an
  // easier command substituted anywhere downstream — is not evidence about the declared one.
  const swapped = scenario({ tasks: { a: RED }, records: { a: {
    pre: { ...observed, redProbe: { command: 'true', exitCode: 1, timedOut: false, tail: '' } }, post: { ...observed, redProbe: probe(0) },
    adjudication: { status: 'clean', violations: [], changedPaths: ['src/a.js'] } } } })
  ok('a probe of a DIFFERENT command cannot satisfy the declared one', swapped.ok === false && swapped.verdicts[0].reason === 'red-unproven', JSON.stringify(swapped.verdicts))

  // Absent redCommand keeps the pre-existing behaviour: ds and work plans are unaffected.
  const noRed = scenario({ records: { a: cleanRun } })
  ok('a task with no redCommand is unaffected', noRed.ok === true)
}

console.log('each distinct cause is reported distinctly — they have distinct remedies')
for (const [name, records, expected] of [
  ['missing post observation', { a: { pre: observed } }, 'missing-post'],
  ['observed but never judged', { a: { pre: observed, post: observed } }, 'missing-adjudication'],
  ['our own machinery failed', { a: { pre: { status: 'observation-failed', reason: 'git exploded' } } }, 'observation-failed'],
  ['the plan is malformed', { a: { pre: observed, post: observed, adjudication: { status: 'not-adjudicable', reason: 'plan declares output outside authority' } } }, 'not-adjudicable'],
  ['the agent violated', { a: { pre: observed, post: observed, adjudication: { status: 'violated', violations: ['outside writable authority'] } } }, 'violated'],
]) {
  const result = scenario({ records })
  ok(`${name} -> ${expected}`, result.ok === false && result.verdicts[0].reason === expected, JSON.stringify(result.verdicts))
}

// Order matters. A task with no pre-observation also has no meaningful adjudication; naming the
// adjudication would send someone to the wrong end of the problem.
console.log('the earliest failure is the one reported')
{
  const result = scenario({ records: { a: { post: observed, adjudication: { status: 'violated', violations: ['x'] } } } })
  ok('a missing baseline outranks a downstream verdict', result.verdicts[0].reason === 'missing-pre', JSON.stringify(result.verdicts))
}

console.log('every expected task must be accounted for, not just one')
{
  const result = scenario({
    tasks: {
      a: { writablePaths: ['src/a.js'], outputs: ['src/a.js'] },
      b: { writablePaths: ['src/b.js'], outputs: ['src/b.js'] },
    },
    records: { a: cleanRun },
  })
  ok('one clean task does not carry an unobserved sibling', result.ok === false)
  ok('both tasks are adjudicated', result.expected.join(',') === 'a,b')
  ok('the clean one is still reported clean', result.verdicts.find(v => v.taskId === 'a')?.reason === 'clean')
  ok('the unobserved one is named', result.verdicts.find(v => v.taskId === 'b')?.reason === 'missing-pre', JSON.stringify(result.verdicts))
}

console.log('a record from a different wave cannot satisfy this one')
{
  const session = nextSession()
  write(expectationPath(key(session)), { waveFingerprint: FP, projectDir: '/tmp/x', workflow: 'ds', tasks: { a: { writablePaths: ['src/a.js'], outputs: ['src/a.js'] } } })
  // Same session, same task id, DIFFERENT wave — a resumed run, or the phase run twice.
  for (const [phase, body] of Object.entries(cleanRun)) {
    write(recordPath(key(session), 'b'.repeat(64), 'a', phase), body)
  }
  const result = gateWave(session)
  ok('another wave\'s clean records do not satisfy this wave', result.ok === false && result.verdicts[0].reason === 'missing-pre', JSON.stringify(result.verdicts))
}

for (const path of written) rmSync(path, { force: true })
console.log(`\n${PASS}/${PASS + FAIL} passed`)
if (FAIL) throw new Error(`${FAIL} implement-gate check(s) failed`)
