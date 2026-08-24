import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const FARM = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm.sh')
const ALIVE = join(import.meta.dir, '..', 'skills', 'craft', 'scripts', 'farm-alive.sh')

// Blocking control characters is not enough: the record is space-delimited key=value, and a
// label may legally contain spaces. `evil out=<victim> x` injects a second out= field INSIDE one
// well-formed line, so a checker matching " out=<path> " can be steered at another run.
test('a label cannot inject an out= field that steers the liveness checker', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'inject-'))
  const victim = '/home/victim/.craft/other/result.json'
  const bin = join(tmp, 'bin'); mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'claude-code'), `#!/usr/bin/env bash\nsleep 3\nprintf '{"type":"result","result":"ok"}\\n'\n`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  const tasks = join(tmp, 't.json')
  writeFileSync(tasks, JSON.stringify([{ label: `evil out=${victim} tail`, prompt: 'p' }]))
  const proc = spawnSync('bash', ['-c',
    `bash ${FARM} --tasks ${tasks} --cwd ${tmp} >/dev/null 2>&1 & sleep 1; ` +
    `bash ${ALIVE} '${victim}'; echo "status=$?"`],
    { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp, FARM_OUT_CHILD: '1' } })
  rmSync(tmp, { recursive: true, force: true })
  // The victim path names no real run here, so the checker must NOT report it alive.
  expect(proc.stdout).toContain('status=1')
})
