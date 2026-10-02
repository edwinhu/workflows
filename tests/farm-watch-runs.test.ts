/**
 * The watcher mod (hooks/watch/watcher.ts) reads what the scripts REALLY write. Its parser and classifier
 * (hooks/watch/runs.ts) are pure, so they run here against the event files farm.sh and work-loop.sh
 * produce, in a sandbox TMPDIR and a sentinel session id, never the caller's own stream. The mod's
 * `$` side runs under the mod kit, which this file drives through scripts/mod-test.sh.
 *
 * Run: bun test tests/farm-watch-runs.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { classify, parseEvents, statusLine, table, wakeable, wakeText, type Facts } from '../hooks/watch/runs.ts'

const REPO = join(import.meta.dir, '..')
const FARM = join(REPO, 'skills', 'farm-out', 'scripts', 'farm.sh')
const LOOP = join(REPO, 'skills', 'work', 'scripts', 'work-loop.sh')
const SID = 'sess-farm-watch'

function facts(over: Partial<Facts> = {}): Facts {
  return { alive: new Set(), present: new Set(), firstSeen: new Map(), loopExit: new Map(), round: new Map(), phase: new Map(), ...over }
}

function readDir(eventDir: string) {
  const names = existsSync(eventDir) ? readdirSync(eventDir).filter(n => /^\d+\.ndjson$/.test(n)) : []
  return names.flatMap(n => parseEvents(readFileSync(join(eventDir, n), 'utf8'), join(eventDir, n), Number(n.split('.')[0]), SID))
}

describe('parseEvents over what farm.sh writes', () => {
  test('a --tasks run: one run per row, START t=, CLAIM, DONE ok, artifact present', () => {
    const root = mkdtempSync(join(tmpdir(), 'farmwatch-'))
    const cwd = join(root, 'cwd'), bin = join(root, 'bin')
    mkdirSync(cwd); mkdirSync(bin)
    writeFileSync(join(bin, 'claude-code'),
      `#!/usr/bin/env bash\nprintf 'x\\n' > "${join(cwd, 'a.md')}"\nprintf '{"type":"result","result":"done"}\\n'\n`)
    chmodSync(join(bin, 'claude-code'), 0o755)
    const tasks = join(root, 'tasks.json')
    writeFileSync(tasks, JSON.stringify([
      { label: 'alpha one', prompt: 'p', expect: 'a.md' },
      { label: 'beta', prompt: 'p', expect: 'b.md' },
    ]))
    const before = Math.floor(Date.now() / 1000)
    spawnSync('bash', [FARM, '--provider', 'claude', '--tasks', tasks, '--cwd', cwd], { timeout: 130_000,
      encoding: 'utf8', cwd: root,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FARM_OUT_CHILD: '1',
        TMPDIR: root, CLAUDE_CODE_SESSION_ID: SID, FARM_OUTCOMES: join(root, 'farm-outcomes.jsonl') },
    })
    const runs = readDir(join(root, 'farm-events', SID))
    const present = new Set(runs.flatMap(r => r.claims).filter(p => existsSync(p)))
    const views = classify(runs, facts({ present }))
    rmSync(root, { recursive: true, force: true })

    expect(runs.map(r => r.label).sort()).toEqual(['alpha one', 'beta'])
    for (const r of runs) expect(r.t).toBeGreaterThanOrEqual(before)
    const a = views.find(v => v.label === 'alpha one')!
    const b = views.find(v => v.label === 'beta')!
    expect(a.claims).toContain(join(cwd, 'a.md'))
    expect([a.state, a.done?.status, a.artifactsPresent]).toEqual(['done', 'ok', true])
    // farm.sh's own verdict on a missing artifact is fail; the watcher reports it, missing.
    expect([b.state, b.done?.status, b.artifactsPresent]).toEqual(['done', 'fail', false])
    expect(wakeText(b, Date.now())).toContain('(MISSING)')
  })
})

describe('work-loop.sh files itself in the stream', () => {
  test('START work-loop out=<run>/loop.exit, then DONE work-loop rc=<exit> from its EXIT trap', () => {
    const root = mkdtempSync(join(tmpdir(), 'farmwatch-loop-'))
    const run = join(root, 'run')
    mkdirSync(run)
    writeFileSync(join(run, 'args.json'), '{}')
    writeFileSync(join(run, 'plan.md'), '# plan')
    // farm-alive.sh finds no live dispatch, so round 1 reports the dispatch dead: exit 1.
    const r = spawnSync('bash', [LOOP, '--run-dir', run, '--plan', join(run, 'plan.md'), '--loops', '1'], { timeout: 130_000,
      encoding: 'utf8', env: { ...process.env, TMPDIR: root, CLAUDE_CODE_SESSION_ID: SID, WORK_LOOP_SETTLE: '0' },
    })
    const runs = readDir(join(root, 'farm-events', SID))
    rmSync(root, { recursive: true, force: true })

    expect(r.status).toBe(1)
    expect(runs.length).toBe(1)
    expect(runs[0]!.label).toBe('work-loop')
    expect(runs[0]!.out).toBe(join(run, 'loop.exit'))
    expect(runs[0]!.done).toEqual({ status: 'rc=1', detail: 'rc=1' })
    const v = classify(runs, facts())[0]!
    expect(v.kind).toBe('work-loop')
    expect(v.runDir).toBe(run)
    expect(wakeText(v, Date.now())).toContain('loop finished: exit 1 (dispatch died with no verdict)')
  })
})

describe('classify: ownership of nested rows, GONE, and the status line', () => {
  const R = '/w/.work/runs/1001-x'
  const text = (lines: string[]) => lines.join('\n') + '\n'
  const runs = [
    ...parseEvents(text([`farm: START work-round cwd=/w out=${R}/result.json expect=1 t=100`]), '/e/10.ndjson', 10, SID),
    ...parseEvents(text([`farm: START workflow cwd=/w out=${R}/raw.json expect=1 t=100`]), '/e/11.ndjson', 11, SID),
    ...parseEvents(text([`farm: START solo cwd=/w out= expect=1 t=40`, 'farm: CLAIM solo path=/w/solo.md ']), '/e/12.ndjson', 12, SID),
  ]

  test('a farm row writing into a work run directory is nested and never wakes', () => {
    const views = classify(runs, facts({ alive: new Set([10, 11, 12]) }))
    expect(views.find(v => v.label === 'workflow')!.nested).toBe(true)
    expect(wakeable(views).map(v => v.label).sort()).toEqual(['solo', 'work-round'])
  })

  test('a dead pid with no DONE and no artifact is GONE; with its artifact it is done', () => {
    const gone = classify(runs, facts({ alive: new Set([10, 11]) })).find(v => v.label === 'solo')!
    expect(gone.state).toBe('gone')
    const landed = classify(runs, facts({ alive: new Set([10, 11]), present: new Set(['/w/solo.md']) })).find(v => v.label === 'solo')!
    expect(landed.state).toBe('done')
  })

  test('status line: farm rows first, then the work run with its phase; /farm marks nested rows', () => {
    const views = classify(runs, facts({ alive: new Set([10, 11, 12]), phase: new Map([[R, '2/5 checks']]) }))
    expect(statusLine(views, 160_000)).toBe('farm: 1 running (solo 2m) · work 1001-x 2/5 checks 1m')
    expect(table(views, 160_000)).toContain('  ↳ workflow')
    expect(statusLine(classify(runs, facts()), 160_000)).toBeUndefined()
  })
})

test('the mod kit tests pass (scripts/mod-test.sh -> claude plugin test)', () => {
  if (spawnSync('bash', ['-c', 'command -v claude'], { timeout: 130_000 }).status !== 0) return
  const r = spawnSync('bash', [join(REPO, 'scripts', 'mod-test.sh')], { encoding: 'utf8', timeout: 120_000 })
  // 8 watcher + 7 guards (hooks/mod-tests/guards.test.ts) + 16 per-edit Jev (hooks/mod-tests/jev.test.ts)
  expect(r.stdout + r.stderr).toMatch(/\b31 pass\b/)
  expect(r.stdout + r.stderr).toMatch(/\b0 fail\b/)
  expect(r.status).toBe(0)
}, 130_000)
