import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync, readdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const FARM = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm.sh')

// Nothing in the repo ever deletes farm-events files: farm.sh appends, farm-alive.sh and
// farm-monitor.sh only read. The liveness checker greps every file in the directory on each
// poll, so the cost of a check grows with every farm.sh invocation ever made on the machine.
test('a run evicts stale event files for pids that are long gone', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'evict-'))
  const evd = join(tmp, 'farm-events'); mkdirSync(evd, { recursive: true })
  const old = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  for (let i = 0; i < 40; i++) {
    const f = join(evd, `99${i}000.ndjson`)          // pids that do not exist
    writeFileSync(f, 'farm: START stale cwd=/x out= expect=0\nfarm: DONE stale ok toolCalls=0\n')
    utimesSync(f, old, old)
  }
  const bin = join(tmp, 'bin'); mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'claude-code'), `#!/usr/bin/env bash\nprintf '{"type":"result","result":"ok"}\\n'\n`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  const tasks = join(tmp, 't.json'); writeFileSync(tasks, JSON.stringify([{ label: 'r', prompt: 'p' }]))
  spawnSync('bash', [FARM, '--tasks', tasks, '--cwd', tmp],
    { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp, FARM_OUT_CHILD: '1' } })
  const left = readdirSync(evd).length
  rmSync(tmp, { recursive: true, force: true })
  expect(left).toBeLessThan(41)   // the 40 stale ones must not all survive alongside the new one
})
