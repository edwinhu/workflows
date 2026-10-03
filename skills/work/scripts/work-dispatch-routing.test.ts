// <!-- wc-probe: ignore-refs -->
// Fixtures below are executed, not declared: the task rows and lenses are INPUT to the dispatcher.
/**
 * work-dispatch.sh and work-redispatch.sh resolve a per-kind model map through route.ts.
 *
 * Without `--provider`, each dispatch (and each redispatched round) asks
 * `bun <plugin-root>/scripts/lib/route.ts --row '{"kind":"<k>","label":"work:<runId>:<k>"}'` for
 * judgement, script and review, and records the answers as `args.routing`. With `--provider X` the
 * legacy whole-run override stands, route.ts is not consulted, and args.routing says so. A refusal
 * from route.ts for any kind stops the dispatch before anything is written or launched.
 *
 * Hermetic: ROUTING_TABLE is the fixture table, the Decisions API is the dead port, FARM_OUTCOMES
 * is a temp file, and work-dispatch.sh runs under WORK_DISPATCH_DRYRUN=1. work-redispatch.sh's dry
 * run writes nothing, so its cases dispatch for real against a farm.sh stub (WORK_FARM) with
 * WORK_NO_SCOPE=1, the idiom work-redispatch.test.ts uses for the same reason.
 *
 * Run: bun test skills/work/scripts/work-dispatch-routing.test.ts
 */
import { describe, expect, test, afterAll, setDefaultTimeout } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HERMETIC_ENV } from '../../../tests/helpers/hermetic-env'

// Each case spawns bash plus up to three route.ts processes; see work-dispatch.test.ts for why 60s.
setDefaultTimeout(60_000)

const DISPATCH = `${import.meta.dir}/work-dispatch.sh`
const REDISPATCH = `${import.meta.dir}/work-redispatch.sh`
const FIXTURE_TABLE = join(import.meta.dir, '../../../tests/fixtures/routing/table.json')
const DEAD = 'http://127.0.0.1:1/'
const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

function tmp(prefix: string) {
  const d = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(d)
  return d
}

/** An edited copy of the fixture table. */
function tableCopy(edit: (t: any) => void): string {
  const t = JSON.parse(readFileSync(FIXTURE_TABLE, 'utf8'))
  edit(t)
  const p = join(tmp('routing-table-'), 'table.json')
  writeFileSync(p, JSON.stringify(t, null, 2))
  return p
}

/** judgement alone refuses: its chain is one unavailable candidate. script and review still route. */
const judgementRefuses = () => tableCopy(t => {
  t.candidates.luna.available = false
  t.kinds.judgement = { pick: 'luna', fallbacks: [] }
})

/** The env every spawn gets: no ambient session, no real table, no network, no real outcomes file. */
function env(dir: string, extra: Record<string, string> = {}): Record<string, string> {
  const { WORK_HOLD_DECISIONS_MODEL: _m, ROUTING_TABLE: _t, FARM_OUTCOMES: _o, ...base } = HERMETIC_ENV
  return {
    ...base,
    TMPDIR: dir,
    ROUTING_TABLE: FIXTURE_TABLE,
    WORK_HOLD_DECISIONS_URL: DEAD,
    WORK_HOLD_JUDGE_TOKEN: 'test-token',
    FARM_OUTCOMES: join(dir, 'farm-outcomes.jsonl'),
    // Backstop: a regression past the dry-run exit must hit a farm that does nothing.
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

/** Lint-clean dispatch args with one red-gated task, so the only refusal is the one a case asks for. */
function cleanArgs(dir: string) {
  return {
    projectDir: dir,
    goal: 'make the thing correct',
    tasks: [{
      id: 'T1', name: 'one', work: 'do the thing', writablePaths: ['src/'], refs: [],
      redCommand: 'bash scripts/check.sh', acceptance: '`bash scripts/check.sh` exits 0',
    }],
    mechanicalChecks: [{ name: 'tests', cmd: 'bun test' }],
    lens: { agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' },
  }
}

function planFile(dir: string, runId: string, args: object) {
  const plan = join(dir, 'plan.md')
  writeFileSync(plan, '# Plan\n\n## Run sizing\n\nnothing parked\n\n' +
    `<!-- work:dispatch\n${JSON.stringify({ runId, args }, null, 2)}\n-->\n`)
  return plan
}

// ------------------------------------------------------------------------- work-dispatch.sh

function dispatchFixture() {
  const dir = tmp('work-dispatch-routing-')
  mkdirSync(join(dir, 'src'), { recursive: true })
  redScript(dir)
  const plan = planFile(dir, 'route-run', cleanArgs(dir))
  return { dir, plan, argsPath: join(dir, '.work', 'route-run', 'args.json') }
}

function dispatch(f: { dir: string; plan: string }, flags: string[] = [], extra: Record<string, string> = {}) {
  return spawn(['bash', DISPATCH, ...flags, f.plan], f.dir, env(f.dir, { WORK_DISPATCH_DRYRUN: '1', ...extra }))
}

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'))

/** The decision route.ts gives each kind under the fixture table. */
const FIXTURE_DECISIONS = {
  judgement: { kind: 'judgement', provider: 'claude', model: 'claude-opus-5-5', candidate: 'opus', source: 'table' },
  script: { kind: 'script', provider: 'claude', model: 'claude-sonnet-5-5', candidate: 'sonnet', source: 'table' },
  review: { kind: 'review', provider: 'claude', model: 'claude-sonnet-5-5', candidate: 'sonnet', source: 'table' },
}

describe('work-dispatch.sh without --provider resolves a kind map through route.ts', () => {
  test('args.routing carries kindModels, source and one decision per kind', async () => {
    const f = dispatchFixture()
    const r = await dispatch(f)
    expect(r.code).toBe(0)
    const routing = readJson(f.argsPath).routing
    expect(routing).toBeDefined()
    expect(routing.kindModels).toEqual({
      judgement: 'claude-opus-5-5', script: 'claude-sonnet-5-5', review: 'claude-sonnet-5-5',
    })
    expect(routing.source).toBe('table')
    expect(Object.keys(routing.decisions).sort()).toEqual(['judgement', 'review', 'script'])
    for (const k of ['judgement', 'script', 'review'] as const)
      expect(routing.decisions[k]).toMatchObject(FIXTURE_DECISIONS[k])
  })

  test('each decision is route.ts output verbatim, with no retired shadow block', async () => {
    const f = dispatchFixture()
    const r = await dispatch(f)
    expect(r.code).toBe(0)
    const decisions = readJson(f.argsPath).routing?.decisions
    expect(decisions).toBeDefined()
    for (const k of ['judgement', 'script', 'review'] as const)
      expect(decisions[k]).toEqual(FIXTURE_DECISIONS[k])
  })

  test('ROUTING_TABLE is honoured: an edited table changes the map', async () => {
    const f = dispatchFixture()
    const table = tableCopy(t => { t.kinds.script = { pick: 'flash', fallbacks: ['sonnet'] } })
    const r = await dispatch(f, [], { ROUTING_TABLE: table })
    expect(r.code).toBe(0)
    const routing = readJson(f.argsPath).routing
    expect(routing?.kindModels?.script).toBe('gemini-3.7-flash-high')
    expect(routing?.decisions?.script).toMatchObject({ provider: 'gemini', candidate: 'flash', kind: 'script' })
    expect(routing?.kindModels?.judgement).toBe('claude-opus-5-5')
  })

  test('a route.ts refusal for one kind fails the dispatch before args.json, and stderr names the kind', async () => {
    const f = dispatchFixture()
    const r = await dispatch(f, [], { ROUTING_TABLE: judgementRefuses() })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/judgement/)
    expect(existsSync(f.argsPath)).toBe(false)
  })
})

describe('work-dispatch.sh with --provider keeps the legacy override', () => {
  test('args.routing is {source: flag, provider} with no kindModels', async () => {
    const f = dispatchFixture()
    const r = await dispatch(f, ['--provider', 'codex'])
    expect(r.code).toBe(0)
    const routing = readJson(f.argsPath).routing
    expect(routing).toEqual({ source: 'flag', provider: 'codex' })
  })

  test('route.ts is not consulted: a table that would refuse every kind does not stop a flag dispatch', async () => {
    const f = dispatchFixture()
    const missing = join(tmp('no-table-'), 'absent.json')
    const r = await dispatch(f, ['--provider', 'claude'], { ROUTING_TABLE: missing })
    expect(r.code).toBe(0)
    expect(readJson(f.argsPath).routing).toEqual({ source: 'flag', provider: 'claude' })
  })
})

// ---------------------------------------------------------------------- work-redispatch.sh

/** A farm.sh that records it ran, so a case can say nothing was launched. */
function farmStub(dir: string) {
  const marker = join(dir, 'farm-ran')
  const p = join(dir, 'farm-stub.sh')
  writeFileSync(p, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > '${marker}'\nexit 0\n`)
  chmodSync(p, 0o755)
  return { stub: p, marker }
}

/** An args.json from a finished round 1 (optionally carrying its routing) beside its plan. */
function redispatchFixture(priorRouting?: object) {
  const dir = tmp('work-redispatch-routing-')
  redScript(dir)
  const clean = cleanArgs(dir)
  const plan = planFile(dir, 'gate-run', clean)
  const args = join(dir, 'args.json')
  writeFileSync(args, JSON.stringify({
    ...clean, planPath: plan, specHash: '0'.repeat(64), rounds: 1,
    ...(priorRouting ? { routing: priorRouting } : {}),
  }, null, 2) + '\n')
  writeFileSync(join(dir, 'result.json'), JSON.stringify({
    overallPass: false, verdict: 'FAIL', tasksThatFlagged: ['T1'], mechanicalThatFailed: [],
    lensesThatFlagged: [], findings: [],
  }, null, 2) + '\n')
  return { dir, plan, args, ...farmStub(dir) }
}

function redispatch(f: { dir: string; plan: string; args: string; stub: string }, flags: string[] = [], extra: Record<string, string> = {}) {
  return spawn(['bash', REDISPATCH, f.plan, f.args, '--dispatch', ...flags], f.dir,
    env(f.dir, { WORK_FARM: f.stub, WORK_NO_SCOPE: '1', ...extra }))
}

const STALE = {
  kindModels: { judgement: 'stale-j', script: 'stale-s', review: 'stale-r' },
  source: 'table',
  decisions: {},
}

describe('work-redispatch.sh re-resolves the kind map on every round', () => {
  test('without --provider a round writes a fresh map, replacing the previous round\'s', async () => {
    const f = redispatchFixture(STALE)
    const r = await redispatch(f)
    expect(r.code).toBe(0)
    const routing = readJson(f.args).routing
    expect(routing?.kindModels).toEqual({
      judgement: 'claude-opus-5-5', script: 'claude-sonnet-5-5', review: 'claude-sonnet-5-5',
    })
    expect(routing?.source).toBe('table')
    for (const k of ['judgement', 'script', 'review'] as const)
      expect(routing?.decisions?.[k]).toMatchObject(FIXTURE_DECISIONS[k])
  })

  test('with --provider a round writes {source: flag, provider} and drops the previous kindModels', async () => {
    const f = redispatchFixture(STALE)
    const r = await redispatch(f, ['--provider', 'gemini'])
    expect(r.code).toBe(0)
    expect(readJson(f.args).routing).toEqual({ source: 'flag', provider: 'gemini' })
  })

  test('a route.ts refusal fails the round non-zero, names the kind, and spends nothing', async () => {
    const f = redispatchFixture(STALE)
    const before = readFileSync(f.args, 'utf8')
    const r = await redispatch(f, [], { ROUTING_TABLE: judgementRefuses() })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/judgement/)
    expect(readFileSync(f.args, 'utf8')).toBe(before)
    expect(existsSync(join(f.dir, 'result.json'))).toBe(true)
    expect(existsSync(join(f.dir, 'result-round1.json'))).toBe(false)
    // The stub is launched detached; give it the time a launch would have taken to show.
    await Bun.sleep(1000)
    expect(existsSync(f.marker)).toBe(false)
  })
})
