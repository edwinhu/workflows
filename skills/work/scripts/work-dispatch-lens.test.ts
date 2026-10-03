// <!-- wc-probe: ignore-refs -->
// Fixtures below are executed, not declared: the task rows and lenses are INPUT to the dispatcher.
/**
 * `lensProvider` — the plan arg that picks the lens's provider, resolved through route.ts.
 *
 *   no --provider, lensProvider P   the review row sent to route.ts carries provider:P; the other kinds
 *                                   are unchanged; kindModels.review and decisions.review are the
 *                                   provider-constrained answer; still <= 4 route.ts calls per round
 *   --provider X, lensProvider P    exactly ONE route.ts call (the review row, provider:P);
 *                                   routing = {source:'flag', provider:X, lens:<decision verbatim>},
 *                                   args.lens.model = decision.model, the plan's other lens fields
 *                                   untouched, and NO args.lensModel (workflow.js's normalised lens
 *                                   default model would beat it)
 *   no --provider, lensProvider P   args.lens.model stays absent: kindModels.review carries the model
 *   --provider X, no lensProvider   zero route.ts calls
 *   invalid lensProvider, or lensProvider with lens.model / lensModel, or a route.ts refusal for the
 *   review row                      non-zero before args.json is written or anything launches;
 *                                   stderr names lensProvider
 *
 * Both dispatchers are covered. Every route.ts call is observed through a `bun` shim at the head of
 * PATH: it runs the real bun, then appends {argv, stdout, code} to a call log, so a case asserts how
 * many calls were made and the row each received. The dispatchers' Python helper spawns `bun` by PATH
 * lookup, which is what makes the shim see them.
 *
 * Hermetic: ROUTING_TABLE is tests/fixtures/routing/provider-chain.json, the Decisions API is the dead
 * port, FARM_OUTCOMES is a temp file; work-dispatch.sh runs under WORK_DISPATCH_DRYRUN=1 and
 * work-redispatch.sh against a farm.sh stub with WORK_NO_SCOPE=1, as work-dispatch-routing.test.ts does.
 *
 * Run: bun test skills/work/scripts/work-dispatch-lens.test.ts
 */
import { describe, expect, test, afterAll, setDefaultTimeout } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HERMETIC_ENV } from '../../../tests/helpers/hermetic-env'

setDefaultTimeout(60_000)

const DISPATCH = `${import.meta.dir}/work-dispatch.sh`
const REDISPATCH = `${import.meta.dir}/work-redispatch.sh`
const FIXTURE_TABLE = join(import.meta.dir, '../../../tests/fixtures/routing/provider-chain.json')
const DEAD = 'http://127.0.0.1:1/'
const REAL_BUN = process.execPath
const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

function tmp(prefix: string) {
  const d = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(d)
  return d
}

function tableCopy(edit: (t: any) => void): string {
  const t = JSON.parse(readFileSync(FIXTURE_TABLE, 'utf8'))
  edit(t)
  const p = join(tmp('lens-table-'), 'table.json')
  writeFileSync(p, JSON.stringify(t, null, 2))
  return p
}

/** sol is the only available codex candidate in review's chain; without it a codex review row refuses. */
const codexRefuses = () => tableCopy(t => { t.candidates.sol.available = false })

// ---------------------------------------------------------------- the route.ts call log

/** A directory holding a `bun` that logs every route.ts call and passes everything else through. */
function bunShim(dir: string) {
  const bin = join(dir, 'shim-bin')
  mkdirSync(bin, { recursive: true })
  const log = join(dir, 'route-calls.jsonl')
  const p = join(bin, 'bun')
  writeFileSync(p, `#!/usr/bin/env bash
case "$1" in
  */scripts/lib/route.ts)
    out=$('${REAL_BUN}' "$@"); code=$?
    python3 -c 'import json, sys; print(json.dumps({"argv": sys.argv[1:-2], "stdout": sys.argv[-2], "code": int(sys.argv[-1])}))' "$@" "$out" "$code" >> '${log}'
    [ -n "$out" ] && printf '%s\\n' "$out"
    exit "$code" ;;
esac
exec '${REAL_BUN}' "$@"
`)
  chmodSync(p, 0o755)
  return { bin, log }
}

type Call = { argv: string[]; stdout: string; code: number; row: any }

function calls(log: string): Call[] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => {
    const c = JSON.parse(l)
    const i = c.argv.indexOf('--row')
    return { ...c, row: i >= 0 ? JSON.parse(c.argv[i + 1]) : null }
  })
}

// ---------------------------------------------------------------- env, spawn, fixtures

function env(dir: string, extra: Record<string, string> = {}): Record<string, string> {
  const { WORK_HOLD_DECISIONS_MODEL: _m, ROUTING_TABLE: _t, FARM_OUTCOMES: _o, ...base } = HERMETIC_ENV
  const shim = bunShim(dir)
  return {
    ...base,
    PATH: `${shim.bin}:${base.PATH ?? ''}`,
    TMPDIR: dir,
    ROUTING_TABLE: FIXTURE_TABLE,
    WORK_HOLD_DECISIONS_URL: DEAD,
    WORK_HOLD_JUDGE_TOKEN: 'test-token',
    FARM_OUTCOMES: join(dir, 'farm-outcomes.jsonl'),
    WORK_FARM: '/bin/false',
    ...extra,
  }
}

type Run = { code: number; stdout: string; stderr: string }

async function spawn(cmd: string[], cwd: string, e: Record<string, string>): Promise<Run> {
  const p = Bun.spawn(cmd, { cwd, env: e, stdout: 'pipe', stderr: 'pipe' })
  const killer = setTimeout(() => p.kill(), 50_000)
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited,
  ])
  clearTimeout(killer)
  return { code, stdout, stderr }
}

function redScript(dir: string) {
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  const p = join(dir, 'scripts', 'check.sh')
  writeFileSync(p, '#!/usr/bin/env bash\necho "1 failed, 0 passed"\nexit 1\n')
  chmodSync(p, 0o755)
}

/** The plan's lens; under --provider with lensProvider only `model` may be added to it. */
const PLAN_LENS = { agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' } as const

function cleanArgs(dir: string, over: object = {}) {
  return {
    projectDir: dir,
    goal: 'make the thing correct',
    tasks: [{
      id: 'T1', name: 'one', work: 'do the thing', writablePaths: ['src/'], refs: [],
      redCommand: 'bash scripts/check.sh', acceptance: '`bash scripts/check.sh` exits 0',
    }],
    mechanicalChecks: [{ name: 'tests', cmd: 'bun test' }],
    lens: PLAN_LENS,
    ...over,
  }
}

function planFile(dir: string, runId: string, args: object) {
  const plan = join(dir, 'plan.md')
  writeFileSync(plan, '# Plan\n\n## Run sizing\n\nnothing parked\n\n' +
    `<!-- work:dispatch\n${JSON.stringify({ runId, args }, null, 2)}\n-->\n`)
  return plan
}

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'))

/** The provider-constrained answer for each lensProvider under provider-chain.json. */
const LENS = {
  codex: { provider: 'codex', model: 'gpt-6.1-sol', kind: 'review', candidate: 'sol', source: 'table' },
  gemini: { provider: 'gemini', model: 'gemini-3.8-flash-high', kind: 'review', candidate: 'flash38', source: 'table' },
  claude: { provider: 'claude', model: 'claude-sonnet-5-5', kind: 'review', candidate: 'sonnet', source: 'table' },
} as const

/** A logged decision is a constrained one: exactly these fields. */
function expectConstrained(d: any, want: object) {
  expect(d).toEqual(want)
}

/** Every call made without --provider: <= 4, each kind once, provider only on the review row. */
function expectRoundCalls(log: Call[], lensProvider: string) {
  expect(log.length).toBeLessThanOrEqual(4)
  const withProvider = log.filter(c => c.row && 'provider' in c.row)
  expect(withProvider).toHaveLength(1)
  expect(withProvider[0].row).toMatchObject({ kind: 'review', provider: lensProvider })
  expect(withProvider[0].row.model).toBeUndefined()
  for (const k of ['judgement', 'script']) {
    const ofKind = log.filter(c => c.row?.kind === k)
    expect({ k, n: ofKind.length }).toEqual({ k, n: 1 })
    expect({ k, provider: ofKind[0].row.provider }).toEqual({ k, provider: undefined })
  }
  for (const c of log) expect(c.code).toBe(0)
  return withProvider[0]
}

// ------------------------------------------------------------------------- work-dispatch.sh

function dispatchFixture(argsOver: object = {}) {
  const dir = tmp('work-dispatch-lens-')
  mkdirSync(join(dir, 'src'), { recursive: true })
  redScript(dir)
  const plan = planFile(dir, 'lens-run', cleanArgs(dir, argsOver))
  return {
    dir, plan,
    argsPath: join(dir, '.work', 'lens-run', 'args.json'),
    log: join(dir, 'route-calls.jsonl'),
  }
}

function dispatch(f: { dir: string; plan: string }, flags: string[] = [], extra: Record<string, string> = {}) {
  return spawn(['bash', DISPATCH, ...flags, f.plan], f.dir, env(f.dir, { WORK_DISPATCH_DRYRUN: '1', ...extra }))
}

describe('work-dispatch.sh, no --provider: lensProvider constrains the review row', () => {
  const KIND_MODEL = { codex: 'gpt-6.1-sol', gemini: 'gemini-3.8-flash-high', claude: 'claude-sonnet-5-5' } as const
  for (const p of ['codex', 'gemini', 'claude'] as const) {
    test(`lensProvider ${p}: kindModels.review is ${KIND_MODEL[p]}, decisions.review is the constrained call's output`, async () => {
      const f = dispatchFixture({ lensProvider: p })
      const r = await dispatch(f)
      expect({ code: r.code, stderr: r.code === 0 ? '' : r.stderr }).toEqual({ code: 0, stderr: '' })
      const log = calls(f.log)
      const review = expectRoundCalls(log, p)
      const routing = readJson(f.argsPath).routing
      expect(routing.kindModels).toEqual({
        judgement: 'claude-opus-5-5', script: 'claude-sonnet-5-5', review: KIND_MODEL[p],
      })
      expectConstrained(routing.decisions.review, LENS[p])
      expect(routing.decisions.review).toEqual(JSON.parse(review.stdout))
      expect('model' in readJson(f.argsPath).lens).toBe(false)
    })
  }

  test('without lensProvider no row carries a provider (today unchanged)', async () => {
    const f = dispatchFixture()
    const r = await dispatch(f)
    expect(r.code).toBe(0)
    const log = calls(f.log)
    expect(log.map(c => c.row.kind).sort()).toEqual(['judgement', 'review', 'script'])
    expect(log.filter(c => 'provider' in c.row)).toEqual([])
  })
})

describe('work-dispatch.sh with --provider', () => {
  test('and lensProvider: exactly one route.ts call, the review row; routing carries the decision as lens', async () => {
    const f = dispatchFixture({ lensProvider: 'codex' })
    const r = await dispatch(f, ['--provider', 'claude'])
    expect({ code: r.code, stderr: r.code === 0 ? '' : r.stderr }).toEqual({ code: 0, stderr: '' })
    const log = calls(f.log)
    expect(log).toHaveLength(1)
    expect(log[0].row).toMatchObject({ kind: 'review', provider: 'codex' })
    expect(log[0].row.model).toBeUndefined()
    const decision = JSON.parse(log[0].stdout)
    expectConstrained(decision, LENS.codex)
    const a = readJson(f.argsPath)
    expect(a.routing).toEqual({ source: 'flag', provider: 'claude', lens: decision })
    expect(a.lens).toEqual({ ...PLAN_LENS, model: decision.model })
    expect(a.lens.model).toBe('gpt-6.1-sol')
    expect('lensModel' in a).toBe(false)
  })

  test('and a gemini lensProvider: args.lens.model is gemini-3.8-flash-high, no args.lensModel', async () => {
    const f = dispatchFixture({ lensProvider: 'gemini' })
    const r = await dispatch(f, ['--provider', 'codex'])
    expect(r.code).toBe(0)
    const log = calls(f.log)
    expect(log).toHaveLength(1)
    expect(log[0].row).toMatchObject({ kind: 'review', provider: 'gemini' })
    const a = readJson(f.argsPath)
    expect(a.routing).toEqual({ source: 'flag', provider: 'codex', lens: JSON.parse(log[0].stdout) })
    expect(a.lens).toEqual({ ...PLAN_LENS, model: JSON.parse(log[0].stdout).model })
    expect(a.lens.model).toBe('gemini-3.8-flash-high')
    expect('lensModel' in a).toBe(false)
  })

  test('and no lensProvider: zero route.ts calls, routing is the bare flag', async () => {
    const f = dispatchFixture()
    const r = await dispatch(f, ['--provider', 'codex'])
    expect(r.code).toBe(0)
    expect(calls(f.log)).toEqual([])
    const a = readJson(f.argsPath)
    expect(a.routing).toEqual({ source: 'flag', provider: 'codex' })
    expect('lensModel' in a).toBe(false)
    expect(a.lens).toEqual(PLAN_LENS)
    expect('model' in a.lens).toBe(false)
  })
})

describe('work-dispatch.sh refuses a bad lensProvider before args.json is written', () => {
  const BAD: [string, object, string[]][] = [
    ['an invalid lensProvider', { lensProvider: 'openai' }, []],
    ['an invalid lensProvider, under --provider', { lensProvider: 'openai' }, ['--provider', 'claude']],
    ['lensProvider with lens.model', {
      lensProvider: 'codex',
      lens: { agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong', model: 'claude-opus-5-5' },
    }, []],
    ['lensProvider with lensModel', { lensProvider: 'codex', lensModel: 'claude-opus-5-5' }, []],
    ['lensProvider with lensModel, under --provider', { lensProvider: 'codex', lensModel: 'claude-opus-5-5' }, ['--provider', 'gemini']],
  ]
  for (const [name, over, flags] of BAD) {
    test(`${name}: non-zero, stderr names lensProvider, no args.json`, async () => {
      const f = dispatchFixture(over)
      const r = await dispatch(f, flags)
      expect(r.code).not.toBe(0)
      expect(r.stderr).toMatch(/lensProvider/)
      expect(existsSync(f.argsPath)).toBe(false)
    })
  }

  test('a route.ts refusal for the review row: non-zero, stderr names lensProvider and the refusal, no args.json', async () => {
    const f = dispatchFixture({ lensProvider: 'codex' })
    const r = await dispatch(f, [], { ROUTING_TABLE: codexRefuses() })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/lensProvider/)
    expect(r.stderr).toMatch(/review/)
    expect(r.stderr).toMatch(/codex/)
    expect(existsSync(f.argsPath)).toBe(false)
    // The refused call really was the constrained review row.
    const refused = calls(f.log).filter(c => c.code !== 0)
    expect(refused).toHaveLength(1)
    expect(refused[0].row).toMatchObject({ kind: 'review', provider: 'codex' })
    expect(refused[0].code).toBe(2)
  })

  test('the same refusal under --provider: non-zero, no args.json', async () => {
    const f = dispatchFixture({ lensProvider: 'codex' })
    const r = await dispatch(f, ['--provider', 'claude'], { ROUTING_TABLE: codexRefuses() })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/lensProvider/)
    expect(existsSync(f.argsPath)).toBe(false)
  })
})

// ---------------------------------------------------------------------- work-redispatch.sh

function farmStub(dir: string) {
  const marker = join(dir, 'farm-ran')
  const p = join(dir, 'farm-stub.sh')
  writeFileSync(p, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > '${marker}'\nexit 0\n`)
  chmodSync(p, 0o755)
  return { stub: p, marker }
}

/** A finished round 1 whose plan AND args.json both carry argsOver (e.g. lensProvider). */
function redispatchFixture(argsOver: object = {}) {
  const dir = tmp('work-redispatch-lens-')
  redScript(dir)
  const clean = cleanArgs(dir, argsOver)
  const plan = planFile(dir, 'gate-run', clean)
  const args = join(dir, 'args.json')
  writeFileSync(args, JSON.stringify({
    ...clean, planPath: plan, specHash: '0'.repeat(64), rounds: 1,
    routing: { kindModels: { judgement: 'stale-j', script: 'stale-s', review: 'stale-r' }, source: 'table', decisions: {} },
  }, null, 2) + '\n')
  writeFileSync(join(dir, 'result.json'), JSON.stringify({
    overallPass: false, verdict: 'FAIL', tasksThatFlagged: ['T1'], mechanicalThatFailed: [],
    lensesThatFlagged: [], findings: [],
  }, null, 2) + '\n')
  return { dir, plan, args, log: join(dir, 'route-calls.jsonl'), ...farmStub(dir) }
}

function redispatch(f: { dir: string; plan: string; args: string; stub: string }, flags: string[] = [], extra: Record<string, string> = {}) {
  return spawn(['bash', REDISPATCH, f.plan, f.args, '--dispatch', ...flags], f.dir,
    env(f.dir, { WORK_FARM: f.stub, WORK_NO_SCOPE: '1', ...extra }))
}

async function expectSpentNothing(f: { dir: string; args: string; marker: string }, before: string) {
  expect(readFileSync(f.args, 'utf8')).toBe(before)
  expect(existsSync(join(f.dir, 'result.json'))).toBe(true)
  expect(existsSync(join(f.dir, 'result-round1.json'))).toBe(false)
  await Bun.sleep(1000)
  expect(existsSync(f.marker)).toBe(false)
}

describe('work-redispatch.sh, no --provider: lensProvider constrains the review row every round', () => {
  test('lensProvider codex: kindModels.review gpt-6.1-sol, decisions.review the constrained output', async () => {
    const f = redispatchFixture({ lensProvider: 'codex' })
    const r = await redispatch(f)
    expect({ code: r.code, stderr: r.code === 0 ? '' : r.stderr }).toEqual({ code: 0, stderr: '' })
    const review = expectRoundCalls(calls(f.log), 'codex')
    const routing = readJson(f.args).routing
    expect(routing.kindModels).toEqual({
      judgement: 'claude-opus-5-5', script: 'claude-sonnet-5-5', review: 'gpt-6.1-sol',
    })
    expectConstrained(routing.decisions.review, LENS.codex)
    expect(routing.decisions.review).toEqual(JSON.parse(review.stdout))
    expect('model' in readJson(f.args).lens).toBe(false)
  })

  test('lensProvider gemini: kindModels.review gemini-3.8-flash-high', async () => {
    const f = redispatchFixture({ lensProvider: 'gemini' })
    const r = await redispatch(f)
    expect(r.code).toBe(0)
    expectRoundCalls(calls(f.log), 'gemini')
    const routing = readJson(f.args).routing
    expect(routing.kindModels.review).toBe('gemini-3.8-flash-high')
    expectConstrained(routing.decisions.review, LENS.gemini)
    expect('model' in readJson(f.args).lens).toBe(false)
  })
})

describe('work-redispatch.sh with --provider', () => {
  test('and lensProvider: exactly one route.ts call, the review row; routing.lens verbatim; lens.model set, no lensModel', async () => {
    const f = redispatchFixture({ lensProvider: 'gemini' })
    const r = await redispatch(f, ['--provider', 'codex'])
    expect({ code: r.code, stderr: r.code === 0 ? '' : r.stderr }).toEqual({ code: 0, stderr: '' })
    const log = calls(f.log)
    expect(log).toHaveLength(1)
    expect(log[0].row).toMatchObject({ kind: 'review', provider: 'gemini' })
    expect(log[0].row.model).toBeUndefined()
    const decision = JSON.parse(log[0].stdout)
    expectConstrained(decision, LENS.gemini)
    const a = readJson(f.args)
    expect(a.routing).toEqual({ source: 'flag', provider: 'codex', lens: decision })
    expect(a.lens).toEqual({ ...PLAN_LENS, model: decision.model })
    expect(a.lens.model).toBe('gemini-3.8-flash-high')
    expect('lensModel' in a).toBe(false)
  })

  test('and no lensProvider: zero route.ts calls, routing is the bare flag', async () => {
    const f = redispatchFixture()
    const r = await redispatch(f, ['--provider', 'gemini'])
    expect(r.code).toBe(0)
    expect(calls(f.log)).toEqual([])
    const a = readJson(f.args)
    expect(a.routing).toEqual({ source: 'flag', provider: 'gemini' })
    expect('lensModel' in a).toBe(false)
    expect(a.lens).toEqual(PLAN_LENS)
    expect('model' in a.lens).toBe(false)
  })
})

describe('work-redispatch.sh refuses a bad lensProvider and spends nothing', () => {
  const BAD: [string, object, string[]][] = [
    ['an invalid lensProvider', { lensProvider: 'openai' }, []],
    ['lensProvider with lens.model', {
      lensProvider: 'gemini',
      lens: { agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong', model: 'claude-opus-5-5' },
    }, []],
    ['lensProvider with lensModel, under --provider', { lensProvider: 'gemini', lensModel: 'claude-opus-5-5' }, ['--provider', 'claude']],
  ]
  for (const [name, over, flags] of BAD) {
    test(`${name}: non-zero, stderr names lensProvider, args.json unchanged, nothing launched`, async () => {
      const f = redispatchFixture(over)
      const before = readFileSync(f.args, 'utf8')
      const r = await redispatch(f, flags)
      expect(r.code).not.toBe(0)
      expect(r.stderr).toMatch(/lensProvider/)
      await expectSpentNothing(f, before)
    })
  }

  test('a route.ts refusal for the review row: non-zero, stderr names lensProvider, nothing spent', async () => {
    const f = redispatchFixture({ lensProvider: 'codex' })
    const before = readFileSync(f.args, 'utf8')
    const r = await redispatch(f, [], { ROUTING_TABLE: codexRefuses() })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/lensProvider/)
    expect(r.stderr).toMatch(/review/)
    await expectSpentNothing(f, before)
  })
})
