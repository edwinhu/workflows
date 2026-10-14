/**
 * scripts/test.sh fails a run when a test leaves a farm-events stream naming the run's fixtures in a
 * real event root. The run's own TMPDIR is checked empty already, but a child spawned with no TMPDIR
 * writes to /tmp/farm-events/<session>/<pid>.ndjson, which that check cannot see: grind-wait.test.ts
 * left 473 such files (2026-10-14) and the guard reported ok throughout.
 */
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()
const ROOT = dirname(import.meta.dir)

function runProbe(body: string) {
  const dir = mkTmp('test-sh-event-guard-')
  const probe = join(dir, 'probe.test.ts')
  writeFileSync(probe, `import { test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
test('probe', () => { ${body} })
`)
  return spawnSync('bash', [join(ROOT, 'scripts', 'test.sh'), probe], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: process.env,
  })
}

test('a stream naming the run\'s TMPDIR in the real /tmp/farm-events fails the run', () => {
  const sess = `event-guard-probe-${process.pid}`
  const dir = `/tmp/farm-events/${sess}`
  try {
    const r = runProbe(`mkdirSync('${dir}', { recursive: true })
      writeFileSync('${dir}/1.ndjson', 'grind: START j journal=' + process.env.TMPDIR + '/x/journal.jsonl\\n')`)
    const out = `${r.stdout}\n${r.stderr}`
    expect(out).toContain('EVENT GUARD FAILED')
    expect(out).toContain(`${dir}/1.ndjson`)
    expect(r.status, out).not.toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 150_000)

test('a stream that names no fixture of the run, and a run that writes none, pass', () => {
  const sess = `event-guard-probe-${process.pid}-real`
  const dir = `/tmp/farm-events/${sess}`
  try {
    const r = runProbe(`mkdirSync('${dir}', { recursive: true })
      writeFileSync('${dir}/1.ndjson', 'grind: START j journal=/home/eh/some/real/project/journal.jsonl\\n')`)
    const out = `${r.stdout}\n${r.stderr}`
    expect(out).toContain('event guard ok')
    expect(r.status, out).toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 150_000)
