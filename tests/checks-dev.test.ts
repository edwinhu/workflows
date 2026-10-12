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

// T2 — dev joins the layout: its Jev rules and diff-scan live under checks/dev/, one runner reaches them, check.sh calls it.
// Plan: groovy-strolling-octopus.md (Design + T2). Needs T1 (bin/workflow-check and the contract), nothing later.

const DEV_RULES = ['LOOP', 'MOCK', 'NET', 'SHELL', 'WEAK'].map(n => `${n}.py`)

test('dev rules and diff-scan live under checks/dev/ and the old locations hold none of them', () => {
  for (const f of DEV_RULES) expect(existsSync(join(ROOT, 'checks', 'dev', 'rules', f)), `checks/dev/rules/${f}`).toBe(true)
  expect(existsSync(join(ROOT, 'checks', 'dev', 'rules', '_dev.py')), 'the rules\' helper moves with them').toBe(true)
  expect(existsSync(join(ROOT, 'checks', 'dev', 'constraints', 'diff-scan.py')), 'checks/dev/constraints/diff-scan.py').toBe(true)
  expect(existsSync(join(ROOT, 'skills', 'dev', 'scripts', 'diff-scan.py')), 'skills/dev/scripts/diff-scan.py must be gone').toBe(false)
  expect(pyIn('constraints/jev/dev'), 'constraints/jev/dev must hold no .py').toEqual([])
})

test('workflow-check dev --list is exactly the runnable files on disk', () => {
  const r = wcheck(['dev', '--list'])
  expect(r.status, r.stderr).toBe(0)
  const disk = onDisk(ROOT, 'dev')
  expect(disk.length).toBeGreaterThanOrEqual(DEV_RULES.length + 1)
  expect(listed(r.stdout)).toEqual(disk)
})

test('diff-scan honours the CLI contract: leg count first, path:line finding on an added test.only, empty scope when nothing was added', () => {
  const scan = join(ROOT, 'checks', 'dev', 'constraints', 'diff-scan.py')
  const p = project({ 'src/a.test.ts': "test.only('x', () => {})\n", 'src/b.ts': 'export const b = 1\n' })
  const bad = sh('python3', [scan, '--project-dir', p, '--files', join(p, 'src/a.test.ts')])
  expect(bad.status, bad.stdout + bad.stderr).toBe(1)
  expect(first(bad.stdout)).toMatch(LEG)
  expect(bad.stdout).toMatch(FINDING)
  expect(bad.stdout).toContain('focused-or-skipped-test')
  const ok = sh('python3', [scan, '--project-dir', p, '--files', join(p, 'src/b.ts')])
  expect(ok.status, ok.stdout + ok.stderr).toBe(0)
  expect(first(ok.stdout)).toMatch(/: [1-9]\d* \S.*examined/)
  const none = sh('python3', [scan, '--project-dir', p, '--files', join(p, 'README.md')])
  expect(none.status, none.stdout + none.stderr).toBe(0)
  expect(first(none.stdout)).toMatch(EMPTY)
})

test('workflow-check dev runs diff-scan on the change: a focused test fails by name, a clean change passes', () => {
  const bad = wcheck(['dev', '--project-dir', project({ 'src/a.test.ts': "it.only('x', () => {})\n" }), '--constraints-only', '--changed'])
  expect(bad.status, bad.stdout + bad.stderr).toBe(1)
  expect(first(bad.stdout)).toMatch(/^[\w-]+: [1-9]\d* \S.*examined/)
  expect(bad.stdout).toContain('focused-or-skipped-test')
  const ok = wcheck(['dev', '--project-dir', project({ 'src/b.ts': 'export const b = 1\n' }), '--constraints-only', '--changed'])
  expect(ok.status, ok.stdout + ok.stderr).toBe(0)
})

test('workflow-check dev --rules-only scores the dev rules: a VIOLATED verdict is exit 1 and is named', () => {
  const p = project({ 'src/a.ts': 'export const a = 1\n' })
  const hit = wcheck(['dev', '--project-dir', p, '--rules-only', '--changed'], {
    DOMAIN_GATE_RULE_CHECK: stub('{"verdicts":[{"rule":"MOCK","p":0.93,"verdict":"VIOLATED","spans":["src/a.ts:1"]}],"unavailable":[]}') })
  expect(hit.status, hit.stdout + hit.stderr).toBe(1)
  expect(hit.stdout).toContain('MOCK p=0.93')
})

test('dev check.sh reaches workflow-check dev: a constraint dropped into the layout fails the gate with no edit to check.sh', () => {
  const dropped = plug({ 'checks/dev/constraints/zzdev.py': FIRES('zzdev') })
  const p = project({ 'src/a.ts': 'export const a = 1\n' })
  const r = sh('bash', [join(ROOT, 'skills', 'dev', 'scripts', 'check.sh'), '--project-dir', p, '--lint-cmd', 'echo lint-ok'], { WORKFLOW_CHECKS_PATH: dropped })
  expect(r.status, r.stdout + r.stderr).toBe(1)
  expect(r.stdout + r.stderr).toContain('ZZDEV fired')
  expect(read('skills/dev/scripts/check.sh')).toMatch(/workflow-check[^\n]*\bdev\b[^\n]*--constraints-only/)
  expect(read('skills/dev/scripts/check.sh')).not.toContain('domain-gate.py')
})

test('skills/dev/SKILL.md\'s example dispatch names the workflow instead of a rules directory', () => {
  const lines = read('skills/dev/SKILL.md').split('\n').filter(l => /ruleChecks/.test(l))
  expect(lines.length).toBeGreaterThan(0)
  for (const l of lines) {
    expect(l).toMatch(/--workflow\s+dev\b|workflow-check\s+dev\b/)
    expect(l).not.toContain('constraints/jev')
  }
})
