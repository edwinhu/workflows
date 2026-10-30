/**
 * farm.sh --tasks --detach: with this session's watcher alive (a fresh farm-events beacon) the call
 * returns at once and the rows still run, filing their DONE where the watcher reads; with no watcher
 * it runs in the foreground and says so. The watcher is then the run's one wake.
 */
import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const FARM = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm.sh')
const SID = 'farm-detach-test'
const ROW_SECONDS = 4

/** A sandbox whose stub `claude-code` takes ROW_SECONDS, then writes the row's expect. */
function sandbox(beacon: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'farmdetach-'))
  const cwd = join(root, 'cwd'), bin = join(root, 'bin'), events = join(root, 'farm-events', SID)
  for (const d of [cwd, bin, events]) mkdirSync(d, { recursive: true })
  const out = join(cwd, 'report.md')
  writeFileSync(join(bin, 'claude-code'),
    `#!/usr/bin/env bash\nsleep ${ROW_SECONDS}\nprintf 'row report\\n' > "${out}"\nprintf '{"type":"result","result":"done"}\\n'\n`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  if (beacon) writeFileSync(join(events, 'watcher.alive'), String(Math.floor(Date.now() / 1000)))
  const tasks = join(root, 'tasks.json')
  writeFileSync(tasks, JSON.stringify([{ label: 'detached-row', workflow: 'none', prompt: 'p', expect: out }]))
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FARM_OUT_CHILD: '1',
                FARM_OUTCOMES: join(root, 'farm-outcomes.jsonl'), TMPDIR: root, CLAUDE_CODE_SESSION_ID: SID }
  return { root, cwd, out, events, tasks, env }
}

function farm(s: ReturnType<typeof sandbox>, ...extra: string[]) {
  const t0 = Date.now()
  const r = spawnSync('bash', [FARM, '--provider', 'claude', '--tasks', s.tasks, '--cwd', s.cwd, ...extra],
    { timeout: 60_000, encoding: 'utf8', env: s.env })
  return { ...r, ms: Date.now() - t0 }
}

const doneLine = (events: string) =>
  readdirSync(events).filter(f => f.endsWith('.ndjson'))
    .map(f => readFileSync(join(events, f), 'utf8')).join('').match(/DONE detached-row ok\b/)

async function until(pred: () => unknown, ms: number) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (pred()) return true; await Bun.sleep(250) }
  return false
}

test('with the watcher alive, --detach returns before the row finishes and the row still files its DONE', async () => {
  const s = sandbox(true)
  try {
    const r = farm(s, '--detach')
    expect(r.status).toBe(0)
    expect(r.ms).toBeLessThan(ROW_SECONDS * 1000 - 1000)
    expect(r.stdout).toContain('detached')
    const log = r.stdout.match(/(\/\S+)/)?.[1]
    expect(log && existsSync(log)).toBe(true)
    expect(existsSync(s.out)).toBe(false)                          // the row has not run yet
    expect(await until(() => existsSync(s.out) && doneLine(s.events), 30_000)).toBe(true)
    expect(readFileSync(s.out, 'utf8')).toBe('row report\n')
  } finally {
    rmSync(s.root, { recursive: true, force: true })
  }
}, 60_000)

test('with no watcher, --detach is ignored out loud and the row runs in the foreground', () => {
  const s = sandbox(false)
  try {
    const r = farm(s, '--detach')
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('farm: --detach ignored')
    expect(r.ms).toBeGreaterThanOrEqual(ROW_SECONDS * 1000)
    expect(JSON.parse(r.stdout)[0].ok).toBe(true)
    expect(readFileSync(s.out, 'utf8')).toBe('row report\n')
  } finally {
    rmSync(s.root, { recursive: true, force: true })
  }
}, 60_000)

test('--detach without --tasks is refused, exit 2', () => {
  const s = sandbox(true)
  try {
    const r = spawnSync('bash', [FARM, '--provider', 'claude', '--workflow', join(s.root, 'wf.js'), '--out', join(s.root, 'o.json'),
      '--cwd', s.cwd, '--detach'], { timeout: 60_000, encoding: 'utf8', env: s.env })
    expect(r.status).toBe(2)
    expect(r.stdout + r.stderr).toContain('--detach needs --tasks')
  } finally {
    rmSync(s.root, { recursive: true, force: true })
  }
}, 60_000)
