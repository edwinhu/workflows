/**
 * scripts/canary.sh --assert: the release canary's assertions, run over a hand-built run dir and event
 * stream so the logic is covered without the model calls a real canary costs. The "bad" fixture is the
 * secreg lecture-18 diagnose (2026-10-02) in miniature: a refused round, vacuous legs, W=0 rows.
 *
 * Run: bun test tests/canary-assert.test.ts
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const CANARY = join(import.meta.dir, '..', 'scripts', 'canary.sh')
const root = mkdtempSync(join(tmpdir(), 'canary-assert-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

type Fx = { exit: string; mechOut: string; ruleStdout: string; ruleExit: number; loopLog: string; events: string[]; lensesReported: number }

const good: Fx = {
  exit: '8',
  mechOut: 'check: PASS — all 11 legs exited 0\namerican-english: 1 file(s), 947 line(s) read (whole file), clean\ncase-cites: 1 file(s), 2 (CP N) cite(s) checked (whole file), 0 under no named case, clean',
  ruleStdout: '{"verdicts":[{"rule":"S-SETUP","p":0.1,"verdict":"MET"}],"unavailable":[]}',
  ruleExit: 0,
  loopLog: 'verdict: FAIL\nwork-loop: readOnly run reached its verdict\n',
  lensesReported: 1,
  events: [
    'farm: START work-loop cwd=/x out=RUN/loop.exit expect=1 t=1',
    'farm: DONE work-loop rc=8',
    'farm: START work-round cwd=/x out=RUN/result.json expect=1 t=1',
    'farm: DONE work-round ok',
    'farm: START workflow cwd=/x out=RUN/raw.json expect=1 t=1',
    'farm: DONE workflow ok toolCalls=4 W=1200',
    'farm: START lens cwd=/x out= expect=1 t=2',
    'farm: CLAIM lens path=RUN/lens.json ',
    'farm: DONE lens ok toolCalls=9 W=3400',
  ],
}

function build(name: string, fx: Fx): { run: string; events: string } {
  const run = join(root, name)
  const events = join(root, `${name}-events`)
  mkdirSync(run, { recursive: true })
  mkdirSync(events, { recursive: true })
  writeFileSync(join(run, 'loop.exit'), `${fx.exit}\n`)
  writeFileSync(join(run, 'loop.log'), fx.loopLog)
  writeFileSync(join(run, 'run.log'), 'work-round: 5/5 gate\n')
  writeFileSync(join(run, 'result.json'), JSON.stringify({ overallPass: false, scoreTable: { lensesReported: fx.lensesReported, mechanicalRun: 1, ruleVerdicts: 1 } }))
  writeFileSync(join(run, 'checks.json'), JSON.stringify({
    red: [], acceptance: [],
    mechanical: [{ name: 'slides-mech', exitCode: 0, output: fx.mechOut }],
    rules: [{ name: 'jev-slides-rules', exitCode: fx.ruleExit, stdout: fx.ruleStdout, output: '' }],
  }))
  // Two event files, as two pids would write them; RUN is the run dir.
  const lines = fx.events.map(l => l.replaceAll('RUN', run))
  writeFileSync(join(events, '100.ndjson'), lines.slice(0, 2).join('\n') + '\n')
  writeFileSync(join(events, '200.ndjson'), lines.slice(2).join('\n') + '\n')
  return { run, events }
}

const COUNTS = ['american-english: \\d+ file\\(s\\), (\\d+) (?:added )?line\\(s\\) read']
function assertRun(name: string, fx: Fx) {
  const { run, events } = build(name, fx)
  const r = spawnSync('bash', [CANARY, '--assert', run, '--events', events, '--expect-exit', '0,8', ...COUNTS.flatMap(c => ['--mech-count', c])], { encoding: 'utf8', timeout: 30_000 })
  return { status: r.status, out: r.stdout + r.stderr }
}

describe('canary --assert', () => {
  test('a clean read-only verdict passes every assertion', () => {
    const r = assertRun('good', good)
    expect(r.out).not.toContain('FAIL [')
    expect(r.status).toBe(0)
  })

  test('the lecture-18 shape fails, naming each problem', () => {
    const r = assertRun('bad', {
      ...good,
      exit: '3',
      loopLog: 'work-loop: work-redispatch.sh refused the round at its Tier 1 gate\n',
      mechOut: 'american-english: 1 file(s), 0 added line(s) read, clean\ncase-cites: 1 file(s), 0 added (CP N) cite(s) checked, clean',
      events: good.events.map(l => l.replace('W=1200', 'W=0').replace('W=3400', 'W=0')),
    })
    expect(r.status).toBe(1)
    expect(r.out).toContain('loop.exit is 3, expected 0 or 8')
    expect(r.out).toContain('redispatch refused the round')
    expect(r.out).toContain('leg american-english read 0 — vacuous')
    expect(r.out).toContain('leg case-cites checked 0 — vacuous')
    expect(r.out).toContain('row workflow made 4 tool call(s) but recorded W=0')
    expect(r.out).toContain('tokens recorded: 0 W')
  })

  test('E2BIG, a traceback and a rule leg that judged nothing each fail', () => {
    const r = assertRun('errs', {
      ...good,
      loopLog: 'farm.sh: line 352: /home/eh/.local/bin/claude-code: Argument list too long\nTraceback (most recent call last):\n',
      ruleStdout: '{"verdicts":[],"unavailable":[]}',
    })
    expect(r.status).toBe(1)
    expect(r.out).toContain('E2BIG in loop.log')
    expect(r.out).toContain('Python traceback in loop.log')
    expect(r.out).toContain('0 verdicts — examined nothing')
  })

  test('a run with no DONE in the watcher stream fails', () => {
    const r = assertRun('nodone', { ...good, events: good.events.filter(l => !l.startsWith('farm: DONE work-loop')) })
    expect(r.status).toBe(1)
    expect(r.out).toContain('START work-loop has no DONE')
  })
})

/**
 * The two steps that run before any model call, in --dry-run as well as --run. SUITES runs BOTH repos'
 * suites (teaching 4.3.7 shipped {{NAME}} refs that turned workflows' gate-vacuity red because only
 * teaching's suite ran); TEMPLATE renders teaching's notes repair template for a real course with
 * course_paths.py and requires plan-lint to find nothing in it. Each fails CLOSED when its input is gone.
 */
describe('canary suites and template steps', () => {
  const TEACHING = process.env.TEACHING_PLUGIN_ROOT || join(process.env.HOME ?? '', '.claude/skills/teaching')
  function canary(args: string[], env: Record<string, string>) {
    const tmp = mkdtempSync(join(root, 'dry-'))
    const r = spawnSync('bash', [CANARY, ...args], {
      encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, CANARY_TMP: tmp, CANARY_STATE: join(tmp, 'state'), CANARY_NESTED: '', ...env },
    })
    return { status: r.status, out: r.stdout + r.stderr }
  }

  test('--dry-run --only template renders a course, finds every path and lints it to zero findings', () => {
    const r = canary(['--dry-run', '--only', 'template'],
      { CANARY_TEACHING: TEACHING, CANARY_COURSE: join(TEACHING, 'tests/fixtures/course-layout'), CANARY_DIAG_LECTURE: '7' })
    expect(r.out).toMatch(/render-template: [1-9]\d* course path\(s\) examined in the notes repair template, 0 absent/)
    expect(r.out).toContain('template: plan-lint 0 finding(s) over the rendered notes repair template')
    expect(r.status).toBe(0)
  })

  test('a teaching checkout without render-template.ts is a FAIL, never a skipped step', () => {
    const fake = mkdtempSync(join(root, 'no-teaching-'))
    const r = canary(['--dry-run', '--only', 'template'], { CANARY_TEACHING: fake })
    expect(r.status).toBe(1)
    expect(r.out).toContain('FAIL [template]')
  })

  test('a teaching checkout without its suite runner is a FAIL before either suite runs', () => {
    const fake = mkdtempSync(join(root, 'no-suite-'))
    const r = canary(['--dry-run', '--only', 'suites'], { CANARY_TEACHING: fake })
    expect(r.status).toBe(1)
    expect(r.out).toContain('FAIL [suites]')
    expect(r.out).toContain('NO SUITE RAN')
    expect(r.out).not.toContain('=== canary suites: workflows')
  })

  test('a canary started inside its own suite run refuses with exit 2 instead of recursing', () => {
    const r = canary(['--dry-run', '--only', 'suites'], { CANARY_NESTED: '1' })
    expect(r.status).toBe(2)
    expect(r.out).toContain('CANARY_NESTED')
  })

  // A git repo in a temp dir: FILES committed at one commit, then MODS written over the tracked ones
  // and UNTRACKED created beside them — a main checkout carrying another session's work.
  function repo(name: string, files: Record<string, string>, mods: Record<string, string> = {}, untracked: Record<string, string> = {}) {
    const dir = mkdtempSync(join(root, `${name}-`))
    const git = (...a: string[]) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8', timeout: 10_000 })
    const put = (o: Record<string, string>) => {
      for (const [f, body] of Object.entries(o)) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), body) }
    }
    git('init', '-q'); put(files); git('add', '-A'); git('commit', '-qm', 'release')
    put(mods); put(untracked)
    return { dir, git, head: git('rev-parse', 'HEAD').stdout.trim() }
  }
  // The suite fails if it can see the uncommitted edit: release.txt reads WIP only in the working tree.
  const FAKE_SUITE = '#!/usr/bin/env bash\ngrep -q committed release.txt || { echo "(fail) suite read uncommitted WIP"; exit 1; }\necho " 1 pass"; echo " 0 fail"\n'
  const teachingRepo = (mods: Record<string, string> = {}) => repo('teaching', {
    'tests/run-all.sh': 'echo "1 passed"\n', 'notes.typ': 'committed\n',
  }, mods, { '.work/run/state.json': '{}' })
  function workflowsRepo() {
    const wf = repo('wf', { 'scripts/test.sh': FAKE_SUITE, 'release.txt': 'committed\n' }, { 'release.txt': 'WIP\n' }, { 'test2.js': '' })
    spawnSync('cp', [CANARY, join(wf.dir, 'scripts/canary.sh')], { timeout: 10_000 })
    spawnSync('chmod', ['+x', join(wf.dir, 'scripts/test.sh')], { timeout: 10_000 })
    return wf
  }
  function fakeCanary(wfDir: string, env: Record<string, string>) {
    const tmp = mkdtempSync(join(root, 'dry-'))
    const r = spawnSync('bash', [join(wfDir, 'scripts/canary.sh'), '--dry-run', '--only', 'suites'], {
      encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, CANARY_TMP: tmp, CANARY_STATE: join(tmp, 'state'), CANARY_NESTED: '', ...env },
    })
    return { status: r.status, out: r.stdout + r.stderr }
  }

  test('the workflows suite runs on the committed HEAD in a clean worktree, never the dirty main checkout', () => {
    const wf = workflowsRepo()
    const t = teachingRepo()
    const before = wf.git('status', '--porcelain').stdout
    expect(before).toContain(' M release.txt')
    const r = fakeCanary(wf.dir, { CANARY_TEACHING: t.dir })
    expect(r.out).not.toContain('suite read uncommitted WIP')
    expect(r.out).toContain(`=== canary suites: workflows at ${wf.head.slice(0, 12)} (committed HEAD, clean worktree`)
    expect(r.status).toBe(0)
    // Only the worktree it minted is gone; the main checkout's WIP and untracked files are untouched.
    expect(wf.git('worktree', 'list', '--porcelain').stdout.match(/^worktree /gm)?.length).toBe(1)
    expect(wf.git('status', '--porcelain').stdout).toBe(before)
  })

  test('a teaching checkout with uncommitted changes to tracked files FAILS naming them; untracked .work/ is fine', () => {
    const wf = workflowsRepo()
    const clean = fakeCanary(wf.dir, { CANARY_TEACHING: teachingRepo().dir })
    expect(clean.out).not.toContain('FAIL [suites] teaching')
    expect(clean.status).toBe(0)

    const dirty = fakeCanary(wf.dir, { CANARY_TEACHING: teachingRepo({ 'notes.typ': 'WIP\n' }).dir })
    expect(dirty.status).toBe(1)
    expect(dirty.out).toContain('FAIL [suites] teaching checkout has uncommitted changes to tracked files')
    expect(dirty.out).toContain('M notes.typ')
    expect(dirty.out).not.toContain('.work/')
  })
})
