import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'

const FARM = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm.sh')
const ALIVE = join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'farm-alive.sh')

const SID = 'aaaaaaaa-1111-2222-3333-444444444444'
const OTHER_SID = 'bbbbbbbb-5555-6666-7777-888888888888'

// TMPDIR is per-USER, not per-session, so a bare $TMPDIR/farm-events is one directory shared by
// every concurrent Claude session: each monitor prints the others' milestones, and the GONE check
// kill -0's pids it does not own. The session id is what makes the path actually session-scoped.
function runFarm(root: string, env: Record<string, string | undefined>) {
  const bin = join(root, 'bin'); mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'claude-code'), `#!/usr/bin/env bash\nprintf '{"type":"result","result":"ok"}\\n'\n`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  const tasks = join(root, 't.json')
  writeFileSync(tasks, JSON.stringify([{ label: 'r', prompt: 'p' }]))
  return spawnSync('bash', [FARM, '--tasks', tasks, '--cwd', root], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root, FARM_OUT_CHILD: '1', ...env },
  })
}

const ndjson = (d: string) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.ndjson')) : [])

test('with a session id, the writer files under farm-events/<session-id>/ and not the bare dir', () => {
  const root = mkdtempSync(join(tmpdir(), 'scope-write-'))
  runFarm(root, { CLAUDE_CODE_SESSION_ID: SID })
  const bare = join(root, 'farm-events')
  const scoped = join(bare, SID)
  const inScoped = ndjson(scoped).length
  const inBare = ndjson(bare).length
  rmSync(root, { recursive: true, force: true })
  expect(inScoped).toBeGreaterThan(0)
  expect(inBare).toBe(0)
})

// The cross-talk regression. Against the old bare-directory expression both sessions share one
// directory, so this run is visible to the wrong session and the checker calls it alive.
test('a live run belonging to a different session is not seen', async () => {
  const root = mkdtempSync(join(tmpdir(), 'scope-crosstalk-'))
  const out = join(root, 'result.json')
  const theirs = join(root, 'farm-events', OTHER_SID)
  mkdirSync(theirs, { recursive: true })
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
  writeFileSync(join(theirs, `${child.pid}.ndjson`), `farm: START workflow cwd=/x out=${out} expect=1\n`)

  // Old code read $TMPDIR/farm-events, so a file one level down was invisible either way; the
  // regression is only visible when the other session's file sits where the old code looked.
  writeFileSync(join(root, 'farm-events', `${child.pid}.ndjson`), `farm: START workflow cwd=/x out=${out} expect=1\n`)

  const status = spawnSync('bash', [ALIVE, out], {
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: root, CLAUDE_CODE_SESSION_ID: SID },
  }).status
  process.kill(child.pid!, 'SIGKILL')
  await new Promise((r) => setTimeout(r, 200))
  rmSync(root, { recursive: true, force: true })
  expect(status).not.toBe(0)   // our session owns no run claiming `out`
})

test('with no session id the path is the bare farm-events directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'scope-compat-'))
  runFarm(root, { CLAUDE_CODE_SESSION_ID: undefined })
  const inBare = ndjson(join(root, 'farm-events')).length
  rmSync(root, { recursive: true, force: true })
  expect(inBare).toBeGreaterThan(0)
})

test('all three consumers spell the directory identically', () => {
  const EXPR = 'farm-events${CLAUDE_CODE_SESSION_ID:+/$CLAUDE_CODE_SESSION_ID}'
  for (const p of [
    join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm.sh'),
    join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm-monitor.sh'),
    ALIVE,
  ]) {
    // A writer that moves without both readers makes every liveness check silently report dead.
    expect({ p, scoped: readFileSync(p, 'utf8').includes(EXPR) }).toEqual({ p, scoped: true })
  }
})
