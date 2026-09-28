import { test, expect, setDefaultTimeout } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Tests in this file drive work-dispatch.sh as a real bash subprocess. Bun's 5s per-test default
// is a budget for that subprocess plus whatever else the machine is doing, so under parallel load
// these go red at exactly [5000.xx ms] — contention reported as a defect in the code under test.
// 60s does not hide a hang (a hang never returns and is caught by any finite ceiling); it stops
// standing in for a latency budget this suite never had. Set per file because bun 1.4.0 ignores
// `[test] timeout` in bunfig.toml and applies a preload's setDefaultTimeout to the first file only.
setDefaultTimeout(60_000)

const FARM = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm.sh')

// --workflow is the ONLY mode work-dispatch.sh and work-redispatch.sh use. Every other test
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
    // CLAUDE_CODE_SESSION_ID is pinned empty, not inherited: the event dir is keyed by it, and
    // `bun test` itself runs inside a session, so an ambient value moves the dir under the runner.
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp, FARM_OUT_CHILD: '1', CLAUDE_CODE_SESSION_ID: '' },
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
