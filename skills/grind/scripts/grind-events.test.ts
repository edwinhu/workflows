/**
 * grind.sh — a loop that DIES leaves a record the launching session's monitor can see.
 *
 * The ending notification only fires when the loop reaches an ending. A loop killed hard — reboot,
 * OOM, kill -9 — reaches none and writes no terminal journal record either, so nothing says so and
 * the operator discovers it by asking. The watcher mod (hooks/watch/watcher.ts) watches for exactly that shape:
 * a file in $TMPDIR/farm-events/<session>/ whose pid is gone with no DONE line. So the loop files
 * itself there, in farm.sh's protocol rather than a second one of its own.
 *
 * Nothing here touches the network. `--runner` points at a stub in every case, and every run gets
 * its own TMPDIR so the assertions never see another session's dispatches.
 *
 * Run: bun test /home/eh/projects/workflows/skills/grind/scripts/grind-events.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { grindEnv } from './grind-test-env'
import { classify, parseEvents, wakeable, wakeText, type View } from '../../../hooks/watch/runs.ts'

const GRIND = `${import.meta.dir}/grind.sh`

const SESSION = 'sess-grind-events'

const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

function workdir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `${prefix}-`))
  scratch.push(d)
  return d
}

function script(dir: string, name: string, bodyText: string): string {
  const p = join(dir, name)
  writeFileSync(p, `#!/usr/bin/env bash\n${bodyText}\n`)
  chmodSync(p, 0o755)
  return p
}

/** A run whose TMPDIR and session are its own, so the event directory holds only this run. */
function sandbox(prefix: string) {
  const d = workdir(prefix)
  const env = grindEnv({ TMPDIR: d, CLAUDE_CODE_SESSION_ID: SESSION })
  return { d, env, eventDir: join(d, 'farm-events', SESSION) }
}

function run(args: string[], env: Record<string, string>) {
  return spawnSync('bash', [GRIND, 'run', '--runner', 'claude-code', ...args], { encoding: 'utf8', timeout: 60_000, env })
}

/** The only event file in the directory, and the pid its NAME carries — which is what both readers
 *  of this stream (the watcher mod's liveness check, farm-alive.sh) take the pid from. */
function eventFile(eventDir: string): { path: string; pid: number; lines: string[] } {
  const names = existsSync(eventDir) ? readdirSync(eventDir).filter(n => n.endsWith('.ndjson')) : []
  expect(names.length).toBe(1)
  const path = join(eventDir, names[0])
  return {
    path,
    pid: Number(names[0].replace(/\.ndjson$/, '')),
    lines: readFileSync(path, 'utf8').split('\n').filter(l => l.trim()),
  }
}

function records(journal: string): any[] {
  if (!existsSync(journal)) return []
  return readFileSync(journal, 'utf8').split('\n').filter(l => l.trim()).flatMap(l => {
    try { return [JSON.parse(l)] } catch { return [] }
  })
}

/** The base of a run that is one pass and out: check red, budget 1, runner a no-op. */
function budgetRun(d: string, extra: string[] = []) {
  const journal = join(d, 'journal.jsonl')
  writeFileSync(join(d, 'prompt.txt'), 'work')
  return {
    journal,
    args: [
      '--journal', journal,
      '--check', script(d, 'check.sh', 'exit 1'),
      '--runner', script(d, 'runner.sh', 'exit 0'),
      '--prompt-file', join(d, 'prompt.txt'),
      '--max-iters', '1', '--sleep', '0', '--notify', 'none',
      ...extra,
    ],
  }
}

/** One pass of the watcher mod over the directory: its own parser and classifier, with the liveness
 *  and artifact facts it gathers through $ read here from the real process table and disk. */
function watchPass(eventDir: string): View[] {
  const names = existsSync(eventDir) ? readdirSync(eventDir).filter(n => /^\d+\.ndjson$/.test(n)) : []
  const runs = names.flatMap(n =>
    parseEvents(readFileSync(join(eventDir, n), 'utf8'), join(eventDir, n), Number(n.split('.')[0]), SESSION))
  const alive = new Set(runs.map(r => r.pid).filter(p => spawnSync('kill', ['-0', String(p)]).status === 0))
  const present = new Set(runs.flatMap(r => [r.out, ...r.claims]).filter(p => p && existsSync(p)))
  return classify(runs, {
    alive, present, firstSeen: new Map(), loopExit: new Map(), round: new Map(), phase: new Map(),
  })
}

describe('grind.sh — the loop files itself in the launching session\'s event stream', () => {
  test('a run writes one event file under the launching session\'s directory, keyed on the loop pid', () => {
    const { d, env, eventDir } = sandbox('grind-ev-basic')
    const { journal, args } = budgetRun(d)

    const r = run(args, env)

    expect(r.status).toBe(4)
    const ev = eventFile(eventDir)
    // The pid in the filename is the LOOP's — the same one the journal's start record names, and the
    // one a reader kill -0's. A per-iteration pid would read as dead the moment the iteration ended.
    const start = records(journal).find(x => x.kind === 'start')
    expect(ev.pid).toBe(start.pid)
  })

  test('START names the loop, its cwd and its journal; DONE carries the terminal state and exit code', () => {
    const { d, env, eventDir } = sandbox('grind-ev-lines')
    const { args } = budgetRun(d)

    run(args, env)

    const { lines } = eventFile(eventDir)
    expect(lines[0]).toMatch(/^grind: START grind%20journal\.jsonl cwd=\S+ journal=\S+ $/)
    expect(lines.at(-1)).toBe('grind: DONE budget rc=4')
  })

  test('values are percent-encoded exactly as farm.sh encodes them — one protocol, not two', () => {
    // A journal path carrying a space or an `=` would otherwise spell a second field inside an
    // otherwise well-formed line, which is the case enc() exists for.
    const { d, env, eventDir } = sandbox('grind-ev-enc')
    const journal = join(d, 'a b=c.jsonl')
    writeFileSync(join(d, 'prompt.txt'), 'work')

    run([
      '--journal', journal,
      '--check', script(d, 'check.sh', 'exit 1'),
      '--runner', script(d, 'runner.sh', 'exit 0'),
      '--prompt-file', join(d, 'prompt.txt'),
      '--max-iters', '1', '--sleep', '0', '--notify', 'none',
    ], env)

    const { lines } = eventFile(eventDir)
    expect(lines[0]).toContain(`journal=${journal.replace(/ /g, '%20').replace(/=/g, '%3D')} `)
    // The encoded field is still one space-delimited token: nothing in it can be read as a field.
    expect(lines[0].split(' ').length).toBe(6)
  })

  test('each iteration boundary is one line, and the volume stays at that', () => {
    const { d, env, eventDir } = sandbox('grind-ev-iter')
    const { args } = budgetRun(d, [])
    args[args.indexOf('1', args.indexOf('--max-iters'))] = '3'

    run(args, env)

    const { lines } = eventFile(eventDir)
    expect(lines.filter(l => l.startsWith('grind: ITER '))).toEqual([
      'grind: ITER i=1 exit=0 W=0 ',
      'grind: ITER i=2 exit=0 W=0 ',
      'grind: ITER i=3 exit=0 W=0 ',
    ])
  })

  test('a shut gate announces on the --wait-alert cadence, not once per wait', () => {
    const { d, env, eventDir } = sandbox('grind-ev-wait')
    writeFileSync(join(d, 'prompt.txt'), 'work')
    const journal = join(d, 'journal.jsonl')

    run([
      '--journal', journal,
      '--check', script(d, 'check.sh', 'exit 1'),
      '--gate', script(d, 'gate.sh', "printf 'grid busy: 3 jobs\\n'; exit 1"),
      '--runner', script(d, 'runner.sh', 'exit 0'),
      '--prompt-file', join(d, 'prompt.txt'),
      '--max-iters', '6', '--sleep', '0', '--notify', 'none', '--wait-alert', '2',
    ], env)

    const { lines } = eventFile(eventDir)
    const waits = lines.filter(l => l.startsWith('grind: WAIT '))
    // Six waits, alert every 2 — three lines, not six.
    expect(waits).toEqual([
      'grind: WAIT waits=2 why=grid%20busy:%203%20jobs ',
      'grind: WAIT waits=4 why=grid%20busy:%203%20jobs ',
      'grind: WAIT waits=6 why=grid%20busy:%203%20jobs ',
    ])
  })

  test('every terminal state writes a DONE — stalled, budget and stopped are endings, not deaths', () => {
    const { d, env, eventDir } = sandbox('grind-ev-stalled')
    writeFileSync(join(d, 'prompt.txt'), 'work')
    const journal = join(d, 'journal.jsonl')

    const r = run([
      '--journal', journal,
      '--check', script(d, 'check.sh', 'exit 1'),
      '--runner', script(d, 'runner.sh', 'exit 0'),
      '--prompt-file', join(d, 'prompt.txt'),
      '--max-iters', '5', '--sleep', '0', '--stall-after', '2', '--notify', 'none',
    ], env)

    expect(r.status).toBe(3)
    expect(eventFile(eventDir).lines.at(-1)).toBe('grind: DONE stalled rc=3')
  })

  test('a green check ends with DONE done rc=0', () => {
    const { d, env, eventDir } = sandbox('grind-ev-done')
    writeFileSync(join(d, 'prompt.txt'), 'work')
    const journal = join(d, 'journal.jsonl')

    const r = run([
      '--journal', journal,
      '--check', script(d, 'check.sh', 'exit 0'),
      '--runner', script(d, 'runner.sh', 'exit 0'),
      '--prompt-file', join(d, 'prompt.txt'),
      '--sleep', '0', '--notify', 'none',
    ], env)

    expect(r.status).toBe(0)
    expect(eventFile(eventDir).lines.at(-1)).toBe('grind: DONE done rc=0')
  })

  test('--no-events writes nothing at all — not an empty file, not the directory', () => {
    const { d, env, eventDir } = sandbox('grind-ev-off')
    const { args } = budgetRun(d, ['--no-events'])

    const r = run(args, env)

    expect(r.status).toBe(4)
    expect(existsSync(eventDir)).toBe(false)
  })
})

describe('grind.sh — the watcher mod reads the stream without being taught a second protocol', () => {
  test('a finished loop is done with its terminal state, and is NOT reported gone', () => {
    const { d, env, eventDir } = sandbox('grind-ev-monitor')
    const { args } = budgetRun(d)

    run(args, env)
    const views = watchPass(eventDir)

    expect(views.length).toBe(1)
    expect(views[0]!.kind).toBe('grind')
    expect(views[0]!.label).toBe('grind journal.jsonl')
    // The loop's pid is long gone by now, but it wrote DONE, so it ended rather than died.
    expect(views[0]!.state).toBe('done')
    expect(views[0]!.done).toEqual({ status: 'budget', detail: 'budget rc=4' })
  }, 60_000)

  test('a SIGKILLed loop leaves START with no DONE, and the watcher reports it GONE', () => {
    const { d, env, eventDir } = sandbox('grind-ev-kill')
    writeFileSync(join(d, 'prompt.txt'), 'work')
    const journal = join(d, 'journal.jsonl')
    // A gate that never opens and a long sleep: the loop is parked, having written START, and
    // spawns no runner to orphan.
    const cmd = [
      'bash', GRIND, 'run', '--runner', 'claude-code',
      '--journal', journal,
      '--check', script(d, 'check.sh', 'exit 1'),
      '--gate', script(d, 'gate.sh', 'exit 1'),
      '--runner', script(d, 'runner.sh', 'exit 0'),
      '--prompt-file', join(d, 'prompt.txt'),
      '--sleep', '30', '--notify', 'none',
    ].map(a => `'${a}'`).join(' ')

    const spawned = spawnSync('bash', ['-c', `${cmd} >/dev/null 2>&1 & echo $!`], {
      encoding: 'utf8', timeout: 30_000, env,
    })
    const pid = Number(spawned.stdout.trim())
    expect(pid).toBeGreaterThan(0)

    // Wait for START to land rather than guessing at a sleep.
    let lines: string[] = []
    for (let i = 0; i < 100; i++) {
      if (existsSync(eventDir) && readdirSync(eventDir).length) {
        lines = eventFile(eventDir).lines
        if (lines.some(l => l.includes(' START '))) break
      }
      spawnSync('sleep', ['0.1'])
    }
    expect(lines.some(l => l.includes(' START '))).toBe(true)
    // Alive and parked: running, not gone.
    expect(watchPass(eventDir)[0]!.state).toBe('running')

    // The hard kill: no trap runs, no journal ending, no DONE.
    spawnSync('kill', ['-9', String(pid)])
    for (let i = 0; i < 100 && spawnSync('kill', ['-0', String(pid)]).status === 0; i++) {
      spawnSync('sleep', ['0.1'])
    }

    const ev = eventFile(eventDir)
    expect(ev.pid).toBe(pid)
    expect(ev.lines.some(l => l.includes(' START '))).toBe(true)
    expect(ev.lines.some(l => l.includes(' DONE '))).toBe(false)
    // And the journal is equally silent about how it ended — which is the whole reason the event
    // stream has to carry this.
    expect(records(journal).some(r => ['done', 'stalled', 'budget', 'stopped'].includes(r.kind))).toBe(false)

    const views = watchPass(eventDir)
    expect(views[0]!.state).toBe('gone')
    expect(wakeText(views[0]!, Date.now())).toContain(`grind loop grind journal.jsonl is GONE: pid ${pid}`)
  }, 60_000)

  test('a grind file in the directory leaves the farm run\'s classification unchanged', () => {
    // The watcher reads every file in the directory. A grind loop parked beside a farm dispatch must
    // not change how the farm run is read, nor be paired with its lines.
    const { d, env, eventDir } = sandbox('grind-ev-farm')
    const farmLines = [
      'farm: START review cwd=/tmp/x out=/tmp/x/result.json expect=1',
      'farm: CLAIM review path=/tmp/x/result.json ',
      'farm: DONE review ok toolCalls=7',
    ]
    spawnSync('mkdir', ['-p', eventDir])
    // A pid that is gone: 2^22 is above every Linux pid_max default, so nothing owns it.
    writeFileSync(join(eventDir, '4194304.ndjson'), farmLines.join('\n') + '\n')

    const farmOnly = (vs: View[]) => vs.filter(v => v.kind === 'farm').map(v => [v.label, v.state, v.done])
    const before = watchPass(eventDir)
    const { args } = budgetRun(d)
    run(args, env)
    const after = watchPass(eventDir)

    expect(farmOnly(before)).toEqual([['review', 'done', { status: 'ok', detail: 'ok toolCalls=7' }]])
    expect(farmOnly(after)).toEqual(farmOnly(before))
    expect(wakeable(after).map(v => v.kind).sort()).toEqual(['farm', 'grind'])
  }, 60_000)
})
