/**
 * A held run whose loop died without a verdict is dropped, said once, and never holds the session.
 *
 * Measured 2026-10-03, session e3b75752 in ~/areas/secreg: the loop of 1002-slides-18-repair was
 * killed by SIGTERM at 07:3x. It left args.json, no result.json and no loop.exit — the exact shape
 * `inFlight` reads as "a round is being worked" — so its hold stayed queued as "in flight" with
 * nothing left alive to ever write a verdict.
 *
 * Death is read from records that already exist: the loop and the round each file a farm-events
 * stream named by their own pid, whose START line carries out=<run>/loop.exit or <run>/result.json.
 * A run is dead only when such a record exists and every pid in it is gone. With no record the run
 * keeps its old reading, in flight.
 *
 * Run: bun test tests/work-hold-dead-run.test.ts
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as hold from '../hooks/work-hold.ts'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'

setDefaultTimeout(60_000)
const mkTmp = useTmp()
const REPO = join(import.meta.dir, '..')
const ARM = join(REPO, 'skills/work/scripts/work-hold.sh')
const HOOK = join(REPO, 'hooks/work-hold.ts')
const SID = 'dead-run-test'

function world() {
  const dir = mkTmp('hold-dead-')
  const tmp = join(dir, 'tmp')
  mkdirSync(join(tmp, 'farm-events', SID), { recursive: true })
  return { dir, tmp, state: join(tmp, `work-hold-${SID}.json`), ledger: join(tmp, `work-hold-${SID}.releases.log`) }
}
type W = ReturnType<typeof world>

function runDir(w: W, name: string, done = false): string {
  const r = join(w.dir, 'runs', name)
  mkdirSync(r, { recursive: true })
  writeFileSync(join(r, 'args.json'), JSON.stringify({ planPath: `/plans/${name}.md`, specHash: name }))
  if (done) writeFileSync(join(r, 'result.json'), '{"overallPass":false}')
  return r
}

/** A pid that existed and is gone: a child that has already exited. */
function deadPid(): number {
  const r = spawnSync('bash', ['-c', 'echo $$'], { encoding: 'utf8', timeout: 10_000 })
  return Number(r.stdout.trim())
}

/** The loop's own farm-events record, as work-loop.sh writes it. */
function loopEvents(w: W, pid: number, out: string, done = false) {
  writeFileSync(
    join(w.tmp, 'farm-events', SID, `${pid}.ndjson`),
    `farm: START work-loop cwd=/x out=${out} expect=1 t=1\n` + (done ? 'farm: DONE work-loop rc=0\n' : ''),
  )
}

const env = (w: W) => ({ ...HERMETIC_ENV, TMPDIR: w.tmp, CLAUDE_CODE_SESSION_ID: SID, WORK_HOLD_COMPACT_WINDOW: '0' })
const arm = (w: W, check: string, run: string) =>
  spawnSync('bash', [ARM, check, '--run', run, '--rounds', '3', '--minutes', '60'], { encoding: 'utf8', timeout: 60_000, env: env(w) })
const stop = (w: W) =>
  spawnSync('bun', [HOOK], { input: JSON.stringify({ session_id: SID }), encoding: 'utf8', timeout: 60_000, env: env(w) })
const read = (w: W) => JSON.parse(readFileSync(w.state, 'utf8'))

describe('runDied', () => {
  test('loop killed: a record names the run, its pid is gone, no loop.exit, no result.json', () => {
    const w = world()
    const a = runDir(w, 'A')
    loopEvents(w, deadPid(), join(a, 'loop.exit'))
    const why = hold.runDied({ run: a }, SID, w.tmp)
    expect(why).toContain('no loop.exit')
  })

  test('a live pid keeps the run in flight', () => {
    const w = world()
    const a = runDir(w, 'A')
    loopEvents(w, process.pid, join(a, 'loop.exit'))
    expect(hold.runDied({ run: a }, SID, w.tmp)).toBeNull()
  })

  test('no record at all keeps the old reading: in flight, not dead', () => {
    const w = world()
    expect(hold.runDied({ run: runDir(w, 'A') }, SID, w.tmp)).toBeNull()
  })

  test('a verdict on disk is never a death', () => {
    const w = world()
    const a = runDir(w, 'A', true)
    loopEvents(w, deadPid(), join(a, 'loop.exit'))
    expect(hold.runDied({ run: a }, SID, w.tmp)).toBeNull()
  })

  test('a loop that exited without a verdict names its exit code', () => {
    const w = world()
    const a = runDir(w, 'A')
    writeFileSync(join(a, 'loop.exit'), '4\n')
    loopEvents(w, deadPid(), join(a, 'loop.exit'), true)
    expect(hold.runDied({ run: a }, SID, w.tmp)).toContain('exited 4')
  })

  test('the hold may name the run through a symlink the record resolved (craft -> work)', () => {
    const w = world()
    const a = runDir(w, 'A')
    const link = join(w.dir, 'craft')
    symlinkSync(join(w.dir, 'runs'), link)
    loopEvents(w, deadPid(), join(a, 'loop.exit'))
    expect(hold.runDied({ run: join(link, 'A') }, SID, w.tmp)).not.toBeNull()
  })

  test('a sibling run whose name extends this one is not this run', () => {
    const w = world()
    const a = runDir(w, 'A')
    const ab = runDir(w, 'A-b')
    loopEvents(w, deadPid(), join(ab, 'loop.exit'))
    expect(hold.runDied({ run: a }, SID, w.tmp)).toBeNull()
  })
})

describe('the Stop hook drops a dead run, says so once, and holds nothing on it', () => {
  test('a dead QUEUED run is dropped; the live hold still blocks and names it once', () => {
    const w = world()
    const dead = runDir(w, 'dead')
    const live = runDir(w, 'live', true)
    loopEvents(w, deadPid(), join(dead, 'loop.exit'))
    expect(arm(w, 'exit 1', dead).status).toBe(0)
    expect(arm(w, 'exit 1', live).status).toBe(0)
    expect(read(w).queued.map((q: any) => q.run)).toEqual([dead])

    const r1 = stop(w)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.decision).toBe('block')
    expect(o1.reason).toContain(dead)
    expect(o1.reason).toContain('died without a verdict')
    const s = read(w)
    expect(s.run).toBe(live)
    expect(s.queued ?? []).toEqual([])
    const ledger = readFileSync(w.ledger, 'utf8')
    expect(ledger).toContain(`\trun died\t${dead}`)
    // The state is still armed by the ledger's last word, so deleting it still restores the hold.
    expect(ledger.trim().split('\n').at(-1)!.split('\t')[1]).toBe('armed (pruned)')

    const r2 = stop(w)
    expect(JSON.parse(r2.stdout).decision).toBe('block')
    expect(r2.stdout).not.toContain(dead)
  })

  test('a dead run that is the only hold releases it, and the stop is allowed', () => {
    const w = world()
    const dead = runDir(w, 'dead')
    loopEvents(w, deadPid(), join(dead, 'loop.exit'))
    arm(w, 'exit 1', dead)
    const r = stop(w)
    expect(r.stdout).not.toContain('"decision":"block"')
    expect(JSON.parse(r.stdout).systemMessage).toContain('died without a verdict')
    expect(existsSync(w.state)).toBe(false)
    // Released, not removed: a later Stop must not restore it.
    expect(stop(w).stdout.trim()).toBe('')
    expect(existsSync(w.state)).toBe(false)
  })

  test('a run with no farm-events record is still held as in flight', () => {
    const w = world()
    const a = runDir(w, 'A')
    arm(w, 'exit 1', a)
    expect(stop(w).stdout.trim()).toBe('')
    expect(read(w).run).toBe(a)
  })
})
