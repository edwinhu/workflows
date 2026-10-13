// T1 — the checks/ layout, the one constraint contract and the one runner (bin/workflow-check), proved on ds.
// Plan: groovy-strolling-octopus.md (Design + T1). Constraints = deterministic scripts; rules = Jev-scored modules.
// Everything below spawns the real runner / real constraint scripts; only the model call is stubbed
// (DOMAIN_GATE_RULE_CHECK for the runner, a local Decisions server for rule-check.ts), as domain-gate.test.ts does.
import { expect, setDefaultTimeout, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from './helpers/tmp.ts'

setDefaultTimeout(360_000)
const mkTmp = useTmp()

const ROOT = join(import.meta.dir, '..')
const RUNNER = join(ROOT, 'bin', 'workflow-check')
const RULE_CHECK = join(ROOT, 'skills', 'work', 'scripts', 'rule-check.ts')
const BAD = readFileSync(join(import.meta.dir, 'fixtures', 'ds-gate', 'bad', 'pipeline.py'), 'utf8')
const CLEAN = readFileSync(join(import.meta.dir, 'fixtures', 'ds-gate', 'clean', 'pipeline.py'), 'utf8')

// What moves, by name (the plan's T1 work text): 14 constraints + 2 helpers, 9 rules, 3 shared Jev helpers.
const DS_CONSTRAINTS = ['ds-chart-color', 'ds-chart-typography', 'ds-data-pull-profile', 'ds-determinism', 'ds-error-handling',
  'ds-external-skill-discovery', 'ds-idempotency', 'ds-join-audits', 'ds-network-politeness', 'ds-robustness-checks',
  'ds-schema-contracts', 'ds-standard-error-spec', 'ds-table-figure-pairing', 'ds-visualization-integrity'].map(n => `${n}.py`)
const DS_HELPERS = ['_ds_logging.py', '_ds_waivers.py']
const DS_RULES = ['A1', 'A4', 'DEN', 'DQ4', 'DQ6', 'E7', 'M1', 'R1', 'UNI'].map(n => `${n}.py`)
const JEV_SHARED = ['evidence.py', '_common.py', '_ds.py']

const LEG = /^[\w.-]+: \d+ \S.*examined/
const EMPTY = /^[\w.-]+: 0 \S.*examined.*nothing in scope \([^)]+\)/
const FINDING = /^\S+:\d+: \S+ \S/m

// A missing binary is a null status and no output, never a throw: the assertions on them are what fail.
const sh = (cmd: string, args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 100_000, env: { ...process.env, ...env } })
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
const FIRES = (name: string) => `import sys\nprint("${name}: 1 file(s) examined")\nprint("x.py:1: ${name.toUpperCase()} fired")\nsys.exit(1)\n`

// ---- layout -----------------------------------------------------------------------------------------

test('every ds constraint and rule lives under checks/ds/ and the old locations hold none of them', () => {
  for (const f of [...DS_CONSTRAINTS, ...DS_HELPERS]) {
    expect(existsSync(join(ROOT, 'checks', 'ds', 'constraints', f)), `checks/ds/constraints/${f}`).toBe(true)
    expect(existsSync(join(ROOT, 'constraints', f)), `constraints/${f} must be gone`).toBe(false)
  }
  expect(existsSync(join(ROOT, 'checks', 'ds', 'constraints', 'ds-dq.py')), 'ds-dq is a ds constraint').toBe(true)
  expect(existsSync(join(ROOT, 'skills', 'ds', 'scripts', 'ds-dq.py')), 'skills/ds/scripts/ds-dq.py must be gone').toBe(false)
  for (const f of DS_RULES) {
    expect(existsSync(join(ROOT, 'checks', 'ds', 'rules', f)), `checks/ds/rules/${f}`).toBe(true)
    expect(existsSync(join(ROOT, 'constraints', 'jev', f)), `constraints/jev/${f} must be gone`).toBe(false)
  }
  for (const f of JEV_SHARED) {
    expect(existsSync(join(ROOT, 'checks', '_jev', f)), `checks/_jev/${f}`).toBe(true)
    expect(existsSync(join(ROOT, 'constraints', 'jev', f)), `constraints/jev/${f} must be gone`).toBe(false)
  }
})

test('workflow-check ds --list is exactly the runnable files on disk, helpers and uncalibrated excluded', () => {
  const r = wcheck(['ds', '--list'])
  expect(r.status, r.stderr).toBe(0)
  const disk = onDisk(ROOT, 'ds')
  expect(disk.length).toBeGreaterThanOrEqual(DS_CONSTRAINTS.length + DS_RULES.length)
  expect(listed(r.stdout)).toEqual(disk)
  expect(r.stdout).not.toMatch(/\/_[\w-]+\.py|uncalibrated/)
})

// ---- the one constraint contract ----------------------------------------------------------------------

test('every ds constraint honours the CLI contract: leg-count first line, path:line findings, exit 0/1', () => {
  const names = onDisk(ROOT, 'ds').filter(f => f.includes('/constraints/'))
  expect(names.length).toBeGreaterThanOrEqual(DS_CONSTRAINTS.length)
  const p = project({ 'src/p.py': BAD })
  for (const rel of names) {
    const r = sh('python3', [join(ROOT, rel), '--project-dir', p, '--files', join(p, 'src/p.py')])
    expect([0, 1], `${rel}: exit ${r.status}\n${r.stdout}${r.stderr}`).toContain(r.status)
    expect(first(r.stdout), rel).toMatch(LEG)
    if (r.status === 1) expect(r.stdout, `${rel} findings`).toMatch(FINDING)
  }
})

test('given nothing it is relevant to, every ds constraint prints an explicit empty scope and exits 0; a plan reader with no --plan does too', () => {
  const names = onDisk(ROOT, 'ds').filter(f => f.includes('/constraints/'))
  expect(names.length).toBeGreaterThanOrEqual(DS_CONSTRAINTS.length)
  const p = project({ 'LICENSE.txt': 'MIT\n' })
  for (const rel of names) {
    const r = sh('python3', [join(ROOT, rel), '--project-dir', p, '--files', join(p, 'LICENSE.txt')])
    expect(r.status, `${rel}\n${r.stdout}${r.stderr}`).toBe(0)
    expect(first(r.stdout), rel).toMatch(EMPTY)
  }
  const plan = sh('python3', [join(ROOT, 'checks/ds/constraints/ds-data-pull-profile.py'), '--project-dir', p, '--files', join(p, 'LICENSE.txt')])
  expect(plan.status, plan.stderr).toBe(0)
  expect(first(plan.stdout)).toMatch(EMPTY)
  const viaRunner = wcheck(['ds', '--project-dir', p, '--constraints-only', '--files', join(p, 'LICENSE.txt')])
  expect(viaRunner.status, viaRunner.stderr).toBe(0)
  expect(viaRunner.stdout).toContain('nothing in scope')
})

test('a checker is given the path and checks it: scratch/, worktrees/ and hidden directories are no longer pruned', () => {
  for (const d of ['scratch', 'worktrees', '.hidden']) {
    const p = project({ [`${d}/p.py`]: BAD, [`${d}/c.py`]: 'import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\n' })
    const join_ = sh('python3', [join(ROOT, 'checks/ds/constraints/ds-join-audits.py'), '--project-dir', p, '--files', join(p, d, 'p.py')])
    expect(join_.status, `${d}\n${join_.stdout}${join_.stderr}`).toBe(1)
    expect(first(join_.stdout), d).toMatch(/: [1-9]\d* \S.*examined/)
    expect(join_.stdout).toContain(`${d}/p.py:`)
    const chart = sh('python3', [join(ROOT, 'checks/ds/constraints/ds-chart-color.py'), '--project-dir', p, '--files', join(p, d, 'c.py')])
    expect([0, 1], `${d}\n${chart.stdout}${chart.stderr}`).toContain(chart.status)
    expect(first(chart.stdout), `${d}: ds-chart-color must have examined the chart`).toMatch(/: [1-9]\d* \S.*examined/)
  }
})

// ---- the runner ------------------------------------------------------------------------------------------

test('workflow-check ds runs every constraint on the changed files: a dirty tree fails by name, a clean one passes', () => {
  const bad = wcheck(['ds', '--project-dir', project({ 'src/p.py': BAD }), '--constraints-only', '--changed'])
  expect(bad.status, bad.stderr).toBe(1)
  expect(first(bad.stdout)).toMatch(/^[\w-]+: [1-9]\d* \S.*examined/)
  for (const c of ['ds-join-audits', 'ds-error-handling', 'ds-schema-contracts']) expect(bad.stdout).toContain(c)
  expect(bad.stdout).toContain('p.py:')
  const ok = wcheck(['ds', '--project-dir', project({ 'src/p.py': CLEAN }), '--constraints-only', '--changed'])
  expect(ok.status, ok.stdout + ok.stderr).toBe(0)
  expect(first(ok.stdout)).toMatch(/^[\w-]+: [1-9]\d* \S.*examined/)
})

test('workflow-check ds --rules-only scores the rules: a violation is exit 1, a rule that cannot be judged or a mute runner is exit 2', () => {
  const p = project({ 'src/p.py': CLEAN })
  const args = ['ds', '--project-dir', p, '--rules-only', '--changed']
  const hit = wcheck(args, { DOMAIN_GATE_RULE_CHECK: stub('{"verdicts":[{"rule":"M1","p":0.97,"verdict":"VIOLATED"}],"unavailable":[]}') })
  expect(hit.status, hit.stdout + hit.stderr).toBe(1)
  expect(hit.stdout).toContain('M1 p=0.97')
  const un = wcheck(args, { DOMAIN_GATE_RULE_CHECK: stub('{"verdicts":[],"unavailable":[{"rule":"A1","reason":"no credit"}]}') })
  expect(un.status).toBe(2)
  expect(un.stdout).toContain('A1 could not be judged')
  expect(wcheck(args, { DOMAIN_GATE_RULE_CHECK: stub('not json') }).status).toBe(2)
  const clean = wcheck(args, { DOMAIN_GATE_RULE_CHECK: stub('{"verdicts":[],"unavailable":[]}') })
  expect(clean.status, clean.stdout + clean.stderr).toBe(0)
}, 460_000)

test('the directory is membership: a file dropped into a plugin\'s checks/ is reached with no edit, parents are inherited, _-dirs are not workflows', () => {
  const a = plug({
    'checks/ds/constraints/ds-newcheck.py': FIRES('ds-newcheck'),
    'checks/ds/constraints/_helper.py': 'X = 1\n',
    'checks/ds/rules/uncalibrated/X1.py': 'X = 1\n',
    'checks/zz/constraints/a.py': FIRES('a'),
    'checks/zz/sub/constraints/b.py': FIRES('b'),
    'checks/_jev/c.py': 'X = 1\n',
  })
  const b = plug({ 'checks/ds/constraints/ds-other.py': FIRES('ds-other') })
  const lst = (wf: string, path: string) => wcheck([wf, '--list'], { WORKFLOW_CHECKS_PATH: path })
  expect(listed(lst('ds', a).stdout)).toEqual(['checks/ds/constraints/ds-newcheck.py'])
  expect(listed(lst('zz', a).stdout)).toEqual(['checks/zz/constraints/a.py'])
  expect(listed(lst('zz/sub', a).stdout)).toEqual(['checks/zz/constraints/a.py', 'checks/zz/sub/constraints/b.py'])
  expect(listed(lst('ds', `${a}:${b}`).stdout)).toEqual(['checks/ds/constraints/ds-newcheck.py', 'checks/ds/constraints/ds-other.py'])
  const jev = lst('_jev', a)
  expect(jev.status).not.toBe(0)
  expect(jev.status).not.toBeNull()
  const nope = lst('no-such-workflow', a)
  expect(nope.status).toBe(2)
  // the dropped-in constraint actually runs, and its finding fails the run
  const run = wcheck(['ds', '--project-dir', project({ 'src/p.py': CLEAN }), '--constraints-only', '--changed'], { WORKFLOW_CHECKS_PATH: a })
  expect(run.status, run.stdout + run.stderr).toBe(1)
  expect(run.stdout).toContain('DS-NEWCHECK fired')
})

test('rule-check.ts --workflow ds resolves the rule directories through the layout and scores only those rules', async () => {
  const diskRules = onDisk(ROOT, 'ds').filter(f => f.includes('/rules/')).map(f => f.split('/').pop()!.replace(/\.py$/, ''))
  expect(diskRules.length).toBeGreaterThan(0)
  const server = Bun.serve({ port: 0, async fetch(req) {
    await req.text()
    return new Response(JSON.stringify({ answers: { q0: { probabilities: { VIOLATED: 0.1 }, choice: 'MET' } } }))
  } })
  try {
    const p = project({ 'src/p.py': BAD })
    // async: spawnSync would block the event loop that serves the stub judge above
    const proc = Bun.spawn(['bun', RULE_CHECK, '--workflow', 'ds', '--project-dir', p, '--files', join(p, 'src/p.py')], {
      stdout: 'pipe', stderr: 'pipe', timeout: 100_000,
      env: { ...process.env, WORKFLOW_CHECKS_PATH: ROOT, WORK_HOLD_DECISIONS_URL: `http://localhost:${server.port}/`, WORK_HOLD_JUDGE_TOKEN: 'test-token' } })
    const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    const r = { status: proc.signalCode ? null : status, stdout, stderr }
    expect([0, 1], r.stdout + r.stderr).toContain(r.status)
    const out = JSON.parse(r.stdout)
    const seen: string[] = [...out.verdicts, ...out.unavailable].map((v: { rule: string }) => v.rule)
    expect(seen.length).toBeGreaterThan(0)
    for (const rule of seen) expect(diskRules, `${rule} is not a ds rule on disk`).toContain(rule)
  } finally { server.stop(true) }
})
