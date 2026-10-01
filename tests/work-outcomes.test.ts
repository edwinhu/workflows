/**
 * work-outcomes.ts <run-dir> — a finished work round's per-task outcomes, appended to the farm
 * outcomes file so work rows join the labelled dataset Jev graduates on (docs/DESIGN-routing.md).
 *
 * One `row` line per task:
 *   {type:"row", rowId:"work:<runId>:r<round>:<taskId>", ts, cwd:<projectDir>, label:"<runId>/<taskId>",
 *    kind:<task.kind ?? "judgement">, route:{source,provider,model,candidate}, shadow, source:"work",
 *    red:<red verdict | null>, verified:<pass | null>}
 * and, for a task the verifier reached, one `verdict` line:
 *   {type:"verdict", rowId, verdict:"correct"|"wrong", why:"work verifier"[+" + red-green"], ts, auto:true}
 * correct iff pass AND (no redCommand OR red verdict is red-green). round = result-round*.json count + 1.
 * runId is the run directory's basename (args.json carries none). Idempotent by rowId. No prompt or
 * task `work` text is ever written.
 *
 * work-loop.sh calls it once per accepted round; the last describe drives work-loop.sh hermetically.
 *
 * Every spawn sets FARM_OUTCOMES to a temp file: the real ~/.local/state file is never touched.
 *
 * Run: bun test ./tests/work-outcomes.test.ts
 */
import { describe, expect, test, afterAll, setDefaultTimeout } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'

setDefaultTimeout(60_000)

const ROOT = join(import.meta.dir, '..')
const OUTCOMES = join(ROOT, 'skills/work/scripts/work-outcomes.ts')
const LOOP = join(ROOT, 'skills/work/scripts/work-loop.sh')
const FIXTURE_RESULT = join(import.meta.dir, 'fixtures/work-outcomes/result.json')
const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

function tmp(prefix: string) {
  const d = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(d)
  return d
}

function env(dir: string, extra: Record<string, string> = {}): Record<string, string> {
  const { FARM_OUTCOMES: _o, ROUTING_TABLE: _t, WORK_HOLD_DECISIONS_MODEL: _m, ...base } = HERMETIC_ENV
  return {
    ...base,
    TMPDIR: dir,
    FARM_OUTCOMES: join(dir, 'farm-outcomes.jsonl'),
    WORK_HOLD_DECISIONS_URL: 'http://127.0.0.1:1/',
    WORK_HOLD_JUDGE_TOKEN: 'test-token',
    WORK_FARM: '/bin/false',
    ...extra,
  }
}

/** A run directory `.work/<runId>/` holding args.json, result.json and any earlier rounds. */
function runDir(runId: string, args: object, result: object, earlierRounds = 0) {
  const dir = tmp('work-outcomes-')
  const R = join(dir, '.work', runId)
  mkdirSync(R, { recursive: true })
  writeFileSync(join(R, 'args.json'), JSON.stringify({ projectDir: dir, goal: 'g', ...args }, null, 2))
  writeFileSync(join(R, 'result.json'), JSON.stringify(result, null, 2))
  for (let i = 1; i <= earlierRounds; i++)
    writeFileSync(join(R, `result-round${i}.json`), JSON.stringify({ overallPass: false, verdict: 'FAIL' }))
  return { dir, R, outcomes: join(dir, 'farm-outcomes.jsonl') }
}

async function outcomes(f: { dir: string; R: string }, extra: Record<string, string> = {}) {
  const p = Bun.spawn(['bun', OUTCOMES, f.R], { cwd: f.dir, env: env(f.dir, extra), stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { code, stdout, stderr }
}

const lines = (path: string): any[] =>
  existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
const rows = (path: string) => lines(path).filter(l => l.type === 'row')
const verdicts = (path: string) => lines(path).filter(l => l.type === 'verdict')
const byRow = (path: string, rowId: string) => lines(path).filter(l => l.rowId === rowId)

const task = (id: string, over: object = {}) =>
  ({ id, name: id, work: `do ${id}`, acceptance: 'a', writablePaths: ['src/'], refs: [], ...over })
const shadow = { unavailable: 'decisions endpoint unreachable' }
const decision = (kind: string, provider: string, model: string, candidate: string) =>
  ({ provider, model, kind, candidate, source: 'table', shadow })

// ------------------------------------------------------------------------------- row lines

describe('row lines: one per task, routed from args.routing', () => {
  const ROUTED = {
    routing: {
      kindModels: { judgement: 'claude-opus-5-5', script: 'gemini-3.7-flash-high', review: 'claude-sonnet-5-5' },
      source: 'table',
      decisions: {
        judgement: decision('judgement', 'claude', 'claude-opus-5-5', 'opus'),
        script: decision('script', 'gemini', 'gemini-3.7-flash-high', 'flash'),
        review: decision('review', 'claude', 'claude-sonnet-5-5', 'sonnet'),
      },
    },
    tasks: [task('T1'), task('T2', { kind: 'script' })],
  }
  const RESULT = {
    overallPass: true, verdict: 'PASS',
    verified: [{ id: 'T1', pass: true, evidence: 'e', failures: [] }, { id: 'T2', pass: true, evidence: 'e', failures: [] }],
    red: [],
  }

  test('exits 0 and writes exactly one row line per task, all fields present', async () => {
    const f = runDir('route-run', ROUTED, RESULT)
    const r = await outcomes(f)
    expect(r.code).toBe(0)
    const rs = rows(f.outcomes)
    expect(rs.map(x => x.rowId).sort()).toEqual(['work:route-run:r1:T1', 'work:route-run:r1:T2'])
    const t1 = rs.find(x => x.rowId === 'work:route-run:r1:T1')
    expect(t1).toMatchObject({
      type: 'row', cwd: f.dir, label: 'route-run/T1', kind: 'judgement', source: 'work', red: null, verified: true,
    })
    expect(typeof t1.ts).toBe('string')
    expect(Number.isNaN(Date.parse(t1.ts))).toBe(false)
  })

  test("a task's route is its kind's decision; kind defaults to judgement", async () => {
    const f = runDir('route-run', ROUTED, RESULT)
    expect((await outcomes(f)).code).toBe(0)
    const [t1] = byRow(f.outcomes, 'work:route-run:r1:T1').filter(l => l.type === 'row')
    const [t2] = byRow(f.outcomes, 'work:route-run:r1:T2').filter(l => l.type === 'row')
    expect(t1?.route).toEqual({ source: 'table', provider: 'claude', model: 'claude-opus-5-5', candidate: 'opus' })
    expect(t2?.kind).toBe('script')
    expect(t2?.route).toEqual({ source: 'table', provider: 'gemini', model: 'gemini-3.7-flash-high', candidate: 'flash' })
    expect(t2?.shadow).toEqual(shadow)
  })

  test('a --provider run falls back to {source: flag, provider, model: implementerModel, candidate: null}', async () => {
    const f = runDir('flag-run', { routing: { source: 'flag', provider: 'codex' }, implementerModel: 'gpt-6.1-sol', tasks: [task('T1')] }, RESULT)
    expect((await outcomes(f)).code).toBe(0)
    const [t1] = rows(f.outcomes)
    expect(t1?.route).toEqual({ source: 'flag', provider: 'codex', model: 'gpt-6.1-sol', candidate: null })
    expect('shadow' in (t1 ?? {})).toBe(true)
  })

  test('a flag route with no implementerModel records model null', async () => {
    const f = runDir('flag-run', { routing: { source: 'flag', provider: 'claude' }, tasks: [task('T1')] }, RESULT)
    expect((await outcomes(f)).code).toBe(0)
    expect(rows(f.outcomes)[0]?.route).toEqual({ source: 'flag', provider: 'claude', model: null, candidate: null })
  })

  test('round is the count of result-round*.json plus one', async () => {
    const f = runDir('round-run', ROUTED, RESULT, 2)
    expect((await outcomes(f)).code).toBe(0)
    expect(rows(f.outcomes).map(x => x.rowId).sort()).toEqual(['work:round-run:r3:T1', 'work:round-run:r3:T2'])
  })
})

// --------------------------------------------------------------------------- verdict lines

describe('verdict lines: correct iff pass and (no redCommand or red-green)', () => {
  const ARGS = {
    routing: { source: 'flag', provider: 'claude' },
    tasks: [
      task('T1', { redCommand: 'bash t1.sh' }),
      task('T2', { redCommand: 'bash t2.sh' }),
      task('T3', { redCommand: 'bash t3.sh' }),
      task('T4'),
      task('T5'),
      task('T6', { redCommand: 'bash t6.sh' }),
    ],
  }
  const RESULT = {
    overallPass: false, verdict: 'FAIL',
    verified: [
      { id: 'T1', pass: true, evidence: 'e', failures: [] },
      { id: 'T2', pass: false, evidence: 'e', failures: ['x'] },
      { id: 'T3', pass: true, evidence: 'e', failures: [] },
      { id: 'T4', pass: true, evidence: 'e', failures: [] },
      { id: 'T5', pass: false, evidence: 'e', failures: ['x'] },
    ],
    red: [
      { id: 'T1', command: 'bash t1.sh', verdict: 'red-green' },
      { id: 'T2', command: 'bash t2.sh', verdict: 'red-green' },
      { id: 'T3', command: 'bash t3.sh', verdict: 'red-not-red' },
    ],
  }
  const id = (t: string) => `work:v-run:r1:${t}`

  test('each reached task gets the verdict its pass and red verdict decide', async () => {
    const f = runDir('v-run', ARGS, RESULT)
    expect((await outcomes(f)).code).toBe(0)
    const v = Object.fromEntries(verdicts(f.outcomes).map(l => [l.rowId, l]))
    expect(v[id('T1')]).toMatchObject({ type: 'verdict', verdict: 'correct', why: 'work verifier + red-green', auto: true })
    expect(v[id('T2')]).toMatchObject({ verdict: 'wrong', why: 'work verifier + red-green', auto: true })
    expect(v[id('T3')]).toMatchObject({ verdict: 'wrong', why: 'work verifier', auto: true })
    expect(v[id('T4')]).toMatchObject({ verdict: 'correct', why: 'work verifier', auto: true })
    expect(v[id('T5')]).toMatchObject({ verdict: 'wrong', why: 'work verifier', auto: true })
    expect(typeof v[id('T1')]?.ts).toBe('string')
  })

  test("the row line carries the task's red verdict and pass", async () => {
    const f = runDir('v-run', ARGS, RESULT)
    expect((await outcomes(f)).code).toBe(0)
    const r = Object.fromEntries(rows(f.outcomes).map(l => [l.rowId, l]))
    expect({ red: r[id('T1')]?.red, verified: r[id('T1')]?.verified }).toEqual({ red: 'red-green', verified: true })
    expect({ red: r[id('T3')]?.red, verified: r[id('T3')]?.verified }).toEqual({ red: 'red-not-red', verified: true })
    expect({ red: r[id('T5')]?.red, verified: r[id('T5')]?.verified }).toEqual({ red: null, verified: false })
  })

  test('a task never reached gets its row line, verified null, and no verdict line', async () => {
    const f = runDir('v-run', ARGS, RESULT)
    expect((await outcomes(f)).code).toBe(0)
    const t6 = byRow(f.outcomes, id('T6'))
    expect(t6.map(l => l.type)).toEqual(['row'])
    expect(t6[0]).toMatchObject({ red: null, verified: null })
  })

  test('a second run over the same round appends nothing', async () => {
    const f = runDir('v-run', ARGS, RESULT)
    expect((await outcomes(f)).code).toBe(0)
    const first = readFileSync(f.outcomes, 'utf8')
    expect(first.length).toBeGreaterThan(0)
    expect((await outcomes(f)).code).toBe(0)
    expect(readFileSync(f.outcomes, 'utf8')).toBe(first)
  })

  test('an existing file is appended to, never rewritten', async () => {
    const f = runDir('v-run', ARGS, RESULT)
    const prior = JSON.stringify({ type: 'row', rowId: 'farm:other:1', ts: '2026-10-01T00:00:00Z' }) + '\n'
    writeFileSync(f.outcomes, prior)
    expect((await outcomes(f)).code).toBe(0)
    const body = readFileSync(f.outcomes, 'utf8')
    expect(body.startsWith(prior)).toBe(true)
    expect(rows(f.outcomes).length).toBe(1 + ARGS.tasks.length)
  })

  test('no task work text or prompt reaches the file', async () => {
    const SECRET = 'SECRET-WORK-TEXT-7f3a'
    const f = runDir('v-run', {
      ...ARGS, goal: `goal ${SECRET}-goal`,
      tasks: ARGS.tasks.map(t => ({ ...t, work: `${SECRET} ${t.id}`, prompt: `${SECRET}-prompt` })),
    }, RESULT)
    expect((await outcomes(f)).code).toBe(0)
    const body = readFileSync(f.outcomes, 'utf8')
    expect(rows(f.outcomes).length).toBe(ARGS.tasks.length)
    expect(body).not.toContain(SECRET)
  })
})

// --------------------------------------------------------------------- the real trimmed run

describe('a trimmed real result.json (.work/1001-farm-routing, round 1)', () => {
  // The real run's args, minus prose: T1-T3 are red-gated, T4 is not. No `routing` (it predates it),
  // so every route is the flag fallback carrying implementerModel.
  const ARGS = {
    implementerModel: 'claude-opus-5-5', verifierModel: 'claude-sonnet-5-5', probeModel: 'claude-sonnet-5-5',
    tasks: [
      task('T1', { redCommand: 'bun test tests/route.test.ts' }),
      task('T2', { redCommand: 'bun test tests/route-refresh.test.ts' }),
      task('T3', { redCommand: 'bun test tests/farm-routing.test.ts' }),
      task('T4'),
    ],
  }

  test('four rows, four correct verdicts, red-green named for exactly T1-T3', async () => {
    const f = runDir('1001-farm-routing', ARGS, JSON.parse(readFileSync(FIXTURE_RESULT, 'utf8')), 1)
    expect((await outcomes(f)).code).toBe(0)
    expect(rows(f.outcomes).map(r => r.rowId).sort()).toEqual(
      ['T1', 'T2', 'T3', 'T4'].map(t => `work:1001-farm-routing:r2:${t}`))
    const v = Object.fromEntries(verdicts(f.outcomes).map(l => [l.rowId.split(':').pop(), [l.verdict, l.why]]))
    expect(v).toEqual({
      T1: ['correct', 'work verifier + red-green'],
      T2: ['correct', 'work verifier + red-green'],
      T3: ['correct', 'work verifier + red-green'],
      T4: ['correct', 'work verifier'],
    })
    for (const r of rows(f.outcomes)) {
      expect(r.route?.source).toBe('flag')
      expect(r.route?.model).toBe('claude-opus-5-5')
      expect(r.route?.candidate).toBeNull()
    }
  })
})

// ------------------------------------------------------------------- work-loop.sh calls it

describe('work-loop.sh records outcomes once per accepted round (hermetic)', () => {
  /** work-loop.test.ts's run directory, with verified/red so a verdict line is due. */
  function loopDir(pass: boolean) {
    const dir = tmp('work-outcomes-loop-')
    const R = join(dir, '.work', 'loop-run')
    mkdirSync(R, { recursive: true })
    const plan = join(dir, 'plan.md')
    const args = {
      projectDir: dir, goal: 'drive the loop', planPath: plan, mechanicalChecks: [],
      tasks: [{
        id: 'T1', name: 'one', work: 'do the thing', writablePaths: ['src/'], refs: [],
        redCommand: 'bash scripts/check.sh', acceptance: '`bash scripts/check.sh` exits 0',
      }],
    }
    writeFileSync(join(R, 'args.json'), JSON.stringify(args, null, 2))
    writeFileSync(plan, '# Plan\n\n## Run sizing\n\nnothing parked\n\n' +
      `<!-- work:dispatch\n${JSON.stringify({ runId: 'loop-run', args }, null, 2)}\n-->\n`)
    writeFileSync(join(R, 'result.json'), JSON.stringify({
      overallPass: pass, verdict: pass ? 'PASS' : 'FAIL', scoreTable: { tasksTotal: 1 }, findings: [],
      tasksThatFlagged: pass ? [] : ['T1'], mechanicalThatFailed: [], lensesThatFlagged: [], mechanical: [],
      verified: [{ id: 'T1', pass, evidence: 'e', failures: pass ? [] : ['x'] }],
      red: [{ id: 'T1', command: 'bash scripts/check.sh', verdict: 'red-green' }],
    }, null, 2))
    writeFileSync(join(R, 'run.log'), 'stub run log\n')
    return { dir, R, plan, outcomes: join(dir, 'farm-outcomes.jsonl') }
  }

  async function loop(f: { dir: string; R: string; plan: string }, loops: number) {
    const p = Bun.spawn(['bash', LOOP, '--provider', 'claude', '--run-dir', f.R, '--plan', f.plan, '--loops', String(loops)], {
      cwd: f.dir, env: env(f.dir, { WORK_LOOP_POLL: '1' }), stdout: 'pipe', stderr: 'pipe',
    })
    const killer = setTimeout(() => p.kill(), 50_000)
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
    clearTimeout(killer)
    return { code, out: out + err }
  }

  test('a PASS round exits 0 and leaves its row and correct verdict', async () => {
    const f = loopDir(true)
    const r = await loop(f, 3)
    expect(r.code).toBe(0)
    const t1 = byRow(f.outcomes, 'work:loop-run:r1:T1')
    expect(t1.map(l => l.type).sort()).toEqual(['row', 'verdict'])
    expect(t1.find(l => l.type === 'verdict')?.verdict).toBe('correct')
  })

  test('a FAIL round at the cap exits 6 and still leaves its row and wrong verdict', async () => {
    const f = loopDir(false)
    const r = await loop(f, 1)
    expect(r.code).toBe(6)
    const t1 = byRow(f.outcomes, 'work:loop-run:r1:T1')
    expect(t1.map(l => l.type).sort()).toEqual(['row', 'verdict'])
    expect(t1.find(l => l.type === 'verdict')?.verdict).toBe('wrong')
  })
})
