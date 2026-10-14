// <!-- wc-probe: ignore-refs -->
// Fixtures below are executed, not declared: the plan blocks are INPUTS to work-dispatch.sh.
/**
 * The release canary's five assertions (scripts/canary.sh --assert), on every suite run, over the REAL
 * dispatch path: work-dispatch.sh -> work-loop.sh -> work-round.sh -> farm.sh rows -> work-checks.sh ->
 * lens row -> work-stage.mjs assemble -> work-result.sh, on throwaway fixtures shaped like the canary's
 * two runs. Only the model is a stub: tests/helpers/stub-model-cli.mjs on PATH as claude-code,
 * codex-code and gemini-code (stream-json, usage, tool calls; the implementer's edit made
 * deterministically), and the Jev judge is a local server (WORK_HOLD_DECISIONS_URL). No network.
 *
 *   dev   a red bun test and one task to green it (the canary's dev round)        -> every assertion holds
 *   diag  readOnly, no tasks, one mechanical leg, a rule leg and a lens            -> every assertion holds
 *   slow-start  dev, with the round runner delayed 8 s: the loop waits for it, never reports it dead
 *   and one run per failure class, each built so exactly that assertion must fail:
 *     no-edit     the implementer changes nothing: no verdict of 0              (1. verdict reached)
 *     tool-error  a hook error line in a row's reply                            (2. no tool error line)
 *     vacuous     the mechanical leg examines an empty file                     (3. every leg examined > 0)
 *     judge-down  the judge answers 500, so the rule leg is unavailable         (3. rule leg judged)
 *     zero-usage  rows make tool calls at 0 tokens                              (4. tokens recorded)
 *     kill-farm   the lens row's farm.sh is SIGKILLed: START with no DONE       (5. watcher START/DONE)
 *
 * Every run starts in beforeAll, concurrently; each test asserts over its own run dir.
 * Run: bun test tests/e2e-work-path.test.ts
 */
import { afterAll, beforeAll, describe, expect, test, setDefaultTimeout } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { useTmp } from './helpers/tmp.ts'
import { hermeticEnv } from './helpers/hermetic-env.ts'

// A run is ~5-10 s on the stub; the cap is for a loaded machine. Literal, so the timeout guards can read it.
const RUN_TIMEOUT = 120_000
setDefaultTimeout(150_000)

const ROOT = join(import.meta.dir, '..')
const WORK = join(ROOT, 'skills', 'work', 'scripts')
const CANARY = join(ROOT, 'scripts', 'canary.sh')
const STUB = join(import.meta.dir, 'helpers', 'stub-model-cli.mjs')
const mkTmp = useTmp()

// The Jev judge: every question answered MET (VIOLATED 0.05); /down answers 500 like an outage.
let judge: ReturnType<typeof Bun.serve>
const startJudge = () => Bun.serve({
  port: 0,
  async fetch(req) {
    const body = await req.json() as { questions?: Record<string, unknown> }
    if (new URL(req.url).pathname === '/down') return new Response('upstream error', { status: 500 })
    const answers = Object.fromEntries(Object.keys(body.questions ?? {}).map(q => [q, { probabilities: { VIOLATED: 0.05 } }]))
    return Response.json({ answers, usage: { input_tokens: 10, output_tokens: 1 } })
  },
})

const sh = async (cmd: string[], opts: { cwd?: string; env?: Record<string, string | undefined> } = {}) => {
  const p = Bun.spawn(cmd, { cwd: opts.cwd, env: opts.env as Record<string, string>, stdout: 'pipe', stderr: 'pipe', timeout: RUN_TIMEOUT })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { code, out: out + err }
}

const git = (dir: string) => sh(['bash', '-c', 'git init -q && git add -A && git -c user.name=e2e -c user.email=e2e@localhost commit -qm fixture'], { cwd: dir })

const plan = (path: string, workflow: string, runId: string, args: object, goalTurns: number) => writeFileSync(path,
  `---\nworkflow: ${workflow}\n---\n\n# e2e ${runId}\n\n<!-- work:dispatch\n${JSON.stringify({ runId, goalTurns, args }, null, 1)}\n-->\n`)

/** The canary's dev fixture: src/clamp.js returns x unchanged, src/clamp.test.js is red. */
async function devFixture(dir: string, runId: string, filesRule = false) {
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/clamp.js'), '// clamp(x, lo, hi): x limited to the closed range [lo, hi].\nexport function clamp(x, lo, hi) {\n  return x\n}\n')
  writeFileSync(join(dir, 'src/clamp.test.js'), `import { expect, test } from 'bun:test'
import { clamp } from './clamp.js'

test('clamp limits a value to [lo, hi]', () => {
  expect(clamp(5, 0, 10)).toBe(5)
  expect(clamp(-3, 0, 10)).toBe(0)
  expect(clamp(42, 0, 10)).toBe(10)
})
`)
  writeFileSync(join(dir, 'package.json'), '{ "name": "e2e-fixture", "type": "module", "private": true }\n')
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.work/\n.claude/\n.planning/\n')
  const g = await git(dir)
  if (g.code !== 0) throw new Error(g.out)
  const dev = join(ROOT, 'skills', 'dev')
  const p = join(dir, 'plan.md')
  plan(p, 'dev', runId, {
    projectDir: dir,
    goal: 'clamp(x, lo, hi) in src/clamp.js returns x limited to [lo, hi], and `bun test` passes.',
    maxRounds: 2,
    tasks: [{
      id: 'T1', name: 'implement clamp',
      work: 'src/clamp.js returns x unchanged. Make clamp return lo when x < lo and hi when x > hi. The test in src/clamp.test.js already exists and is red; do not change it.',
      writablePaths: ['src/clamp.js'],
      acceptance: 'clamp(-3, 0, 10) is 0 and clamp(42, 0, 10) is 10, as src/clamp.test.js asserts.',
      redCommand: 'bun test src/clamp.test.js',
      refs: [join(dev, 'references', 'tdd.md')],
    }],
    mechanicalChecks: [{ name: 'dev', cmd: `bash ${dev}/scripts/check.sh --project-dir ${dir} --no-plan --test-cmd "bun test"` }],
    ruleChecks: { name: 'jev-dev-rules', cmd: filesRule
      ? `bun ${WORK}/rule-check.ts --workflow dev --files ${dir}/src/clamp.js --plan ${p}`
      : `bun ${WORK}/rule-check.ts --workflow dev --project-dir ${dir} --plan ${p}` },
    lens: { agentType: 'Explore', refs: [join(dev, 'references', 'lens-security.md')], prompt: 'Judge the change against the plan. Severity MAJOR at minimum.' },
    authorityExtra: 'e2e fixture: the red test already exists; the task is the implementation only.',
    verifierAgentType: 'Explore',
  }, 2)
  return p
}

/** A read-only diagnose in miniature: one notes file, a counting leg over it plus writing's domain gate
 *  (as a workflow's check.sh runs it), writing's Jev rules, and a lens. */
async function diagFixture(dir: string, runId: string, notes: string) {
  writeFileSync(join(dir, 'notes.md'), notes)
  writeFileSync(join(dir, 'check.sh'), `#!/usr/bin/env bash
# One leg in the canary's convention: \`lines: N line(s) examined\`, a bare zero is COULD-NOT-CHECK.
. ${join(WORK, 'leg-counts.sh')}
lines_leg() { count_line lines "$(line_total "$@")" "line(s)" "over $# file(s)"; }
echo "=== leg: lines"
legcount_run lines lines_leg "$@"
rc=$LEG_STATUS
echo "=== leg: writing-gate"
legcount_run writing-gate python3 ${join(ROOT, 'bin', 'workflow-check')} writing --constraints-only --project-dir "$(dirname "$1")"
[ "$LEG_STATUS" -le "$rc" ] || rc=$LEG_STATUS
exit "$rc"
`)
  const g = await git(dir)
  if (g.code !== 0) throw new Error(g.out)
  const p = join(dir, 'plan.md')
  plan(p, 'writing', runId, {
    projectDir: dir,
    goal: 'Reach a verdict on whether notes.md is complete against its own outline.',
    readOnly: true,
    maxRounds: 1,
    tasks: [],
    mechanicalChecks: [{ name: 'notes-mech', cmd: `bash ${dir}/check.sh ${dir}/notes.md` }],
    ruleChecks: { name: 'jev-writing-rules', cmd: `bun ${WORK}/rule-check.ts --workflow writing --files ${dir}/notes.md` },
    lens: { agentType: 'Explore', refs: [join(dir, 'notes.md')], prompt: 'Judge notes.md. Report each gap as MAJOR; every finding has ownerTask plan (the task table is empty). Change nothing.' },
    authorityExtra: 'IRON LAW — this run is READ-ONLY. Create, edit and overwrite no file.',
  }, 1)
  return p
}

const CLAMP = 'export function clamp(x, lo, hi) {\n  return Math.min(hi, Math.max(lo, x))\n}\n'
const NOTES = '# Notes\n\nThe firm discloses its risk factors in Item 1A.\nThe board reviews them annually.\n'

type Scenario = { kind: 'dev' | 'diag'; filesRule?: boolean; fault?: string; edits?: Record<string, string>; notes?: string; judgePath?: string; startDelay?: number }
const SCENARIOS: Record<string, Scenario> = {
  'dev': { kind: 'dev', edits: { 'src/clamp.js': CLAMP } },
  // a --files ruleChecks with no --project-dir (elide-case's shape) under the run baseline a non-readOnly dispatch records
  'files-rule': { kind: 'dev', filesRule: true, edits: { 'src/clamp.js': CLAMP } },
  'slow-start': { kind: 'dev', edits: { 'src/clamp.js': CLAMP }, startDelay: 8 },
  'diag': { kind: 'diag' },
  'no-edit': { kind: 'dev', edits: {} },
  'tool-error': { kind: 'dev', edits: { 'src/clamp.js': CLAMP }, fault: 'tool-error' },
  'zero-usage': { kind: 'dev', edits: { 'src/clamp.js': CLAMP }, fault: 'zero-usage' },
  'vacuous': { kind: 'diag', notes: '' },
  'judge-down': { kind: 'diag', judgePath: '/down' },
  'kill-farm': { kind: 'diag', fault: 'kill-farm' },
}
type Run = { runDir: string; events: string; dispatch: { code: number | null; out: string }; ms: number }
const runs: Record<string, Run> = {}

// hermeticEnv drops the session and bridge ids; the caller's farm, grind, hold and judge settings
// must not reach the run either, so they go too unless the run pins its own.
const AMBIENT = /^(FARM_|GRIND_|WORK_|JEV_|HERDR_|STUB_|CANARY_)|^(OPENAI_API_KEY|OPENAI_DECISIONS_URL)$/
const isolated = (tmp: string, pinned: Record<string, string>) => Object.fromEntries(
  Object.entries(hermeticEnv(tmp, pinned)).filter(([k]) => k in pinned || !AMBIENT.test(k)))

/** work-round.sh behind a delay: a runner that is slow to register, as on a loaded machine. */
function slowRound(bin: string, seconds: number): string {
  const wrapper = join(bin, 'slow-round.sh')
  writeFileSync(wrapper, `#!/usr/bin/env bash\nsleep ${seconds}\nexec bash ${join(WORK, 'work-round.sh')} "$@"\n`, { mode: 0o755 })
  return wrapper
}

async function launch(name: string, s: Scenario): Promise<Run> {
  const t0 = Date.now()
  const root = mkTmp(`e2e-${name}-`)
  const dir = join(root, 'project'), state = join(root, 'state'), tmp = join(root, 'tmp'), bin = join(root, 'bin')
  for (const d of [dir, state, tmp, bin]) mkdirSync(d, { recursive: true })
  for (const w of ['claude-code', 'codex-code', 'gemini-code']) symlinkSync(STUB, join(bin, w))
  const runId = `e2e-${name}`
  const p = s.kind === 'dev' ? await devFixture(dir, runId, s.filesRule) : await diagFixture(dir, runId, s.notes ?? NOTES)
  const sid = `e2e-${name}-${process.pid}`
  const env = isolated(tmp, {
    PATH: `${bin}:${process.env.PATH}`,
    CLAUDE_CODE_SESSION_ID: sid, CLAUDE_PROJECT_DIR: dir, WORKFLOW_CHECKS_PATH: ROOT,
    XDG_STATE_HOME: join(root, 'xdg-state'), XDG_CACHE_HOME: join(root, 'xdg-cache'),
    WORK_NO_SCOPE: '1', WORK_LOOP_POLL: '1',
    ...(s.startDelay ? { WORK_ROUND: slowRound(bin, s.startDelay) } : {}),
    WORK_HOLD_DECISIONS_URL: `http://127.0.0.1:${judge.port}${s.judgePath ?? '/'}`, WORK_HOLD_JUDGE_TOKEN: 'stub',
    STUB_EDITS: JSON.stringify(s.edits ?? {}), STUB_FAULT: s.fault ?? '',
  })
  const dispatch = await sh(['bash', join(WORK, 'work-dispatch.sh'), '--run-dir', state, '--no-cron', '--loops', s.kind === 'dev' ? '2' : '1', p],
    { cwd: dir, env })
  const runDir = join(state, runId)
  const events = join(tmp, 'farm-events', sid)
  // The loop is detached: wait for its exit code, then for its DONE, so the sweep never races a writer.
  const loopDone = () => existsSync(events) && readdirSync(events)
    .some(f => readFileSync(join(events, f), 'utf8').includes('farm: DONE work-loop'))
  while (dispatch.code === 0 && Date.now() - t0 < RUN_TIMEOUT && !(existsSync(join(runDir, 'loop.exit')) && loopDone()))
    await Bun.sleep(250)
  return { runDir, events, dispatch, ms: Date.now() - t0 }
}

beforeAll(async () => {
  judge = startJudge()
  const done = await Promise.all(Object.entries(SCENARIOS).map(async ([n, s]) => [n, await launch(n, s)] as const))
  for (const [n, r] of done) runs[n] = r
}, 150_000)
afterAll(() => judge?.stop(true))

async function canaryAssert(name: string, expectExit: string, counts: string[]) {
  const r = runs[name]!
  expect({ dispatch: r.dispatch.code, out: r.dispatch.code === 0 ? '' : r.dispatch.out }).toEqual({ dispatch: 0, out: '' })
  const res = await sh(['bash', CANARY, '--assert', r.runDir, '--events', r.events, '--expect-exit', expectExit,
    ...counts.flatMap(c => ['--mech-count', c])])
  return res
}

const DEV_COUNT = '(\\d+) pass'
const DIAG_COUNT = 'lines: (\\d+) line\\(s\\) examined'

describe('the canary assertions hold over a stub-model run of the real path', () => {
  test('dev round: a red test made green — verdict 0, no tool error, legs counted, tokens, START/DONE', async () => {
    const r = await canaryAssert('dev', '0', [DEV_COUNT])
    expect(r.out).not.toContain('FAIL [')
    expect(r.out).toMatch(/canary: \[e2e-dev\] ok \(loop\.exit=0, verdict=PASS, W=[1-9]\d*/)
    expect(r.code).toBe(0)
    expect(readFileSync(join(runs.dev!.runDir, '..', '..', 'project', 'src', 'clamp.js'), 'utf8')).toBe(CLAMP)
  })

  test('dev round, ruleChecks by --files with no --project-dir under a runBaseline: the rule leg runs and the round passes', async () => {
    const args = JSON.parse(readFileSync(join(runs['files-rule']!.runDir, 'args.json'), 'utf8'))
    expect(args.runBaseline).toMatch(/^[0-9a-f]{40,64}$/)
    expect(args.ruleChecks.cmd).not.toContain('--project-dir')
    const r = await canaryAssert('files-rule', '0', [DEV_COUNT])
    expect(r.out).not.toContain('FAIL [')
    expect(r.code).toBe(0)
  })

  test('dev round, runner slow to register: the loop waits for the runner, not reports it dead', async () => {
    const r = await canaryAssert('slow-start', '0', [DEV_COUNT])
    expect(r.out).not.toContain('FAIL [')
    expect(r.code).toBe(0)
  })

  test('read-only diagnose: no tasks, a mechanical leg, a rule leg and a lens reach a verdict', async () => {
    const r = await canaryAssert('diag', '0,8', [DIAG_COUNT])
    expect(r.out).not.toContain('FAIL [')
    expect(r.out).toMatch(/canary: \[e2e-diag\] ok \(loop\.exit=[08], verdict=\w+, W=[1-9]\d*/)
    expect(r.code).toBe(0)
  })
})

describe('each assertion fails on the run built to break it', () => {
  test('1. verdict reached: an implementer that edits nothing never reaches loop.exit 0', async () => {
    const r = await canaryAssert('no-edit', '0', [DEV_COUNT])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/FAIL \[e2e-no-edit\] loop\.exit is [1-9]\d*, expected 0/)
  })

  test('2. no tool error line: a hook error in a row\'s reply reaches run.log and fails the run', async () => {
    const r = await canaryAssert('tool-error', '0', [DEV_COUNT])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/FAIL \[e2e-tool-error\] hook error in run\.log/)
    // and nothing else: the round itself passed, so the error line alone fails it
    expect(r.out.match(/FAIL \[/g)).toHaveLength(1)
    expect(r.out).toContain('loop.exit=0, verdict=PASS')
  })

  test('3. every leg examined > 0: a mechanical leg over an empty file is vacuous', async () => {
    const r = await canaryAssert('vacuous', '0,8', [DIAG_COUNT])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/FAIL \[e2e-vacuous\] mechanical notes-mech: leg lines examined 0 — vacuous/)
    // the leg_counts audit reports the one vacuous leg once; the --mech-count line is a separate assertion
    expect(r.out.split('\n').filter(l => /^FAIL \[e2e-vacuous\] mechanical notes-mech: leg /.test(l))).toHaveLength(1)
  })

  test('3. every rule leg judged: a judge outage leaves the rule leg unavailable', async () => {
    const r = await canaryAssert('judge-down', '0,8', [DIAG_COUNT])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/FAIL \[e2e-judge-down\] rule leg jev-writing-rules: (?:unavailable|0 verdicts)/)
  })

  test('4. tokens recorded: rows that call tools at zero usage fail on W=0', async () => {
    const r = await canaryAssert('zero-usage', '0', [DEV_COUNT])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/FAIL \[e2e-zero-usage\] row workflow made \d+ tool call\(s\) but recorded W=0/)
    expect(r.out).toContain('tokens recorded: 0 W across every farm row')
    expect(r.out).toContain('loop.exit=0, verdict=PASS')
  })

  test('5. watcher START/DONE: a lens row whose farm.sh dies leaves a START with no DONE', async () => {
    const r = await canaryAssert('kill-farm', '0,8', [DIAG_COUNT])
    expect(r.code).toBe(1)
    expect(r.out).toContain('FAIL [e2e-kill-farm] START lens has no DONE')
    expect(r.out).not.toContain('START workflow has no DONE')
  })
})
