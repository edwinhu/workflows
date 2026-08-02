// Observation records must not accumulate forever — and pruning must never touch a live wave.
//
// THE LEAK: nothing pruned this directory. Measured on a live machine: 2,375 files, four more per
// task, forever — each carrying a project path, a task id and a changed-file inventory, in a
// world-readable temp directory. It also made the gate's unexpected-dispatch scan linear in the
// lifetime of the machine rather than in the size of the wave.
//
// THE HAZARD, which is worse than the leak: pruning evidence out from under a running wave produces
// `missing-pre` / `no-expectation` — failures indistinguishable from the enforcement bug this whole
// subsystem exists to prevent, caused by housekeeping. The first version of this fix had exactly
// that defect twice over, both found by an adversarial review:
//
//   - it pruned EXPECTATION files, so a wave resumed after the window lost its authentication and
//     every later dispatch was refused as unauthenticated;
//   - it claimed "pre-phase only" in a comment while calling unconditionally, so a post-hook could
//     delete the expectation and pre-record moments before writing the post-record.
//
// Hence: time-based (a count cap could evict a live wave), expectations exempt, current session
// exempt, pre-phase only.
//
// Run: bun tests/observation-pruning.test.mjs
import { mkdirSync, writeFileSync, existsSync, utimesSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OBSERVATION_DIR, pruneObservations } from '../hooks/work-implement-observation.ts'

let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

mkdirSync(OBSERVATION_DIR, { recursive: true })
const stamp = process.pid
const ancient = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
const made = []
const make = (name, aged) => {
  const path = join(OBSERVATION_DIR, name)
  writeFileSync(path, '{}')
  if (aged) utimesSync(path, ancient, ancient)
  made.push(path)
  return path
}

try {
  const mySession = `prune-mine-${stamp}`
  const fresh  = make(`prune-other-${stamp}--fresh.json`, false)
  const stale  = make(`prune-other-${stamp}--stale.json`, true)
  // Authentication, not evidence: a wave resumed after the window still needs it.
  const expect = make(`prune-other-${stamp}--expectation.json`, true)
  // Belongs to the run happening right now, however old its early tasks are.
  const mine   = make(`${mySession}--old-but-mine.json`, true)

  const removed = pruneObservations(mySession)

  ok('a stale foreign record is removed', !existsSync(stale))
  ok('a fresh record survives', existsSync(fresh))
  ok('an EXPECTATION is never pruned, however old', existsSync(expect))
  ok("the current session's own old records are never pruned", existsSync(mine))
  ok('it reports how many it removed', typeof removed === 'number' && removed >= 1, String(removed))

  // Hygiene must never break a run.
  let threw = false
  try { pruneObservations(mySession) } catch { threw = true }
  ok('pruning twice is safe', !threw)
  let threwEmpty = false
  try { pruneObservations('') } catch { threwEmpty = true }
  ok('an empty session id does not throw', !threwEmpty)
} finally {
  for (const path of made) rmSync(path, { force: true })
}

// THE CALL SITE MUST BE PRE-PHASE ONLY. A comment claiming it was, while the call sat outside the
// phase check, is how the post-hook defect shipped in the first version — so assert the guard, not
// the comment.
{
  const source = readFileSync(new URL('../hooks/work-implement-observation.ts', import.meta.url), 'utf8')
  ok('pruning is guarded by the pre phase at its call site',
     /if \(phase === "pre"\) pruneObservations\(/.test(source),
     'pruneObservations must be called only when phase === "pre"')
}

console.log(`\n${PASS}/${PASS + FAIL} passed`)
if (FAIL) process.exit(1)
