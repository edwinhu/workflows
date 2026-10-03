// <!-- wc-probe: ignore-refs -->
// Fixtures below are executed, not declared: the task and lens literals are INPUTS to the scripts.
/**
 * The scripted half of a work round — every leg an exit code decides, and the ONE lens row.
 *
 *   work-checks.sh   an unrunnable command is exitCode -1, and so is a rule check with no JSON line;
 *                    output keeps the last 60 lines; a
 *                    red-suite file whose hash moved is a change owned by the covering task, else 'plan'
 *   work-stage.mjs   the digest maps owners and pre-flags out-of-scope paths; a suite change is a
 *                    CRITICAL in the gate
 *   work-round.sh    the lens is ONE farm.sh --tasks row of kind review, carrying lens.model and
 *                    lens.agentType, with `expect` on its JSON; route.ts is not re-asked
 *   work-result.sh   PASS/FAIL verdicts on an assembled result are the verdicts it always gave
 *   workflow.js      dispatches zero red/mechanical/rules/lens agents, and no verifier for an acceptanceCmd task
 *
 * No model and no network: farm.sh is a stub (WORK_FARM), FARM_OUTCOMES and TMPDIR are temp paths.
 *
 * Run: bun test ./skills/work/scripts/work-round.test.ts
 */
import { test, expect, describe, setDefaultTimeout, afterAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDigest, ownerOfPath, runStage } from './work-stage.mjs'
import { run, baseArgs, task, replies } from './workflow-harness.mjs'

setDefaultTimeout(120_000)

const HERE = import.meta.dir
const CHECKS = join(HERE, 'work-checks.sh')
const ROUND = join(HERE, 'work-round.sh')
const RESULT_SH = join(HERE, 'work-result.sh')
const STAGE = join(HERE, 'work-stage.mjs')

const temps: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'work-round-')); temps.push(d); return d }
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }) })
const sh = (cmd: string, cwd: string) => spawnSync('bash', ['-c', cmd], { timeout: 120_000, cwd, encoding: 'utf8' })
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const sha = (p: string) => new Bun.CryptoHasher('sha256').update(readFileSync(p)).digest('hex')

/** A git repo with one committed file per path. */
function repo(files: Record<string, string>) {
  const dir = tmp()
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true })
    writeFileSync(join(dir, p), body)
  }
  const r = sh('git init -q && git -c user.email=t@t -c user.name=t add -A && git -c user.email=t@t -c user.name=t commit -qm init', dir)
  if (r.status !== 0) throw new Error(r.stderr)
  return dir
}

function checks(args: any, checkPlan: any) {
  const dir = tmp()
  const a = join(dir, 'args.json'), raw = join(dir, 'raw.json'), out = join(dir, 'checks.json')
  writeFileSync(a, JSON.stringify(args))
  writeFileSync(raw, JSON.stringify({ stage: 'agents', agents: {}, checkPlan: { red: [], acceptance: [], mechanical: [], ...checkPlan } }))
  const r = spawnSync('bash', [CHECKS, a, raw, out], { timeout: 120_000, encoding: 'utf8', env: { ...process.env, WORK_CHECK_TIMEOUT: '5' } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), checks: existsSync(out) ? json(out) : null }
}

describe('work-checks.sh fails closed and keeps the evidence', () => {
  test('a command that cannot run records exitCode -1, never a pass or an ordinary failure', () => {
    const dir = repo({ 'a.txt': 'a' })
    const r = checks({ projectDir: dir, tasks: [] }, {
      acceptance: [{ id: 'T1', command: 'definitely-not-a-command-xyz' }],
      mechanical: [{ name: 'noexec', cmd: './a.txt' }, { name: 'slow', cmd: 'sleep 30' }],
      red: [{ id: 'T2', command: 'bash scripts/absent.sh' }],
    })
    expect(r.code).toBe(0)
    expect(r.checks.acceptance[0].exitCode).toBe(-1)            // 127: not found
    expect(r.checks.mechanical.find((m: any) => m.name === 'noexec').exitCode).toBe(-1)   // 126
    expect(r.checks.mechanical.find((m: any) => m.name === 'slow').exitCode).toBe(-1)     // timeout
    expect(r.checks.mechanical.find((m: any) => m.name === 'slow').output).toMatch(/timed out/)
    expect(r.checks.red[0].exitCode).toBe(-1)                   // bash: No such file -> 127
  })

  test('output keeps the LAST 60 lines, untruncated', () => {
    const dir = repo({ 'a.txt': 'a' })
    const r = checks({ projectDir: dir, tasks: [] }, { mechanical: [{ name: 'long', cmd: `seq 1 100; echo ${'x'.repeat(3000)}; exit 1` }] })
    const lines = r.checks.mechanical[0].output.split('\n')
    expect(r.checks.mechanical[0].exitCode).toBe(1)
    expect(lines.length).toBe(60)
    expect(lines[0]).toBe('42')
    expect(lines[59]).toBe('x'.repeat(3000))
  })

  test('a moved red-suite hash is a change owned by the task whose writablePaths cover it, else plan', () => {
    const dir = repo({ 'tests/t1.test.ts': 'one', 'tests/other.sh': 'two', 'src/keep.ts': 'k' })
    const hashes = {
      'tests/t1.test.ts': sha(join(dir, 'tests/t1.test.ts')),
      'tests/other.sh': sha(join(dir, 'tests/other.sh')),
      'src/keep.ts': sha(join(dir, 'src/keep.ts')),
    }
    writeFileSync(join(dir, 'tests/t1.test.ts'), 'weakened')
    writeFileSync(join(dir, 'tests/other.sh'), 'weakened')
    const tasks = [{ id: 'T1', writablePaths: ['tests/*.test.ts', 'src/'] }, { id: 'T2', writablePaths: ['lib/'] }]
    const r = checks({ projectDir: dir, tasks, redSuiteHashes: hashes }, {})
    expect(r.checks.suite.checked).toBe(3)
    expect(r.checks.suite.changed.map((c: any) => [c.path, c.owner])).toEqual([
      ['tests/other.sh', 'plan'],
      ['tests/t1.test.ts', 'T1'],
    ])
  })
})

describe('the suite change reaches the gate as a CRITICAL with its owner', () => {
  test('an otherwise green round FAILs on a changed red-suite file, owned by T1', async () => {
    const args = { ...baseArgs, tasks: [task({ writablePaths: ['tests/'], acceptanceCmd: 'true' })], lens: { prompt: 'p', refs: [] } }
    const { result } = await run(args, replies(), undefined, {
      checks: { suite: { checked: 1, changed: [{ path: 'tests/t1.test.ts', before: 'a', after: 'b', owner: 'T1' }] } },
    })
    expect(result.overallPass).toBe(false)
    const f = result.findings.find((x: any) => /tests\/t1\.test\.ts/.test(`${x.title} ${x.detail}`))
    expect(f).toBeDefined()
    expect(f.severity).toBe('critical')
    expect(f.ownerTask).toBe('T1')
    expect(result.tasksThatFlagged).toContain('T1')
  })
})

describe('the digest maps owners and pre-flags out-of-scope paths', () => {
  test('ownerOfPath: the covering task, else plan', () => {
    const tasks = [{ id: 'T1', writablePaths: ['src/a/'] }, { id: 'T2', writablePaths: ['src/**/*.py'] }]
    expect(ownerOfPath(tasks, 'src/a/x.ts')).toBe('T1')
    expect(ownerOfPath(tasks, './src/b/c/y.py')).toBe('T2')
    expect(ownerOfPath(tasks, 'README.md')).toBe('plan')
  })

  test('failures first with command, exit, tail and owner; greens settled; out-of-scope changes pre-flagged', () => {
    const dir = repo({ 'src/a.ts': 'a', 'lib/b.ts': 'b', 'README.md': 'r' })
    writeFileSync(join(dir, 'src/a.ts'), 'a2')
    writeFileSync(join(dir, 'README.md'), 'r2')
    writeFileSync(join(dir, 'stray.txt'), 'new')
    const args = {
      tasks: [
        { id: 'T1', writablePaths: ['src/'], acceptance: 'a works', acceptanceCmd: 'bun test a' },
        { id: 'T2', writablePaths: ['lib/'], acceptance: 'b reads well' },
      ],
      redBefore: { T1: { exitCode: 1, output: 'fail' } },
      criteria: ['no regressions'],
    }
    const c = {
      red: [{ id: 'T1', command: 'bun test a', exitCode: 0, output: 'pass' }],
      acceptance: [{ id: 'T1', command: 'bun test a', exitCode: 0, output: 'pass' }],
      mechanical: [{ name: 'lint', cmd: 'eslint', exitCode: 1, output: 'lib/b.ts:1 bad' }],
      suite: { checked: 1, changed: [{ path: 'tests/x', before: 'a', after: 'b', owner: 'plan' }] },
    }
    const d = buildDigest(args, c, { mode: 'RED', digest: {}, agents: { implemented: [], verified: [] } }, dir)
    expect(d.failures.map((f: any) => [f.check, f.owner, f.exitCode])).toEqual([
      ['mechanical:lint', 'T2', 1],          // the output names a file only T2 can reach
      ['suite:tests/x', 'plan', 1],
    ])
    expect(d.failures[0].command).toBe('eslint')
    expect(d.failures[0].output).toBe('lib/b.ts:1 bad')
    expect(d.failures[1].severity).toBe('critical')
    expect(d.settled.map((s: any) => s.check)).toEqual(['red:T1', 'acceptance:T1'])
    expect(d.scope.find((s: any) => s.id === 'T1').diffStat).toMatch(/src\/a\.ts/)
    expect(d.scope.find((s: any) => s.id === 'T1').diffStat).not.toMatch(/README/)
    expect(d.outOfScope.sort()).toEqual(['README.md', 'stray.txt'])
    expect(d.uncommanded).toEqual(['T2: b reads well'])
    expect(d.criteria).toEqual(['no regressions'])
  })
})

/**
 * work-round.sh end to end under a stub farm.sh. The stub's --workflow runs workflow.js's real
 * AGENTS stage with canned agent replies; its --tasks records the rows file and writes a clean lens.
 */
function stubFarm(dir: string) {
  const agents = join(dir, 'agents.mjs')
  writeFileSync(agents, `
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { load } from ${JSON.stringify(STAGE)}
const [argsPath, out, log] = process.argv.slice(2)
const args = JSON.parse(readFileSync(argsPath, 'utf8'))
const agent = async (_p, o) => {
  appendFileSync(log, o.label + '\\n')
  const id = o.label.split(':')[1]
  if (o.label.startsWith('implement:')) return { id, done: true, changedFiles: ['x'], evidence: 'e' }
  if (o.label.startsWith('verify:')) return { id, pass: true, evidence: 'e', failures: [] }
  return null
}
const parallel = ts => Promise.all(ts.map(async t => { try { return await t() } catch { return null } }))
const pipeline = async (items, ...st) => { const o = []; for (let i = 0; i < items.length; i++) { let v = items[i]; try { for (const s of st) v = await s(v, items[i], i); o.push(v) } catch { o.push(null) } } return o }
const r = await load()(args, agent, () => {}, parallel, pipeline, () => {})
writeFileSync(out, JSON.stringify(r))
`)
  const farm = join(dir, 'farm.sh')
  writeFileSync(farm, `#!/usr/bin/env bash
set -eu
while [ $# -gt 0 ]; do case $1 in
  --provider) prov=$2; shift 2;; --args) a=$2; shift 2;; --out) out=$2; shift 2;;
  --tasks) rows=$2; shift 2;; --workflow) shift 2;; *) shift;; esac; done
echo "$([ -n "\${rows:-}" ] && echo tasks || echo workflow) --provider $prov" >> "$CAPTURE/calls"
echo "\${JEV_EDIT_MOD-unset}" >> "$CAPTURE/jev"
if [ -n "\${rows:-}" ]; then
  cp "$rows" "$CAPTURE/rows.json"
  printf '%s' "$LENS_REPLY" > "$(jq -r '.[0].expect[0]' "$rows")"
  exit 0
fi
bun "$CAPTURE/agents.mjs" "$a" "$out" "$CAPTURE/agents.log"
`)
  chmodSync(farm, 0o755)
  return farm
}

function round(args: any, lensReply: any = { routes: [], findings: [], carried: [], dispositions: [] }) {
  const cap = tmp()
  const farm = stubFarm(cap)
  const runDir = join(cap, 'run')
  mkdirSync(runDir)
  const argsPath = join(runDir, 'args.json')
  writeFileSync(argsPath, JSON.stringify(args))
  const result = join(runDir, 'result.json')
  const { JEV_EDIT_MOD: _, ...inherited } = process.env
  const env = { ...inherited, WORK_FARM: farm, CAPTURE: cap, LENS_REPLY: JSON.stringify(lensReply),
    TMPDIR: cap, FARM_OUTCOMES: join(cap, 'farm-outcomes.jsonl') }
  const r = spawnSync('bash', [ROUND, argsPath, result, args.projectDir, 'claude'], { timeout: 120_000, encoding: 'utf8', env })
  const verdict = existsSync(result) ? spawnSync(RESULT_SH, [result], { timeout: 120_000, encoding: 'utf8' }) : null
  return {
    code: r.status, out: (r.stdout || '') + (r.stderr || ''), cap, runDir,
    result: existsSync(result) ? json(result) : null,
    rows: existsSync(join(cap, 'rows.json')) ? json(join(cap, 'rows.json')) : null,
    calls: existsSync(join(cap, 'calls')) ? readFileSync(join(cap, 'calls'), 'utf8').trim().split('\n') : [],
    jev: existsSync(join(cap, 'jev')) ? readFileSync(join(cap, 'jev'), 'utf8').trim().split('\n') : [],
    agents: existsSync(join(cap, 'agents.log')) ? readFileSync(join(cap, 'agents.log'), 'utf8').trim().split('\n') : [],
    verdict,
  }
}

const roundArgs = (dir: string, over: any = {}) => ({
  ...baseArgs, projectDir: dir,
  tasks: [task({ writablePaths: ['src/'], redCommand: 'bash scripts/red.sh', acceptanceCmd: 'true' })],
  redBefore: { T1: { exitCode: 1, output: '1 failed' } },
  mechanicalChecks: [{ name: 'tests', cmd: 'true' }],
  lens: { prompt: 'raise MAJOR when the work is wrong', refs: ['docs/x.md'], model: 'gpt-6.1-sol', agentType: 'code-reviewer' },
  routing: { source: 'flag', provider: 'claude', lens: { provider: 'codex', model: 'gpt-6.1-sol', kind: 'review' } },
  ...over,
})

describe('work-round.sh: the lens is ONE farm row of kind review', () => {
  test('one row, kind review, model = lens.model, agent = lens.agentType, expect = RUN/lens.json, provider from routing', () => {
    const dir = repo({ 'scripts/red.sh': 'echo "1 passed"; exit 0', 'src/a.ts': 'a' })
    const r = round(roundArgs(dir))
    expect({ code: r.code, out: r.code === 0 ? '' : r.out }).toEqual({ code: 0, out: '' })
    expect(r.rows).toHaveLength(1)
    const row = r.rows[0]
    expect(row.kind).toBe('review')
    expect(row.model).toBe('gpt-6.1-sol')
    expect(row.agent).toBe('code-reviewer')
    expect(row.expect).toEqual([join(r.runDir, 'lens.json')])
    expect(row.provider).toBe('codex')
    // the digest is at the top, then the settled rule, then the lens prompt
    expect(row.prompt.startsWith('# Round digest — MODE GREEN')).toBe(true)
    const iSettled = row.prompt.indexOf('NEVER re-run a settled check')
    expect(iSettled).toBeGreaterThan(0)
    expect(row.prompt.indexOf('raise MAJOR when the work is wrong')).toBeGreaterThan(iSettled)
    // farm.sh is called exactly twice: the AGENTS workflow on the host, the lens row on its own provider
    expect(r.calls).toEqual(['workflow --provider claude', 'tasks --provider codex'])
  })

  test('the AGENTS stage runs with JEV_EDIT_MOD=1 (implementers get the per-edit Jev mod); the lens row does not', () => {
    const dir = repo({ 'scripts/red.sh': 'echo "1 passed"; exit 0', 'src/a.ts': 'a' })
    const r = round(roundArgs(dir))
    expect(r.code).toBe(0)
    expect(r.jev).toEqual(['1', 'unset'])
  })

  test('MODE is RED when a check failed', () => {
    const dir = repo({ 'scripts/red.sh': 'echo "1 passed"; exit 0', 'src/a.ts': 'a' })
    const r = round(roundArgs(dir, { mechanicalChecks: [{ name: 'tests', cmd: 'echo "2 failed"; exit 1' }] }))
    expect(r.rows[0].prompt.startsWith('# Round digest — MODE RED')).toBe(true)
    expect(r.rows[0].prompt).toMatch(/mechanical:tests/)
  })

  test('the 1001-lens-provider shape: 4 acceptanceCmd tasks cost 4 implementers + 0 verifiers + 1 lens = 5 agents', () => {
    const dir = repo({ 'scripts/red.sh': 'echo "1 passed"; exit 0', 'src/a.ts': 'a' })
    const tasks = ['T1', 'T2', 'T3', 'T4'].map(id => task({ id, writablePaths: [`src/${id}/`], redCommand: 'bash scripts/red.sh', acceptanceCmd: 'true' }))
    const redBefore = Object.fromEntries(tasks.map(t => [t.id, { exitCode: 1, output: '1 failed' }]))
    const r = round(roundArgs(dir, { tasks, redBefore }))
    expect({ code: r.code, out: r.code === 0 ? '' : r.out }).toEqual({ code: 0, out: '' })
    expect(r.agents.sort()).toEqual(['implement:T1', 'implement:T2', 'implement:T3', 'implement:T4'])
    expect(r.rows).toHaveLength(1)
    expect(r.agents.length + r.rows.length).toBe(5)
  })
})

describe('work-result.sh verdicts on an assembled round are unchanged', () => {
  test('PASS: red-green, acceptance and mechanical green, clean lens -> exit 0, PASS', () => {
    const dir = repo({ 'scripts/red.sh': 'echo "1 passed"; exit 0', 'src/a.ts': 'a' })
    const r = round(roundArgs(dir))
    expect(r.result.overallPass).toBe(true)
    expect(r.result.verdict).toBe('PASS')
    expect(r.result.red.map((x: any) => x.verdict)).toEqual(['red-green'])
    expect(Object.keys(r.result.scoreTable)).not.toContain('thirdPartyAdvisoryFindings')
    expect(r.verdict!.status).toBe(0)
  })

  test('FAIL: a failing mechanical check -> exit 1, mechanicalThatFailed names it', () => {
    const dir = repo({ 'scripts/red.sh': 'echo "1 passed"; exit 0', 'src/a.ts': 'a' })
    const r = round(roundArgs(dir, { mechanicalChecks: [{ name: 'tests', cmd: 'echo "2 failed"; exit 1' }] }))
    expect(r.result.overallPass).toBe(false)
    expect(r.result.mechanicalThatFailed.map((m: any) => m.name)).toEqual(['tests'])
    expect(r.verdict!.status).toBe(1)
  })

  test('FAIL: red-not-red recorded at dispatch is scored by the gate', () => {
    const dir = repo({ 'scripts/red.sh': 'echo "1 passed"; exit 0', 'src/a.ts': 'a' })
    const r = round(roundArgs(dir, { redBefore: { T1: { exitCode: 0, output: '1 passed' } } }))
    expect(r.result.red.map((x: any) => x.verdict)).toEqual(['red-not-red'])
    expect(r.result.overallPass).toBe(false)
    expect(r.verdict!.status).toBe(1)
  })

  test('FAIL: a lens that never wrote lens.json is a CRITICAL, not a pass', () => {
    const dir = repo({ 'scripts/red.sh': 'echo "1 passed"; exit 0', 'src/a.ts': 'a' })
    const r = round(roundArgs(dir), null)
    expect(r.result.overallPass).toBe(false)
    expect(r.result.findings.some((f: any) => f.severity === 'critical')).toBe(true)
    expect(r.verdict!.status).toBe(1)
  })

  test('FAIL: a major lens finding blocks', () => {
    const dir = repo({ 'scripts/red.sh': 'echo "1 passed"; exit 0', 'src/a.ts': 'a' })
    const r = round(roundArgs(dir), { routes: [], carried: [], dispositions: [],
      findings: [{ title: 'wrong', severity: 'major', detail: 'd', ownerTask: 'T1' }] })
    expect(r.result.overallPass).toBe(false)
    expect(r.result.lensesThatFlagged.length).toBeGreaterThan(0)
    expect(r.verdict!.status).toBe(1)
  })
})

describe('workflow.js dispatches no agent for anything a command decides', () => {
  test('zero red, mechanical or lens agents; no verifier for an acceptanceCmd task', async () => {
    const args = {
      ...baseArgs,
      tasks: [task({ id: 'T1', redCommand: 'pytest a', acceptanceCmd: 'pytest a' }), task({ id: 'T2', acceptance: 'reads well' })],
      mechanicalChecks: [{ name: 'tests', cmd: 'bun test' }],
      lens: { prompt: 'p', refs: [] },
    }
    const { workflowDispatched, dispatched, scripted, fanOut } = await run(args, replies())
    expect(workflowDispatched.sort()).toEqual(['implement:T1', 'implement:T2', 'verify:T2'])
    expect(workflowDispatched.filter((l: string) => /^(red|mech|mechanical|lens|acceptance)\b/.test(l))).toEqual([])
    expect(dispatched.filter((l: string) => l === 'lens')).toHaveLength(1)   // the farmed row, not workflow.js
    expect(scripted.sort()).toEqual(['acceptance:T1', 'mechanical:tests', 'red:after:T1', 'red:before:T1'])
    expect(fanOut).toMatchObject({ implementers: 2, verifiers: 1, lens: 1 })
  })

  test('ruleChecks costs no agent: the round scripts rules:<name> and dispatches no rules: label', async () => {
    const args = { ...baseArgs, tasks: [task()], ruleChecks: { name: 'rules', cmd: 'bun rule-check.ts', blockAt: 0.85 } }
    const { workflowDispatched, scripted, checkPlan } = await run(args, replies())
    expect(workflowDispatched.filter((l: string) => /^rules\b/.test(l))).toEqual([])
    expect(scripted).toContain('rules:rules')
    expect(checkPlan.rules).toEqual([{ name: 'rules', cmd: 'bun rule-check.ts' }])
  })

  test('the plan stage dispatches nothing at all', async () => {
    const { result } = await runStage({ ...baseArgs, tasks: [task({ redCommand: 'pytest a' })], lens: { prompt: 'p', refs: [] } }, { plan: true })
    expect(result.stage).toBe('plan')
    expect(result.checkPlan.red).toEqual([{ id: 'T1', command: 'pytest a' }])
  })
})

describe('work-checks.sh tells every command the run mode', () => {
  test('WORK_READ_ONLY is 1 under args.readOnly and 0 otherwise, for mechanical and rule commands alike', () => {
    const dir = repo({ 'a.txt': 'a' })
    const plan = {
      mechanical: [{ name: 'mode', cmd: 'echo "mode=${WORK_READ_ONLY-unset}"' }],
      rules: [{ name: 'rules', cmd: 'echo "mode=${WORK_READ_ONLY-unset}" >&2; echo \'{"verdicts":[],"unavailable":[]}\'' }],
    }
    const ro = checks({ projectDir: dir, tasks: [], readOnly: true }, plan).checks
    expect(ro.mechanical[0].output).toBe('mode=1')
    expect(ro.rules[0].output).toBe('mode=1')
    const rw = checks({ projectDir: dir, tasks: [] }, plan).checks
    expect(rw.mechanical[0].output).toBe('mode=0')
    expect(rw.rules[0].output).toBe('mode=0')
  })
})

describe('work-checks.sh runs ruleChecks.cmd and records {name, exitCode, stdout}', () => {
  const VIOLATED = '{"verdicts":[{"rule":"R1","p":0.9,"verdict":"VIOLATED"}],"unavailable":[]}'
  const MET = '{"verdicts":[{"rule":"R1","p":0.1,"verdict":"MET"}],"unavailable":[]}'
  const stub = (dir: string, line: string, code: number) => {
    const p = join(dir, 'rule-check.sh')
    writeFileSync(p, `#!/usr/bin/env bash\necho 'scanning…' >&2\necho 'progress'\necho '${line}'\nexit ${code}\n`)
    chmodSync(p, 0o755)
    return p
  }

  test('VIOLATED: exit 2 and the JSON line are recorded as the rule check printed them', () => {
    const dir = repo({ 'a.txt': 'a' })
    const r = checks({ projectDir: dir, tasks: [] }, { rules: [{ name: 'rules', cmd: `bash ${stub(dir, VIOLATED, 2)}` }] })
    expect(r.code).toBe(0)
    expect(r.checks.rules).toHaveLength(1)
    expect(r.checks.rules[0]).toMatchObject({ name: 'rules', exitCode: 2, stdout: VIOLATED })
  })

  test('MET: exit 0 and the JSON line', () => {
    const dir = repo({ 'a.txt': 'a' })
    const r = checks({ projectDir: dir, tasks: [] }, { rules: [{ name: 'rules', cmd: `bash ${stub(dir, MET, 0)}` }] })
    expect(r.checks.rules[0]).toMatchObject({ name: 'rules', exitCode: 0, stdout: MET })
  })

  test('a crashing cmd, or one that prints no JSON object, fails closed at -1', () => {
    const dir = repo({ 'a.txt': 'a' })
    const r = checks({ projectDir: dir, tasks: [] }, { rules: [
      { name: 'crash', cmd: 'exit 127' },
      { name: 'absent', cmd: 'definitely-not-a-command-xyz' },
      { name: 'prose', cmd: 'echo "all rules met"; exit 0' },
      { name: 'array', cmd: 'echo "[1,2]"; exit 0' },
    ] })
    for (const name of ['crash', 'absent', 'prose', 'array']) {
      const rec = r.checks.rules.find((x: any) => x.name === name)
      expect({ name, exitCode: rec?.exitCode }).toEqual({ name, exitCode: -1 })
    }
  })

  test('the gate blocks on the recorded VIOLATED line', async () => {
    const dir = repo({ 'a.txt': 'a' })
    const rec = checks({ projectDir: dir, tasks: [] }, { rules: [{ name: 'rules', cmd: `bash ${stub(dir, VIOLATED, 2)}` }] }).checks.rules[0]
    const args = { ...baseArgs, tasks: [task()], ruleChecks: { name: 'rules', cmd: 'x', blockAt: 0.85 } }
    const r = await run(args, replies({ rules: { rules: { exitCode: rec.exitCode, stdout: rec.stdout } } }))
    expect(r.result.rulesThatFailed.length).toBeGreaterThan(0)
    expect(r.result.rulesThatFailed.join(' ')).toMatch(/R1/)
  })
  test('the digest lists a failed rule with its owner; a clean rule check is settled', () => {
    const tasks = [{ id: 'T1', writablePaths: ['src/'] }, { id: 'T2', writablePaths: ['lib/'] }]
    const rc = { name: 'rules', cmd: 'bun rule-check.ts', blockAt: 0.85 }
    const stdout = '{"verdicts":[{"rule":"R1 lib/b.ts","p":0.9,"verdict":"VIOLATED"}],"unavailable":[]}'
    const gate = (failed: string[]) => ({ mode: 'RED', digest: { rulesThatFailed: failed }, agents: { implemented: [], verified: [] } })
    const dir = repo({ 'a.txt': 'a' })
    const d = buildDigest({ tasks, ruleChecks: rc }, { rules: [{ name: 'rules', cmd: rc.cmd, exitCode: 2, stdout, output: '' }] }, gate(['R1 lib/b.ts: p=0.9 — VIOLATED']), dir)
    expect(d.failures.map((f: any) => [f.check, f.owner, f.exitCode, f.command])).toEqual([['rules:rules', 'T2', 2, 'bun rule-check.ts']])
    expect(d.failures[0].output).toMatch(/R1 lib\/b\.ts: p=0\.9/)
    const clean = buildDigest({ tasks, ruleChecks: rc }, { rules: [{ name: 'rules', cmd: rc.cmd, exitCode: 0, stdout: '{"verdicts":[],"unavailable":[]}', output: '' }] }, gate([]), dir)
    expect(clean.failures).toEqual([])
    expect(clean.settled.map((s: any) => s.check)).toEqual(['rules:rules'])
  })
})
