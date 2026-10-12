import { expect, setDefaultTimeout, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from './helpers/tmp.ts'

setDefaultTimeout(120_000)
const mkTmp = useTmp()

const ROOT = join(import.meta.dir, '..')
const RUNNER = join(ROOT, 'bin', 'workflow-check')

const LEG = /^[\w.-]+: \d+ \S.*examined/
const EMPTY = /^[\w.-]+: 0 \S.*examined.*nothing in scope \([^)]+\)/
const FINDING = /^\S+:\d+: \S+ \S/m

// A missing binary is a null status and no output, never a throw: the assertions on them are what fail.
const sh = (cmd: string, args: string[], env: Record<string, string> = {}, cwd?: string) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 100_000, cwd, env: { ...process.env, ...env } })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error?.message ?? '') }
}
const wcheck = (args: string[], env: Record<string, string> = {}) => sh(RUNNER, args, { WORKFLOW_CHECKS_PATH: ROOT, ...env })
const first = (out: string) => out.split('\n')[0]

/** `checks/…/x.py` tails mentioned in a --list output, whatever its format (JSON, lines). */
const listed = (out: string) => [...new Set([...out.matchAll(/(?<![\w-])checks\/[\w./-]+\.py/g)].map(m => m[0]))].sort()

/** The runnable files of a workflow on disk, parents included, computed from the filesystem. */
function onDisk(root: string, wf: string): string[] {
  const parts = wf.split('/')
  const out: string[] = []
  for (let i = 1; i <= parts.length; i++) for (const kind of ['constraints', 'rules']) {
    const rel = `checks/${parts.slice(0, i).join('/')}/${kind}`
    if (!existsSync(join(root, rel))) continue
    for (const f of readdirSync(join(root, rel))) if (/^[^_.].*\.py$/.test(f) && statSync(join(root, rel, f)).isFile()) out.push(`${rel}/${f}`)
  }
  return out.sort()
}
/** .py files directly in `rel` (none when the directory is gone): an old location must hold no check. */
const pyIn = (rel: string, root = ROOT) => existsSync(join(root, rel)) ? readdirSync(join(root, rel)).filter(f => f.endsWith('.py')) : []

function put(dir: string, files: Record<string, string>) {
  for (const [n, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, n)), { recursive: true }); writeFileSync(join(dir, n), body) }
  return dir
}
function project(files: Record<string, string> = {}) {
  const d = mkTmp('wfc-proj-')
  const git = (...a: string[]) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8', timeout: 60_000 })
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(d, 'README.md'), 'x'); git('add', '-A'); git('commit', '-qm', 'i')
  return put(d, files)
}
function stub(body: string) {
  const f = join(mkTmp('wfc-stub-'), 'rc.sh')
  writeFileSync(f, `#!/usr/bin/env bash\necho '${body}'\n`); chmodSync(f, 0o755)
  return f
}
/** A plugin root holding only the given files (a private layout to prove discovery with). */
const plug = (files: Record<string, string>) => put(mkTmp('wfc-plug-'), files)
/** A constraint that always fires, to show a caller reached the runner and the runner reached the directory. */
const FIRES = (name: string) => `import sys\nprint("${name}: 1 file(s) examined")\nprint("x.py:1: ${name.toUpperCase()} fired")\nsys.exit(1)\n`
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

// T7 — callers and retirement: /work dispatch names the workflow and fills ruleChecks, plan-lint refuses a mismatch, a farm row must carry
// a workflow, the per-edit hooks resolve their sets from the layout, and the old membership machinery is gone.
// Plan: groovy-strolling-octopus.md (Design + T7). Assumes T1-T6 are in; checks/ is reached through WORKFLOW_CHECKS_PATH=ROOT.
const DISPATCH = join(ROOT, 'skills', 'work', 'scripts', 'work-dispatch.sh')
const LINT = join(ROOT, 'skills', 'work', 'scripts', 'plan-lint.ts')
const FARM = join(ROOT, 'skills', 'farm-out', 'scripts', 'farm.sh')
const RULE_CHECK = join(ROOT, 'skills', 'work', 'scripts', 'rule-check.ts')

// ---- /work: dispatch --------------------------------------------------------------------------------------

/** A lint-clean plan (the shape work-dispatch.test.ts uses) with `workflow:` frontmatter and the given gate commands. */
function planFor(opts: { workflow?: string; mech?: (dir: string) => string; ruleChecks?: { name: string; cmd: string } }) {
  const dir = mkTmp('wfc-dispatch-')
  mkdirSync(join(dir, 'src'), { recursive: true }); mkdirSync(join(dir, 'scripts'), { recursive: true })
  writeFileSync(join(dir, 'scripts', 'check.sh'), '#!/usr/bin/env bash\necho "1 failed, 0 passed"\nexit 1\n'); chmodSync(join(dir, 'scripts', 'check.sh'), 0o755)
  const args: Record<string, unknown> = {
    projectDir: dir, goal: 'make the thing correct',
    tasks: [{ id: 'T1', name: 'one', work: 'do the thing', writablePaths: ['src/'], refs: [], redCommand: 'bash scripts/check.sh', acceptance: '`bash scripts/check.sh` exits 0' }],
    mechanicalChecks: [{ name: 'gate', cmd: opts.mech ? opts.mech(dir) : 'bun test' }],
    lens: { agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' },
    ...(opts.ruleChecks ? { ruleChecks: opts.ruleChecks } : {}),
  }
  const plan = join(dir, 'plan.md')
  writeFileSync(plan, `${opts.workflow ? `---\nworkflow: ${opts.workflow}\n---\n\n` : ''}# Plan\n\n## Run sizing\n\nnothing parked\n\n<!-- work:dispatch\n${JSON.stringify({ runId: 'wf-run', args }, null, 2)}\n-->\n`)
  return { dir, plan, argsPath: join(dir, '.work', 'wf-run', 'args.json') }
}
const dispatch = (f: { dir: string; plan: string }) =>
  sh('bash', [DISPATCH, '--provider', 'claude', '--no-red-probe', '--no-mech-probe', '--no-suite-lint', f.plan], { WORK_DISPATCH_DRYRUN: '1', WORKFLOW_CHECKS_PATH: ROOT }, f.dir)
const DEV_CHECK = (dir: string) => `bash ${ROOT}/skills/dev/scripts/check.sh --project-dir ${dir} --test-cmd "true"`

test('dispatch reads the plan\'s workflow:, writes ACTIVE_WORKFLOW.md and fills ruleChecks with workflow-check <wf> --rules-only itself', () => {
  const f = planFor({ workflow: 'dev', mech: DEV_CHECK })
  const r = dispatch(f)
  expect(r.status, r.stdout + r.stderr).toBe(0)
  const args = JSON.parse(readFileSync(f.argsPath, 'utf8'))
  expect(args.ruleChecks?.cmd ?? '', 'ruleChecks is filled from workflow:').toMatch(/workflow-check\s+dev\s+--rules-only/)
  expect(args.ruleChecks.cmd).not.toMatch(/--rules\s+\S*constraints\/jev/)
  const cursor = join(f.dir, '.planning', 'ACTIVE_WORKFLOW.md')
  expect(existsSync(cursor), '.planning/ACTIVE_WORKFLOW.md in projectDir').toBe(true)
  expect(readFileSync(cursor, 'utf8')).toMatch(/^workflow:\s*dev\s*$/m)
})

test('plan-lint refuses mechanicalChecks that never reach workflow-check <wf>, and a ruleChecks that names a different workflow', () => {
  // neither the workflow's check.sh nor workflow-check: the gate can skip the workflow's checks entirely
  const noReach = planFor({ workflow: 'dev' })
  const a = dispatch(noReach)
  expect(a.status, a.stdout + a.stderr).not.toBe(0)
  expect(a.stdout + a.stderr).toContain('workflow-check')
  const lint = sh('bun', [LINT, noReach.plan])
  expect(lint.status, lint.stdout + lint.stderr).toBe(1)
  expect(lint.stdout).toContain('workflow-check')
  // reaches dev, but the plan's own ruleChecks scores ds
  const wrong = planFor({ workflow: 'dev', mech: DEV_CHECK, ruleChecks: { name: 'rules', cmd: 'workflow-check ds --rules-only --project-dir /x' } })
  const b = dispatch(wrong)
  expect(b.status, b.stdout + b.stderr).not.toBe(0)
  expect(b.stdout + b.stderr).toMatch(/ruleChecks[^\n]*workflow|workflow[^\n]*ruleChecks/)
  // the agreeing plan is the control: it passes
  const ok = planFor({ workflow: 'dev', mech: DEV_CHECK, ruleChecks: { name: 'rules', cmd: 'workflow-check dev --rules-only --project-dir /x' } })
  const c = dispatch(ok)
  expect(c.status, c.stdout + c.stderr).toBe(0)
})

test('a plan with no workflow names workflow: work, which has no checks and says so', () => {
  const f = planFor({})
  const r = dispatch(f)
  expect(r.status, r.stdout + r.stderr).toBe(0)
  expect(readFileSync(join(f.dir, '.planning', 'ACTIVE_WORKFLOW.md'), 'utf8')).toMatch(/^workflow:\s*work\s*$/m)
  const wc = wcheck(['work', '--project-dir', project({ 'src/a.ts': 'export {}\n' }), '--changed'])
  expect(wc.status, wc.stdout + wc.stderr).toBe(0)
  expect(wc.stdout).toContain('nothing in scope')
})

test('rule-check with zero files in scope reports an explicit empty scope instead of a silent pass', () => {
  const r = sh('bun', [RULE_CHECK, '--workflow', 'ds', '--project-dir', project({}), '--plan', '/dev/null'], { WORKFLOW_CHECKS_PATH: ROOT })
  expect(r.status, r.stdout + r.stderr).toBe(0)
  expect(r.stdout + r.stderr).toContain('nothing in scope')
})

// ---- farmed rows --------------------------------------------------------------------------------------------

function farm(rows: Record<string, unknown>[], draft?: string, env: Record<string, string> = {}) {
  const root = mkTmp('wfc-farm-')
  const cwd = join(root, 'cwd'); const bin = join(root, 'bin'); const fixture = join(root, 'fixture')
  mkdirSync(cwd, { recursive: true }); mkdirSync(bin, { recursive: true })
  if (draft !== undefined) put(fixture, { 'draft.md': draft })
  const ran = join(root, 'ran')
  writeFileSync(join(bin, 'claude-code'), `#!/usr/bin/env bash\n: > "${ran}"\n${draft !== undefined ? `mkdir -p out && cp ${fixture}/* out/\n` : ''}printf '{"type":"result","result":"done"}\\n'\n`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  const tasks = join(root, 'tasks.json'); writeFileSync(tasks, JSON.stringify(rows))
  const r = spawnSync('bash', [FARM, '--provider', 'claude', '--tasks', tasks, '--cwd', cwd], { encoding: 'utf8', timeout: 100_000, cwd: root,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FARM_OUT_CHILD: '1', FARM_OUTCOMES: join(root, 'outcomes.jsonl'), TMPDIR: root,
      CLAUDE_CODE_SESSION_ID: 'checks-callers-test', WORKFLOW_CHECKS_PATH: ROOT, DOMAIN_GATE_RULE_CHECK: stub('{"verdicts":[],"unavailable":[]}'), ...env } })
  let parsed: any[] = []; try { parsed = JSON.parse(r.stdout || '[]') } catch {}
  return { status: r.status, stderr: r.stderr ?? '', ran: existsSync(ran), rows: parsed }
}

test('a farm row must name its workflow: a bare row and an unknown value are refused at launch and nothing runs', () => {
  const bare = farm([{ label: 'bare', agent: 'general-purpose', prompt: 'Do the thing.' }])
  expect(bare.status, bare.stderr).toBe(2)
  expect(bare.stderr).toMatch(/workflow/)
  expect(bare.ran).toBe(false)
  const bogus = farm([{ label: 'bogus', agent: 'general-purpose', workflow: 'bogus', prompt: 'Do the thing.' }])
  expect(bogus.status, bogus.stderr).toBe(2)
  expect(bogus.stderr).toContain('bogus')
  expect(bogus.ran).toBe(false)
})

test('a row runs when its workflow is a value, "none" stated explicitly, or implied by its persona', () => {
  for (const row of [
    { label: 'explicit', agent: 'general-purpose', workflow: 'writing', prompt: 'Draft the memo.' },
    { label: 'none', agent: 'general-purpose', workflow: 'none', prompt: 'Summarise the thread.' },
    { label: 'ds-persona', agent: 'ds', prompt: 'Count the firms in the panel.' },
    { label: 'legal-persona', agent: 'writing-legal', prompt: 'Draft Part II.' },
  ]) {
    const r = farm([row])
    expect(r.status, `${row.label}: ${r.stderr}`).toBe(0)
    expect(r.ran, row.label).toBe(true)
  }
})

test('workflow-check gates a farmed row of any workflow: a writing row that leaves a violating draft fails by name, a clean one passes', () => {
  const hit = farm([{ label: 'w', agent: 'general-purpose', workflow: 'writing', prompt: 'Draft the memo.' }], 'Plain opening paragraph here.\n\nThe key finding is robust to every specification.\n')
  expect(hit.ran).toBe(true)
  expect(hit.rows[0]?.ok, JSON.stringify(hit.rows[0])).toBe(false)
  expect(hit.rows[0].failure).toContain('draft.md:3')
  const rule = farm([{ label: 'w', agent: 'general-purpose', workflow: 'writing', prompt: 'Draft the memo.' }], 'Plain opening paragraph here.\n\nA second plain paragraph.\n',
    { DOMAIN_GATE_RULE_CHECK: stub('{"verdicts":[{"rule":"W-HEDGE","p":0.9,"verdict":"VIOLATED","spans":["out/draft.md:1"]}],"unavailable":[]}') })
  expect(rule.rows[0]?.ok, JSON.stringify(rule.rows[0])).toBe(false)
  expect(rule.rows[0].failure).toContain('W-HEDGE p=0.9')
  const clean = farm([{ label: 'w', agent: 'general-purpose', workflow: 'writing', prompt: 'Draft the memo.' }], 'Plain opening paragraph here.\n\nA second plain paragraph.\n')
  expect(clean.rows[0]?.ok, JSON.stringify(clean.rows[0])).toBe(true)
})

// ---- per-edit hooks -----------------------------------------------------------------------------------------

test('the per-edit hooks take their rule and constraint sets from workflow-check --list, not from constants', () => {
  for (const f of ['hooks/jev/rules.ts', 'hooks/jev/mod.ts', 'hooks/writing-prose-check.ts'])
    expect(read(f), f).not.toMatch(/\b(RULE_DIRS|REGISTER_DIRS|TEACHING_SETS|TEACHING_PROBE)\b/)
  expect(read('hooks/jev/mod.ts') + read('hooks/jev/rules.ts'), 'the jev mod resolves sets through the runner').toContain('workflow-check')
  expect(read('hooks/writing-prose-check.ts'), 'the prose hook resolves its set through the runner').toContain('workflow-check')
})

// ---- retirement ---------------------------------------------------------------------------------------------

const tracked = () => (spawnSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }).stdout ?? '').split('\n').filter(Boolean)

test('the old machinery is gone: no constraints/ tree, run-constraints.py, domain-gate, check-all-ds, APPLIES_TO or the retired constants', () => {
  const files = tracked()
  expect(files.length, 'git ls-files readable').toBeGreaterThan(100)
  expect(files.filter(f => f.startsWith('constraints/')), 'constraints/ tree').toEqual([])
  expect(files.filter(f => f.endsWith('run-constraints.py')), 'run-constraints.py').toEqual([])
  for (const f of ['skills/work/scripts/domain-gate.py', 'scripts/check-all-ds.sh']) expect(files, f).not.toContain(f)
  expect(read('skills/work/scripts/rule-check.ts'), 'rule-check --rules retired in favour of --workflow').not.toContain("'--rules'")
  const SELF = 'tests/checks-callers.test.ts'
  const scope = /^(skills\/work\/|skills\/farm-out\/|hooks\/|scripts\/|skills\/workflow-creator\/scripts\/|tests\/)/
  const hits = files.filter(f => scope.test(f) && f !== SELF && /\.(py|ts|mjs|js|sh)$/.test(f) && existsSync(join(ROOT, f)))
    .filter(f => /RULE_DIRS|REGISTER_DIRS|TEACHING_SETS|TEACHING_PROBE|APPLIES_TO|run-constraints\.py/.test(readFileSync(join(ROOT, f), 'utf8')))
  expect(hits).toEqual([])
})

test('every check file under checks/ is reached by workflow-check --list for some workflow, and none sits outside constraints/ or rules/', () => {
  const workflows: string[] = []
  const stray: string[] = []
  const walk = (rel: string) => {
    for (const e of readdirSync(join(ROOT, rel))) {
      const p = `${rel}/${e}`
      if (!statSync(join(ROOT, p)).isDirectory()) { if (e.endsWith('.py') && !e.startsWith('_') && !/\/(constraints|rules)$/.test(rel)) stray.push(p); continue }
      if (e.startsWith('_') || e === 'uncalibrated' || e === '__pycache__') continue
      if (e === 'constraints' || e === 'rules') continue
      workflows.push(p.slice('checks/'.length)); walk(p)
    }
  }
  expect(existsSync(join(ROOT, 'checks')), 'checks/ exists').toBe(true)
  walk('checks')
  const everyFile = workflows.flatMap(wf => ['constraints', 'rules'].flatMap(k => onDisk(ROOT, wf).filter(f => f.startsWith(`checks/${wf}/${k}/`))))
  expect(workflows.length).toBeGreaterThanOrEqual(8)
  expect(stray, 'check files outside a constraints/ or rules/ directory').toEqual([])
  const reached = new Set<string>()
  for (const wf of workflows) { const r = wcheck([wf, '--list']); expect(r.status, `${wf}: ${r.stderr}`).toBe(0); listed(r.stdout).forEach(f => reached.add(f)) }
  expect(everyFile.filter(f => !reached.has(f)), 'unreached check files').toEqual([])
})
