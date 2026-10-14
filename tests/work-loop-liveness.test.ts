/**
 * work-loop.sh decides a round is dead by evidence of death, not by a registration deadline.
 *
 * A runner on a loaded machine can take longer than the dispatcher's 2 s sleep plus WORK_LOOP_SETTLE
 * to file its farm-events START. The loop must keep waiting while the runner PROCESS exists, and
 * still report "dispatch died with no verdict" promptly when it does not.
 *
 * Run: bun test tests/work-loop-liveness.test.ts
 */
import { expect, setDefaultTimeout, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'

setDefaultTimeout(60_000)
const mkTmp = useTmp()
const LOOP = join(import.meta.dir, '..', 'skills/work/scripts/work-loop.sh')

function world() {
  const dir = mkTmp('loop-live-')
  const run = join(dir, 'run'), tmp = join(dir, 'tmp')
  mkdirSync(run, { recursive: true }); mkdirSync(tmp, { recursive: true })
  writeFileSync(join(run, 'args.json'), '{}')
  writeFileSync(join(dir, 'plan.md'), '# plan\n')
  const env = { ...HERMETIC_ENV, TMPDIR: tmp, WORK_LOOP_POLL: '1', WORK_LOOP_SETTLE: '1' } as Record<string, string>
  const loop = () => spawn('bash', [LOOP, '--run-dir', run, '--plan', join(dir, 'plan.md'), '--loops', '1'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  return { dir, run, env, loop }
}
const collect = (c: ReturnType<typeof spawn>) => new Promise<{ code: number | null; err: string; ms: number }>(res => {
  let err = ''; const t0 = Date.now()
  c.stderr!.on('data', d => (err += d)); c.stdout!.resume()
  c.on('close', code => res({ code, err, ms: Date.now() - t0 }))
})

test('a round whose runner process is gone before START is reported dead quickly', async () => {
  const w = world()
  const r = await collect(w.loop())
  expect(r.code).toBe(1)
  expect(r.err).toContain('dispatch died with no verdict')
  expect(r.ms).toBeLessThan(15_000)
})

test('a live runner that has not registered keeps the round alive past the settle grace', async () => {
  const w = world()
  // Runner argv as the dispatchers spell it: ARGS RESULT CWD HOST. Never files a farm-events line.
  const runner = spawn('bash', ['-c', 'sleep 6; echo "{" > "$2"', 'work-round.sh', join(w.run, 'args.json'), join(w.run, 'result.json'), '/x', 'claude'], { stdio: 'ignore' })
  const r = await collect(w.loop())
  runner.kill()
  expect(r.err).not.toContain('dispatch died with no verdict')
  expect(r.ms).toBeGreaterThan(5_000)
})

test('an unrelated process naming result.json is not a runner', async () => {
  const w = world()
  const other = spawn('sleep', ['30', join(w.run, 'result.json')], { stdio: 'ignore' })
  const r = await collect(w.loop())
  other.kill()
  expect(r.code).toBe(1)
  expect(r.err).toContain('dispatch died with no verdict')
})
