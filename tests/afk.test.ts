/**
 * /afk: arm.sh computes the ceiling to 09:00 and arms a check-less hold; work-hold.ts lets an
 * afk-origin hold yield to this session's live owned runs and leaves other holds alone.
 *
 * Run: bun test tests/afk.test.ts
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { judgeContext } from '../hooks/early-stop.ts'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'

setDefaultTimeout(60_000)
const mkTmp = useTmp()
const REPO = join(import.meta.dir, '..')
const ARM = join(REPO, 'skills/afk/scripts/arm.sh')
const HOLD = join(REPO, 'skills/work/scripts/work-hold.sh')
const HOOK = join(REPO, 'hooks/work-hold.ts')
const SID = 'afk-test'

function world() {
  const tmp = mkTmp('afk-')
  mkdirSync(join(tmp, 'farm-events', SID), { recursive: true })
  return { tmp, state: join(tmp, `work-hold-${SID}.json`) }
}
type W = ReturnType<typeof world>
const env = (w: W, extra: Record<string, string> = {}) =>
  ({ ...HERMETIC_ENV, TMPDIR: w.tmp, WORK_HOLD_COMPACT_WINDOW: '0', CLAUDE_CODE_SESSION_ID: SID, ...extra })
const arm = (w: W, now: string, args: string[] = [SID, 'ship the thing']) =>
  spawnSync('bash', [ARM, ...args], { encoding: 'utf8', timeout: 60_000, env: env(w, { AFK_NOW: now }) })
const stop = (w: W) =>
  spawnSync('bun', [HOOK], { input: JSON.stringify({ session_id: SID }), encoding: 'utf8', timeout: 60_000, env: env(w) })
const read = (w: W) => JSON.parse(readFileSync(w.state, 'utf8'))
const liveRun = (w: W, label = 'work-loop') =>
  writeFileSync(join(w.tmp, 'farm-events', SID, `${process.pid}.ndjson`),
    `farm: START ${label} cwd=/x out=/nonexistent/loop.exit expect=1 t=${Math.floor(Date.now() / 1000)}\n`)
const beacon = (w: W) =>
  writeFileSync(join(w.tmp, 'farm-events', SID, 'watcher.alive'), `${Math.floor(Date.now() / 1000)}\n`)

describe('arm.sh ceiling', () => {
  for (const [now, minutes] of [['23:30', 570], ['02:00', 420], ['08:30', 60], ['12:00', 1260]] as const) {
    test(`${now} -> ${minutes} minutes`, () => {
      const w = world()
      const r = arm(w, now)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('afk hold armed until')
      const s = read(w)
      expect(s.ceilingMinutes).toBe(minutes)
      expect(s.check).toBe('')
      expect(s.origin).toBe('afk')
      expect(s.goal).toContain('Afk mandate: ship the thing.')
      expect(s.maxRounds).toBeGreaterThanOrEqual(1440)
    })
  }

  test('no objective defaults the goal text', () => {
    const w = world()
    expect(arm(w, '23:30', [SID]).status).toBe(0)
    expect(read(w).goal).toContain('everything queued before sign-off')
  })
})

describe('arm.sh refusals', () => {
  test('missing session id: non-zero, nothing armed', () => {
    const w = world()
    const r = arm(w, '23:30', [])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('Not armed')
    expect(r.stdout).not.toContain('armed until')
  })

  test('idempotent: a second call prints status and changes nothing', () => {
    const w = world()
    expect(arm(w, '23:30').status).toBe(0)
    const before = readFileSync(w.state, 'utf8')
    const r = arm(w, '02:00')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('already armed')
    expect(r.stdout).toContain('hold: ARMED')
    expect(readFileSync(w.state, 'utf8')).toBe(before)
  })

  test('a live grind loop refuses and arms nothing', () => {
    const w = world()
    writeFileSync(join(w.tmp, 'farm-events', SID, `${process.pid}.ndjson`), 'grind: START grind%20j.jsonl cwd=/x journal=/j \n')
    const r = arm(w, '23:30')
    expect(r.status).toBe(3)
    expect(r.stderr).toContain('grind loop')
    expect(Bun.file(w.state).size).toBe(0)
  })

  test('a finished grind loop does not block arming', () => {
    const w = world()
    writeFileSync(join(w.tmp, 'farm-events', SID, `${process.pid}.ndjson`),
      'grind: START grind%20j.jsonl cwd=/x journal=/j \ngrind: DONE done rc=0\n')
    expect(arm(w, '23:30').status).toBe(0)
  })
})

describe('work-hold.ts afk allow rule', () => {
  const armHold = (w: W, origin: string[]) =>
    spawnSync('bash', [HOLD, '--goal', 'Afk mandate: t. Met only when done.', '--minutes', '600', '--rounds', '1500', ...origin],
      { encoding: 'utf8', timeout: 60_000, env: env(w) })

  test('live owned run + fresh beacon: allow, no round counted', () => {
    const w = world()
    expect(armHold(w, ['--origin', 'afk']).status).toBe(0)
    liveRun(w); beacon(w)
    const r = stop(w)
    expect(r.stdout.trim()).toBe('')
    expect(read(w).rounds).toBe(0)
  })

  test('no live run: the normal path is taken (a round is counted or a block issued)', () => {
    const w = world()
    expect(armHold(w, ['--origin', 'afk']).status).toBe(0)
    beacon(w)
    stop(w)
    const s = read(w)
    expect(s.rounds + (s.history ?? []).length).toBeGreaterThan(0)
  })

  test('live run but no watcher beacon: normal path', () => {
    const w = world()
    expect(armHold(w, ['--origin', 'afk']).status).toBe(0)
    liveRun(w)
    stop(w)
    expect(read(w).rounds).toBeGreaterThan(0)
  })

  test('a hold armed under the pre-rename origin "overnight" still yields to a live run', () => {
    const w = world()
    expect(armHold(w, ['--origin', 'overnight']).status).toBe(0)
    liveRun(w); beacon(w)
    expect(stop(w).stdout.trim()).toBe('')
    expect(read(w).rounds).toBe(0)
  })

  test('a non-afk hold is unchanged by a live run', () => {
    const w = world()
    expect(armHold(w, []).status).toBe(0)
    expect(read(w).origin).toBeUndefined()
    liveRun(w); beacon(w)
    stop(w)
    expect(read(w).rounds).toBeGreaterThan(0)
  })
})

describe('"overnight" alone never triggers /afk', () => {
  test('the skill description has no bare "overnight" trigger', () => {
    const fm = readFileSync(join(REPO, 'skills/afk/SKILL.md'), 'utf8').split('---')[1]
    const desc = /^description:\s*"(.*)"\s*$/m.exec(fm)![1]
    const triggers = desc.split(/\. NOT for/)[0].replace(/^Use when the user says /, '')
    const quoted = triggers.replace(/^'|'$/g, '').split(/',\s+(?:or\s+)?'/).map((q) => q.toLowerCase())
    expect(quoted).toContain('/afk')
    expect(quoted).not.toContain('overnight')
    expect(quoted.filter((q) => q.includes('overnight'))).toEqual(['work on this overnight'])
  })

  test('STANDING does not match finance talk about overnight', () => {
    const at = '2026-10-07T01:00:00.000Z'
    const human = (text: string) =>
      JSON.stringify({ type: 'user', uuid: 'u1', timestamp: at, origin: { kind: 'human' }, message: { role: 'user', content: text } })
    for (const t of ["let's study overnight returns", 'compute overnight returns for SPY', 'the overnight rate rose'])
      expect(judgeContext(human(t)).standing).toBeNull()
  })
})
