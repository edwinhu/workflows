import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const FARM = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm.sh')

// --workflow is the ONLY mode craft-dispatch.sh and craft-redispatch.sh use. Every other test
// in this repo drives --tasks, so the production path shipped unverified.
function workflowRun() {
  const tmp = mkdtempSync(join(tmpdir(), 'wfmode-'))
  const bin = join(tmp, 'bin'); mkdirSync(bin, { recursive: true })
  const out = join(tmp, 'result.json')
  writeFileSync(join(bin, 'claude-code'),
    `#!/usr/bin/env bash\nprintf '{}\\n' > "${out}"\nprintf '{"type":"result","result":"ok"}\\n'\n`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  const wf = join(tmp, 'wf.js'); writeFileSync(wf, 'export const meta = { name: "x", description: "x" }\n')
  const res = spawnSync('bash', [FARM, '--workflow', wf, '--out', out, '--cwd', tmp], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp, FARM_OUT_CHILD: '1' },
  })
  const dir = join(tmp, 'farm-events')
  const lines = readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n')).filter(Boolean)
  rmSync(tmp, { recursive: true, force: true })
  return { res, lines, out }
}

test('a --workflow dispatch emits a START line carrying out=<the --out path>', () => {
  const { lines, out } = workflowRun()
  const starts = lines.filter((l) => l.includes(' START '))
  expect(starts.length).toBeGreaterThan(0)
  expect(starts.some((l) => l.includes(`out=${out}`))).toBe(true)
})

test('a --workflow dispatch emits a DONE line', () => {
  const { lines } = workflowRun()
  expect(lines.some((l) => l.includes(' DONE '))).toBe(true)
})
