// One gate per domain: it reaches every constraints/<domain>-*.py and the domain's wired Jev set,
// computed from the filesystem, and each domain's check.sh calls it.
import { afterAll, expect, test } from 'bun:test'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { RULE_DIRS } from '../hooks/jev/rules.ts'

const ROOT = join(import.meta.dir, '..')
const GATE = join(ROOT, 'skills', 'work', 'scripts', 'domain-gate.py')
const STUB = join(import.meta.dir, 'fixtures', 'ds-gate', 'rule-check-clean.sh')
const BAD = readFileSync(join(import.meta.dir, 'fixtures', 'ds-gate', 'bad', 'pipeline.py'), 'utf8')
const CLEAN = readFileSync(join(import.meta.dir, 'fixtures', 'ds-gate', 'clean', 'pipeline.py'), 'utf8')
const DOMAINS = ['ds', 'dev']
const trash: string[] = []
afterAll(() => trash.forEach(d => rmSync(d, { recursive: true, force: true })))

const list = (d: string) => JSON.parse(spawnSync('python3', [GATE, '--domain', d, '--list'], { encoding: 'utf8', timeout: 60_000 }).stdout)

// ---- coverage: both sides computed from the filesystem ------------------------------------------

for (const d of DOMAINS) {
  test(`${d}: the gate reaches every constraints/${d}-*.py on disk`, () => {
    const onDisk = readdirSync(join(ROOT, 'constraints')).filter(f => f.startsWith(`${d}-`) && f.endsWith('.py')).sort()
    expect(list(d).constraints).toEqual(onDisk)
  })

  test(`${d}: the gate scores the Jev directory RULE_DIRS wires for it`, () => {
    expect(list(d).rulesDir).toBe(RULE_DIRS[d as keyof typeof RULE_DIRS])
    const rules = readdirSync(join(ROOT, RULE_DIRS[d as keyof typeof RULE_DIRS])).filter(f => /^[A-Za-z0-9-]+\.py$/.test(f) && f !== 'evidence.py')
    expect(rules.length).toBeGreaterThan(0)
  })

  test(`${d}: skills/${d}/scripts/check.sh calls the domain gate`, () => {
    expect(readFileSync(join(ROOT, 'skills', d, 'scripts', 'check.sh'), 'utf8')).toMatch(new RegExp(`domain-gate\\.py[^\\n]*--domain ${d}\\b`))
  })
}

test('a constraint script added to a domain is reached with no edit to the gate', () => {
  const root = mkdtempSync(join(tmpdir(), 'dgate-')); trash.push(root)
  const plug = join(root, 'plug')
  mkdirSync(join(plug, 'skills', 'work', 'scripts'), { recursive: true }); mkdirSync(join(plug, 'hooks', 'jev'), { recursive: true })
  cpSync(GATE, join(plug, 'skills', 'work', 'scripts', 'domain-gate.py'))
  cpSync(join(ROOT, 'hooks', 'jev', 'rules.ts'), join(plug, 'hooks', 'jev', 'rules.ts'))
  cpSync(join(ROOT, 'constraints'), join(plug, 'constraints'), { recursive: true })
  writeFileSync(join(plug, 'constraints', 'dev-newcheck.py'), 'print("PASS: dev-newcheck")\n')
  const out = JSON.parse(spawnSync('python3', [join(plug, 'skills', 'work', 'scripts', 'domain-gate.py'), '--domain', 'dev', '--list'], { encoding: 'utf8', timeout: 60_000 }).stdout)
  expect(out.constraints).toEqual(['dev-newcheck.py'])
})

// ---- behaviour in a /work run (project mode) -------------------------------------------------------

function project(files: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), 'dgate-proj-')); trash.push(d)
  const git = (...a: string[]) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8', timeout: 60_000 })
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(d, 'README.md'), 'x'); git('add', '-A'); git('commit', '-qm', 'i')
  for (const [n, body] of Object.entries(files)) { mkdirSync(join(d, n, '..'), { recursive: true }); writeFileSync(join(d, n), body) }
  return d
}
const gate = (args: string[], env: Record<string, string> = {}) =>
  spawnSync('python3', [GATE, ...args], { encoding: 'utf8', timeout: 120_000, env: { ...process.env, DOMAIN_GATE_RULE_CHECK: STUB, ...env } })

test('project mode: the first line is the leg count, a dirty tree fails by name, a clean one passes', () => {
  const bad = gate(['--domain', 'ds', '--project-dir', project({ 'src/p.py': BAD }), '--skip-rules'])
  expect(bad.status).toBe(1)
  expect(bad.stdout.split('\n')[0]).toMatch(/^ds-gate: 10 check\(s\) examined/)
  for (const c of ['ds-join-audits.py', 'ds-error-handling.py', 'ds-schema-contracts.py']) expect(bad.stdout).toContain(c)
  const ok = gate(['--domain', 'ds', '--project-dir', project({ 'src/p.py': CLEAN }), '--skip-rules'])
  expect(ok.status).toBe(0)
})

test('project mode scopes to the changed files: an unchanged violation is not this change\'s', () => {
  const d = project({})
  writeFileSync(join(d, 'old.py'), BAD); spawnSync('git', ['-C', d, 'add', '-A'], { timeout: 60_000 }); spawnSync('git', ['-C', d, 'commit', '-qm', 'old'], { timeout: 60_000 })
  const r = gate(['--domain', 'ds', '--project-dir', d, '--skip-rules'])
  expect(r.status).toBe(0)
  expect(r.stdout).toContain('nothing in scope')
})

test('dev has no constraint script today: the gate says so and does not pass off nothing as something', () => {
  const r = gate(['--domain', 'dev', '--project-dir', project({ 'src/a.ts': 'export {}\n' }), '--skip-rules'])
  expect(r.status).toBe(0)
  expect(r.stdout).toMatch(/^dev-gate: 0 check\(s\) examined .*nothing in scope \(/)
})

test('a plan given to a ds gate runs ds-dq: a plan with no Data Outputs fails', () => {
  const d = project({ 'src/p.py': CLEAN })
  writeFileSync(join(d, 'plan.md'), '# Plan\n\nno outputs here\n')
  const r = gate(['--domain', 'ds', '--project-dir', d, '--plan', join(d, 'plan.md'), '--skip-rules'])
  expect(r.status).toBeGreaterThan(0)
  expect(r.stdout).toContain('ds-dq')
})

// ---- the Jev leg ---------------------------------------------------------------------------------------

function ruleStub(body: string) {
  const d = mkdtempSync(join(tmpdir(), 'dgate-stub-')); trash.push(d)
  const f = join(d, 'rc.sh'); writeFileSync(f, `#!/usr/bin/env bash\necho '${body}'\n`); chmodSync(f, 0o755)
  return f
}

test('rules are scored on the touched files unless the caller scores them as ruleChecks', () => {
  const d = project({ 'src/p.py': CLEAN })
  const hit = gate(['--domain', 'ds', '--project-dir', d], { DOMAIN_GATE_RULE_CHECK: ruleStub('{"verdicts":[{"rule":"M1","p":0.97,"verdict":"VIOLATED"}],"unavailable":[]}') })
  expect(hit.status).toBe(1)
  expect(hit.stdout).toContain('M1 p=0.97')
  const skipped = gate(['--domain', 'ds', '--project-dir', d, '--skip-rules'], { DOMAIN_GATE_RULE_CHECK: ruleStub('{"verdicts":[{"rule":"M1","p":0.97,"verdict":"VIOLATED"}],"unavailable":[]}') })
  expect(skipped.status).toBe(0)
  expect(skipped.stdout).toContain('scored by the plan')
})

test('a rule that cannot be judged, or a runner that prints nothing, is exit 2, never a pass', () => {
  const d = project({ 'src/p.py': CLEAN })
  const un = gate(['--domain', 'ds', '--project-dir', d], { DOMAIN_GATE_RULE_CHECK: ruleStub('{"verdicts":[],"unavailable":[{"rule":"A1","reason":"no credit"}]}') })
  expect(un.status).toBe(2)
  expect(un.stdout).toContain('A1 could not be judged')
  const mute = gate(['--domain', 'ds', '--project-dir', d], { DOMAIN_GATE_RULE_CHECK: ruleStub('not json') })
  expect(mute.status).toBe(2)
})

// ---- farm.sh: the row's "workflow" field --------------------------------------------------------------

test('farm.sh refuses a workflow that has no gate, at launch', () => {
  const root = mkdtempSync(join(tmpdir(), 'dgate-farm-')); trash.push(root)
  const tasks = join(root, 't.json'); writeFileSync(tasks, JSON.stringify([{ label: 'x', prompt: 'Do the thing.', workflow: 'writing' }]))
  const r = spawnSync('bash', [join(ROOT, 'skills', 'farm-out', 'scripts', 'farm.sh'), '--provider', 'claude', '--tasks', tasks, '--cwd', root], {
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, FARM_OUT_CHILD: '1', TMPDIR: root, FARM_OUTCOMES: join(root, 'o.jsonl') } })
  expect(r.status).toBe(2)
  expect(r.stderr).toContain('workflow must be "ds" or "dev"')
})
