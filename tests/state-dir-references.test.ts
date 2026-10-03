import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * The work run root is ~/.local/state/work. The pre-rename `craft` root beside it survives only as
 * a symlink shim (teaching docs/decisions/0002-work-run-state-dir.md); a live reference to it would
 * keep the shim alive forever. The literal is split so this file does not match itself.
 *
 * HISTORY is the only exemption: CHANGELOG, and the tests that replay the 2026-10-02 secreg
 * lecture-18 evidence verbatim, where the old path is what the event files and the incident said.
 */
const root = join(import.meta.dir, '..')
const stale = 'state/' + 'craft'
const HISTORY = new Set([
  'CHANGELOG.md',
  'tests/farm-watch-runs.test.ts',
  'hooks/mod-tests/watcher.test.ts',
  'skills/work/scripts/work-pending-approval.test.ts',
])

test('no tracked file outside recorded history names the retired craft run root', () => {
  const r = spawnSync('git', ['grep', '-I', '-n', '-F', stale], { cwd: root, encoding: 'utf8', timeout: 30_000 })
  // git grep exits 1 for no match; anything else is a failure to search, never a pass.
  expect([0, 1]).toContain(r.status)
  const hits = r.stdout.split('\n').filter(Boolean).filter(l => !HISTORY.has(l.slice(0, l.indexOf(':'))))
  expect(hits).toEqual([])
})

test('the exemptions still hold the literal, so none outlives its reason', () => {
  for (const f of HISTORY) {
    const r = spawnSync('git', ['grep', '-q', '-F', stale, '--', f], { cwd: root, timeout: 30_000 })
    expect([f, r.status]).toEqual([f, 0])
  }
})
