/**
 * One session, several work runs: every run's hold survives the next dispatch.
 *
 * Measured 2026-10-02, session e3b75752 in ~/areas/secreg: three dispatches armed three holds into
 * ONE per-session state file, each overwriting the last, so the slides-diagnose run's hold vanished
 * when the notes run was dispatched, with no line saying so. The same session's notes plan said
 * `goalTurns: 3` and its hold printed "ceiling: 6 rounds" — the dispatch passed args.maxRounds
 * (absent, so 6) and read goalTurns into a variable nothing used.
 *
 * Holds stay in the ONE state object (State Files iron law): the newest is evaluated, the rest wait
 * in `queued`, a re-dispatch of the SAME plan replaces its own earlier hold, and a release promotes
 * the next hold instead of deleting the file.
 *
 * Run: bun test tests/work-hold-multi-run.test.ts
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'

setDefaultTimeout(60_000)
const mkTmp = useTmp()
const REPO = join(import.meta.dir, '..')
const ARM = join(REPO, 'skills/work/scripts/work-hold.sh')
const HOOK = join(REPO, 'hooks/work-hold.ts')
const ABANDON = join(REPO, 'skills/work/scripts/work-abandon.sh')
const SID = 'multi-run-test'

function world() {
  const dir = mkTmp('hold-multi-')
  const tmp = join(dir, 'tmp')
  mkdirSync(tmp)
  return { dir, tmp, state: join(tmp, `work-hold-${SID}.json`), ledger: join(tmp, `work-hold-${SID}.releases.log`) }
}
type W = ReturnType<typeof world>

/** A run dir as work-dispatch.sh leaves it: args.json naming its plan; result.json once it returned. */
function runDir(w: W, name: string, plan: string, done = false): string {
  const r = join(w.dir, 'runs', name)
  mkdirSync(r, { recursive: true })
  writeFileSync(join(r, 'args.json'), JSON.stringify({ planPath: plan, specHash: name }))
  if (done) writeFileSync(join(r, 'result.json'), '{"overallPass":false}')
  return r
}

const env = (w: W) => ({ ...HERMETIC_ENV, TMPDIR: w.tmp, CLAUDE_CODE_SESSION_ID: SID, WORK_HOLD_COMPACT_WINDOW: '0' })

function arm(w: W, check: string, run: string) {
  return spawnSync('bash', [ARM, check, '--run', run, '--rounds', '3', '--minutes', '60'], { encoding: 'utf8', timeout: 60_000, env: env(w) })
}

function stop(w: W) {
  return spawnSync('bun', [HOOK], { input: JSON.stringify({ session_id: SID }), encoding: 'utf8', timeout: 60_000, env: env(w) })
}

const read = (w: W) => JSON.parse(readFileSync(w.state, 'utf8'))

describe('a second dispatch keeps the first run\'s hold', () => {
  test('arming run B while run A is held keeps A, and says so', () => {
    const w = world()
    const a = runDir(w, 'A', '/plans/slides.md')
    const b = runDir(w, 'B', '/plans/notes.md')
    expect(arm(w, 'exit 1', a).status).toBe(0)
    const r = arm(w, 'exit 1', b)
    expect(r.status).toBe(0)
    const s = read(w)
    expect(s.run).toBe(b)
    expect((s.queued ?? []).map((q: any) => q.run)).toEqual([a])
    expect(r.stdout).toContain(`also holding: ${a}`)
  })

  test('a re-dispatch of the SAME plan replaces its own earlier hold, out loud', () => {
    const w = world()
    const a1 = runDir(w, 'A1', '/plans/notes.md')
    const a2 = runDir(w, 'A2', '/plans/notes.md')
    arm(w, 'exit 1', a1)
    const r = arm(w, 'exit 1', a2)
    const s = read(w)
    expect(s.run).toBe(a2)
    expect(s.queued ?? []).toEqual([])
    expect(r.stdout).toContain(`replaces the hold on ${a1}`)
  })
})

describe('the Stop hook covers every held run', () => {
  test('the newest run in flight does not excuse an older run whose verdict is in and whose check is red', () => {
    const w = world()
    const a = runDir(w, 'A', '/plans/slides.md', true)
    const b = runDir(w, 'B', '/plans/notes.md')
    arm(w, 'exit 1', a)
    arm(w, 'exit 1', b)
    const r = stop(w)
    const out = JSON.parse(r.stdout || '{}')
    expect(out.decision).toBe('block')
    expect(read(w).run).toBe(a)
  })

  test('every held run in flight: the stop is allowed and nothing is counted', () => {
    const w = world()
    arm(w, 'exit 1', runDir(w, 'A', '/plans/slides.md'))
    arm(w, 'exit 1', runDir(w, 'B', '/plans/notes.md'))
    const r = stop(w)
    expect(r.stdout.trim()).toBe('')
    const s = read(w)
    expect(s.rounds).toBe(0)
    expect(s.queued[0].rounds).toBe(0)
  })

  test('releasing one hold promotes the next instead of deleting the state', () => {
    const w = world()
    const a = runDir(w, 'A', '/plans/slides.md')
    const b = runDir(w, 'B', '/plans/notes.md', true)
    arm(w, 'exit 1', a)
    arm(w, 'exit 1', b)
    // B's check goes green: B releases, A stays held.
    const s = read(w)
    s.check = 'true'
    writeFileSync(w.state, JSON.stringify(s))
    const r = stop(w)
    expect(r.stderr).toContain('1 other hold(s) still armed')
    expect(existsSync(w.state)).toBe(true)
    expect(read(w).run).toBe(a)
    // The ledger's last word is an arm again, so deleting the file cannot escape the promoted hold.
    const last = readFileSync(w.ledger, 'utf8').trim().split('\n').pop()!
    expect(last.split('\t')[1]).toMatch(/^armed/)
  })

  test('work-abandon.sh on one run releases only that run\'s hold', () => {
    const w = world()
    const a = runDir(w, 'A', '/plans/slides.md')
    const b = runDir(w, 'B', '/plans/notes.md')
    arm(w, 'exit 1', a)
    arm(w, 'exit 1', b)
    const r = spawnSync('bash', [ABANDON, a, '--why', 'test'], { encoding: 'utf8', timeout: 60_000, env: env(w) })
    expect(r.status).toBe(0)
    const s = read(w)
    expect(s.run).toBe(b)
    expect(s.queued ?? []).toEqual([])
  })
})

describe('the round ceiling comes from the plan\'s goalTurns', () => {
  function script(dir: string, name: string, body: string) {
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    const p = join(dir, 'scripts', name)
    writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
    chmodSync(p, 0o755)
    return p
  }
  function dispatched(block: Record<string, unknown>) {
    const w = world()
    const proj = join(w.dir, 'proj')
    mkdirSync(join(proj, 'src'), { recursive: true })
    script(proj, 'check.sh', 'echo "1 failed"\nexit 1')
    const farm = script(proj, 'stub-farm.sh', 'exit 0')
    const plan = join(proj, 'plan.md')
    const args = {
      projectDir: proj, goal: 'make it right', mechanicalChecks: [],
      lens: { agentType: 'Explore', refs: [], prompt: 'raise MAJOR when wrong' },
      tasks: [{ id: 'T1', name: 'one', work: 'do it', writablePaths: ['src/'], refs: [],
        redCommand: 'bash scripts/check.sh', acceptance: '`bash scripts/check.sh` exits 0' }],
    }
    writeFileSync(plan, `# Plan\n\n<!-- work:dispatch\n${JSON.stringify({ runId: 'gt-run', ...block, args }, null, 2)}\n-->\n`)
    const r = spawnSync('bash', [join(REPO, 'skills/work/scripts/work-dispatch.sh'), '--provider', 'claude', '--loops', '0', plan], {
      encoding: 'utf8', timeout: 180_000, cwd: proj,
      env: { ...env(w), WORK_NO_SCOPE: '1', WORK_FARM: farm },
    })
    return { r, s: existsSync(w.state) ? read(w) : null }
  }

  test('goalTurns 3 arms a 3-round hold, not the maxRounds default of 6', () => {
    const { r, s } = dispatched({ goalTurns: 3 })
    expect(r.status).toBe(0)
    expect(s.maxRounds).toBe(3)
    expect(r.stdout).toContain('ceiling: 3 rounds')
  })
})
