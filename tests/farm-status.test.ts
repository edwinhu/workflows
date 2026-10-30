/**
 * bin/farm-status: the statusLine segment for this session's farm runs, work rounds and grind loops.
 * Claude Code runs it with the session JSON on stdin; it reads <TMPDIR>/farm-events/<session_id>/ and
 * prints the watcher's own line (runs.ts statusLine) in colour, or nothing when nothing runs.
 */
import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'

const BIN = join(import.meta.dir, '..', 'bin', 'farm-status')
const SID = 'farm-status-test'
const ANSI = /\x1b\[[0-9;]*m/g
const children: ChildProcess[] = []
const roots: string[] = []

afterAll(() => {
  for (const c of children) c.kill('SIGKILL')
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** A live pid to own a run: a sleeping child this test kills at the end. */
function livePid(): number {
  const c = spawn('sleep', ['120'], { stdio: 'ignore' })
  children.push(c)
  return c.pid!
}

/** A pid that is certainly not running: a child that has already exited. */
function deadPid(): number {
  const r = spawnSync('sh', ['-c', 'echo $$'], { encoding: 'utf8' })
  return Number(r.stdout.trim())
}

function root() {
  const r = mkdtempSync(join(tmpdir(), 'farmstatus-'))
  roots.push(r)
  return r
}

function events(r: string, sid = SID) {
  const d = join(r, 'farm-events', sid)
  mkdirSync(d, { recursive: true })
  return d
}

const ago = (min: number) => Math.floor(Date.now() / 1000) - min * 60 - 5

function run(r: string, stdin: string) {
  return spawnSync(BIN, [], { input: stdin, encoding: 'utf8', timeout: 20_000, env: { ...process.env, TMPDIR: r } })
}

const session = (sid = SID) => JSON.stringify({ session_id: sid, cwd: '/w', transcript_path: '/w/t.jsonl', model: { display_name: 'Opus' } })

test('a running farm row prints the watcher line, in colour', () => {
  const r = root()
  const pid = livePid()
  writeFileSync(join(events(r), `${pid}.ndjson`),
    `farm: START alpha cwd=/w out= expect=1 t=${ago(43)}\nfarm: CLAIM alpha path=/w/alpha.md \n`)
  const out = run(r, session())
  expect(out.status).toBe(0)
  expect(out.stdout).toMatch(ANSI)
  expect(out.stdout.replace(ANSI, '').trim()).toBe('farm: 1 running (alpha 43m)')
})

test('the line goes empty once the row files its DONE', () => {
  const r = root()
  const pid = livePid()
  const f = join(events(r), `${pid}.ndjson`)
  writeFileSync(f, `farm: START alpha cwd=/w out= expect=1 t=${ago(43)}\n`)
  expect(run(r, session()).stdout.replace(ANSI, '').trim()).toBe('farm: 1 running (alpha 43m)')
  appendFileSync(f, 'farm: DONE alpha ok toolCalls=4 W=10\n')
  const out = run(r, session())
  expect(out.status).toBe(0)
  expect(out.stdout).toBe('')
})

test('a row whose pid is gone is not shown as running', () => {
  const r = root()
  writeFileSync(join(events(r), `${deadPid()}.ndjson`), `farm: START gamma cwd=/w out= expect=1 t=${ago(42)}\n`)
  const out = run(r, session())
  expect(out.status).toBe(0)
  expect(out.stdout).toBe('')
})

test('another session\'s running row never shows', () => {
  const r = root()
  events(r)
  writeFileSync(join(events(r, 'OTHER'), `${livePid()}.ndjson`), `farm: START theirs cwd=/w out= expect=1 t=${ago(5)}\n`)
  const out = run(r, session())
  expect(out.status).toBe(0)
  expect(out.stdout).toBe('')
})

test('a live work round shows its round phase from the run log', () => {
  const r = root()
  const R = join(r, 'w', '.work', 'runs', '1002-y')
  mkdirSync(R, { recursive: true })
  writeFileSync(join(R, 'run.log'), 'work-round: 1/5 agents (farm.sh --workflow)\nwork-round: 2/5 checks (work-checks.sh)\n')
  writeFileSync(join(events(r), `${livePid()}.ndjson`),
    `farm: START work-round cwd=/w out=${R}/result.json expect=1 t=${ago(6)}\nfarm: CLAIM work-round path=${R}/result.json \n`)
  const out = run(r, session())
  expect(out.status).toBe(0)
  expect(out.stdout.replace(ANSI, '').trim()).toBe('work 1002-y 2/5 checks 6m')
})

test('no session id, or stdin that is not JSON, prints nothing and exits 0', () => {
  const r = root()
  writeFileSync(join(events(r), `${livePid()}.ndjson`), `farm: START alpha cwd=/w out= expect=1 t=${ago(3)}\n`)
  for (const stdin of ['', 'not json', '{}', JSON.stringify({ session_id: `../farm-events/${SID}` })]) {
    const out = run(r, stdin)
    expect(out.status).toBe(0)
    expect(out.stdout).toBe('')
  }
})
