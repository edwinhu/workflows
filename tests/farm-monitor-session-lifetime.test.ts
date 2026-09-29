/**
 * farm-monitor.sh must not outlive the session that started it.
 *
 * monitors/monitors.json declares it `always`, so every session that ends abnormally leaks one:
 * one ran 11 days reparented to init, polling a dead session's farm-events directory every 20s.
 *
 * The owning session is an ANCESTOR of the monitor (the harness runs monitors under a bash
 * wrapper), and it is identified by its EXECUTABLE — so the stand-in here is a copy of the bash
 * binary named `claude`, which is the shape `readlink /proc/<pid>/exe` sees for the real thing.
 *
 * Run: bun test /home/eh/projects/workflows/tests/farm-monitor-session-lifetime.test.ts
 */
import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, copyFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const MONITOR = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm-monitor.sh')
const SESSION = 'ffffffff-9999-8888-7777-666666666666'
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim()

const scratch: string[] = []
const spawnedPids: number[] = []
afterAll(() => {
  for (const p of spawnedPids) { try { process.kill(p, 'SIGKILL') } catch {} }
  scratch.forEach((d) => rmSync(d, { recursive: true, force: true }))
})

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(pred: () => boolean, ms = 6000): Promise<boolean> {
  for (let i = 0; i * 100 < ms; i++) { if (pred()) return true; await sleep(100) }
  return pred()
}

/**
 * Builds: claude(stand-in) → inner → farm-monitor.sh, each a separate process, so killing any one
 * of the three isolates one exit path. `inner` sleeps rather than waits, so it survives the monitor
 * and a monitor exit cannot be confused for its parent having died.
 */
async function tree(prefix: string) {
  const d = mkdtempSync(join(tmpdir(), `${prefix}-`)); scratch.push(d)
  const claude = join(d, 'claude')
  copyFileSync(BASH, claude); chmodSync(claude, 0o755)

  const inner = join(d, 'inner.sh')
  writeFileSync(inner, `#!/usr/bin/env bash\nbash ${JSON.stringify(MONITOR)} >${JSON.stringify(join(d, 'out.txt'))} 2>&1 &\necho $! > ${JSON.stringify(join(d, 'mon.pid'))}\nsleep 120\n`)
  const outer = join(d, 'outer.sh')
  writeFileSync(outer, `#!/usr/bin/env bash\nbash ${JSON.stringify(inner)} &\necho $! > ${JSON.stringify(join(d, 'inner.pid'))}\nsleep 120\n`)

  const child = spawn(claude, [outer], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, TMPDIR: d, CLAUDE_CODE_SESSION_ID: SESSION, FARM_MONITOR_POLL_SECONDS: '1' },
  })
  spawnedPids.push(child.pid!)

  const pidFile = (n: string) => Number(readFileSync(join(d, n), 'utf8').trim())
  expect(await waitFor(() => existsSync(join(d, 'mon.pid')) && existsSync(join(d, 'inner.pid')))).toBe(true)
  const mon = pidFile('mon.pid'); const innerPid = pidFile('inner.pid')
  spawnedPids.push(mon, innerPid)
  // Give the monitor a poll to get into its loop before anything is killed.
  await sleep(300)
  expect(alive(mon)).toBe(true)
  return { d, claudePid: child.pid!, innerPid, mon }
}

test('the monitor keeps polling while its session process lives', async () => {
  const { mon } = await tree('mon-alive')
  await sleep(2500)                 // two-plus polls at FARM_MONITOR_POLL_SECONDS=1
  expect(alive(mon)).toBe(true)
}, 30_000)

test('the monitor exits within two polls once the owning claude process is gone', async () => {
  const { claudePid, innerPid, mon } = await tree('mon-owner-gone')
  process.kill(claudePid, 'SIGKILL')
  expect(await waitFor(() => !alive(mon), 6000)).toBe(true)
  // Its own parent was alive the whole time, so it was the ancestor check that fired, not ppid 1.
  expect(alive(innerPid)).toBe(true)
}, 30_000)

test('the monitor exits once reparented to init, even with the session process alive', async () => {
  const { claudePid, innerPid, mon } = await tree('mon-orphan')
  process.kill(innerPid, 'SIGKILL')  // monitor reparents to pid 1
  expect(await waitFor(() => !alive(mon), 6000)).toBe(true)
  expect(alive(claudePid)).toBe(true)
}, 30_000)

test('it exits silently — a dead session gets no farewell line', async () => {
  const { d, claudePid, mon } = await tree('mon-silent')
  process.kill(claudePid, 'SIGKILL')
  expect(await waitFor(() => !alive(mon), 6000)).toBe(true)
  expect(readFileSync(join(d, 'out.txt'), 'utf8')).toBe('')
}, 30_000)

test('the shipped poll interval is still 20s', () => {
  // The env var exists for tests; a default drift would change every session's wake cadence.
  expect(readFileSync(MONITOR, 'utf8')).toContain('FARM_MONITOR_POLL_SECONDS:-20')
})
