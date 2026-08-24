import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'

const SCRIPTS = join(import.meta.dir, '..', 'skills', 'craft', 'scripts')
const ALIVE = join(SCRIPTS, 'farm-alive.sh')   // authored by T2
const DISPATCH = join(SCRIPTS, 'craft-dispatch.sh')

// Liveness is judged by watching a real process, not by reading the checker's source.
function aliveFor(outPath: string, eventDir: string) {
  return spawnSync('bash', [ALIVE, outPath], {
    encoding: 'utf8', env: { ...process.env, TMPDIR: eventDir },
  }).status
}

test('reports alive while the run is running, dead once it exits', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alive-'))
  const evd = join(root, 'farm-events'); mkdirSync(evd, { recursive: true })
  const out = join(root, 'result.json')
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
  writeFileSync(join(evd, `${child.pid}.ndjson`), `farm: START workflow cwd=/x out=${out} expect=1\n`)

  expect(aliveFor(out, root)).toBe(0)            // running -> exit 0
  process.kill(child.pid!, 'SIGKILL')
  await new Promise((r) => setTimeout(r, 300))
  expect(aliveFor(out, root)).not.toBe(0)        // exited -> non-zero
  rmSync(root, { recursive: true, force: true })
})

test('neither liveness site names a runner file', () => {
  const src = readFileSync(DISPATCH, 'utf8')
  const livenessLines = src.split('\n').filter((l) => l.includes('result\\.json') || l.includes('farm-alive'))
  expect(livenessLines.length).toBeGreaterThan(0)
  // Assert on a COUNT, never on the file's text: a failure diff that dumps this script's
  // source contains the words "not found", and craft's red-probe classifier reads probe
  // output and would misread that as a missing command rather than a test verdict.
  // Two evasions to defeat: the escaped dot (`farm\.ts`) and the pgrep bracket (`[f]arm`).
  const offenders = livenessLines
    .map((l) => l.replace(/\\/g, ''))
    .filter((l) => l.includes('arm.ts') || l.includes('arm.sh')).length
  expect(offenders).toBe(0)
})

test('craft dispatches the runner with bash, not bun', () => {
  const src = readFileSync(DISPATCH, 'utf8')
  expect(src.includes('bun "$FARM"')).toBe(false)
  expect(src.includes('farm.sh')).toBe(true)
})
