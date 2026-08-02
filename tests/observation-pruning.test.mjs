// Observation records must not accumulate forever.
//
// Nothing pruned this directory. Measured on a live machine: 2,375 files, four more per task,
// forever — each carrying a project path, a task id and a changed-file inventory, in a
// world-readable temp directory. It also made the gate's unexpected-dispatch scan linear in the
// lifetime of the machine rather than in the size of the wave.
//
// The retention rule is TIME-based on purpose. A count cap could evict a live wave's pre-observation
// — the gate reads records the paired hook wrote moments earlier — turning a clean run into
// `missing-pre`. That failure would look exactly like the enforcement bug this whole subsystem
// exists to prevent, caused by housekeeping.
//
// Run: bun tests/observation-pruning.test.mjs
import { mkdirSync, writeFileSync, existsSync, utimesSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { OBSERVATION_DIR, pruneObservations } from '../hooks/work-implement-observation.ts'

let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

mkdirSync(OBSERVATION_DIR, { recursive: true })
const tag = `prune-test-${process.pid}`
const fresh = join(OBSERVATION_DIR, `${tag}--fresh.json`)
const stale = join(OBSERVATION_DIR, `${tag}--stale.json`)
try {
  writeFileSync(fresh, '{}'); writeFileSync(stale, '{}')
  // 30 days old, comfortably past the 7-day window.
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  utimesSync(stale, old, old)

  const removed = pruneObservations()
  ok('a stale record is removed', !existsSync(stale))
  ok('a fresh record SURVIVES — evicting a live wave would fake a missing-pre', existsSync(fresh))
  ok('it reports how many it removed', typeof removed === 'number' && removed >= 1, String(removed))

  // Hygiene must never break a run: an unreadable or absent directory is not an error.
  let threw = false
  try { pruneObservations() } catch { threw = true }
  ok('pruning twice is safe', !threw)
} finally {
  rmSync(fresh, { force: true }); rmSync(stale, { force: true })
}

console.log(`\n${PASS}/${PASS + FAIL} passed`)
if (FAIL) process.exit(1)
