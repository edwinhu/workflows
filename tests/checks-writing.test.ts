import { expect, setDefaultTimeout, test } from 'bun:test'
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from './helpers/tmp.ts'

setDefaultTimeout(360_000)
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

// T3 — writing (+ writing/legal, writing/econ) joins the layout: constraints and rules by register, inheritance, check.sh, prose-audit.
// Plan: groovy-strolling-octopus.md (Design + T3). Needs T1 (bin/workflow-check and the contract), nothing later.

const STRUCTURAL = ['writing-anchored-numbers', 'writing-topic-sentences', 'writing-outline-sync', 'writing-shortjournal'].map(n => `${n}.py`)
const AAP = ['scored-tics-patterns', 'wikipedia-chatgpt-artifacts', 'wikipedia-communication-patterns', 'wikipedia-promotional-language',
  'wikipedia-puffery-and-exaggeration', 'wikipedia-structural-patterns', 'wikipedia-template-artifacts'].map(n => `${n}.py`)
const TABLES = ['strunk-elements-of-style', 'volokh-distilled', 'mccloskey-economical-writing'].map(n => `${n}.py`)
const RULES = { 'checks/writing/rules': ['W-ATTRIB', 'W-HEDGE', 'W-SIGNPOST'], 'checks/writing/legal/rules': ['L-DIGEST', 'L-FNARG', 'L-ID', 'L-SUPRA'],
  'checks/writing/econ/rules': ['E-CAUSAL', 'E-CITEFORM', 'E-MAGNITUDE', 'E-WEFIND'] }

/** Every path under `rel` (recursive) ending in `name`. */
function find(rel: string, name: string, root = ROOT): string[] {
  const out: string[] = []
  const walk = (d: string) => { if (!existsSync(join(root, d))) return
    for (const e of readdirSync(join(root, d))) { const p = `${d}/${e}`; statSync(join(root, p)).isDirectory() ? walk(p) : e === name && out.push(p) } }
  walk(rel); return out
}

test('writing\'s constraints and rules live under checks/writing/ by register and the old locations hold none of them', () => {
  for (const f of [...STRUCTURAL, 'writing-no-bold-lead.py'])
    expect(existsSync(join(ROOT, 'checks', 'writing', 'constraints', f)), `checks/writing/constraints/${f}`).toBe(true)
  for (const f of [...AAP, ...TABLES]) expect(find('checks/writing', f).length, `${f} somewhere under checks/writing/`).toBe(1)
  for (const [dir, names] of Object.entries(RULES)) for (const n of names) expect(existsSync(join(ROOT, dir, `${n}.py`)), `${dir}/${n}.py`).toBe(true)
  expect(pyIn('skills/writing/constraints'), 'skills/writing/constraints must hold no .py').toEqual([])
  expect(pyIn('skills/ai-anti-patterns/constraints'), 'skills/ai-anti-patterns/constraints must hold no .py').toEqual([])
  for (const d of ['writing', 'legal', 'econ']) expect(pyIn(`constraints/jev/${d}`), `constraints/jev/${d} must hold no .py`).toEqual([])
})

test('writing, writing/legal and writing/econ resolve with inheritance, and --list is exactly the files on disk', () => {
  const lst = (wf: string) => { const r = wcheck([wf, '--list']); expect(r.status, `${wf}: ${r.stderr}`).toBe(0); return listed(r.stdout) }
  const w = lst('writing'), legal = lst('writing/legal'), econ = lst('writing/econ')
  expect(w).toEqual(onDisk(ROOT, 'writing'))
  expect(legal).toEqual(onDisk(ROOT, 'writing/legal'))
  expect(econ).toEqual(onDisk(ROOT, 'writing/econ'))
  expect(w.length).toBeGreaterThan(STRUCTURAL.length)
  const only = (a: string[], b: string[]) => a.filter(x => !b.includes(x))
  expect(only(w, legal), 'legal inherits every writing file').toEqual([])
  expect(only(w, econ), 'econ inherits every writing file').toEqual([])
  expect(only(legal, w).length, 'legal adds its own').toBeGreaterThan(0)
  expect(only(econ, w).length, 'econ adds its own').toBeGreaterThan(0)
  expect(only(legal, w).some(f => econ.includes(f)), 'a register does not leak into its sibling').toBe(false)
})

test('the four structural writing constraints honour the CLI contract and a topic-sentence violation fails with path:line', () => {
  const VIOLATING = 'Plain opening paragraph here.\n\nThe key finding is robust to every specification.\n'
  const p = project({ 'drafts/s.md': VIOLATING, 'LICENSE.txt': 'MIT\n' })
  for (const f of STRUCTURAL) {
    const script = join(ROOT, 'checks', 'writing', 'constraints', f)
    const r = sh('python3', [script, '--project-dir', p, '--files', join(p, 'drafts/s.md')])
    expect([0, 1], `${f}\n${r.stdout}${r.stderr}`).toContain(r.status)
    expect(first(r.stdout), f).toMatch(LEG)
    const empty = sh('python3', [script, '--project-dir', p, '--files', join(p, 'LICENSE.txt')])
    expect(empty.status, `${f}\n${empty.stdout}${empty.stderr}`).toBe(0)
    expect(first(empty.stdout), f).toMatch(EMPTY)
  }
  const topic = sh('python3', [join(ROOT, 'checks/writing/constraints/writing-topic-sentences.py'), '--project-dir', p, '--files', join(p, 'drafts/s.md')])
  expect(topic.status, topic.stdout + topic.stderr).toBe(1)
  expect(topic.stdout).toMatch(/s\.md:3: \S+ \S/)
})

test('workflow-check writing runs the structural constraints on a draft: a violation fails, a clean draft passes', () => {
  const bad = wcheck(['writing', '--project-dir', project({ 'drafts/s.md': 'Plain opening paragraph here.\n\nThe key finding is robust to every specification.\n' }), '--constraints-only', '--changed'])
  expect(bad.status, bad.stdout + bad.stderr).toBe(1)
  expect(first(bad.stdout)).toMatch(/^[\w-]+: [1-9]\d* \S.*examined/)
  expect(bad.stdout).toContain('s.md:3:')
  const ok = wcheck(['writing', '--project-dir', project({ 'drafts/s.md': 'Plain opening paragraph here.\n\nA second plain paragraph follows it.\n' }), '--constraints-only', '--changed'])
  expect(ok.status, ok.stdout + ok.stderr).toBe(0)
})

test('writing check.sh runs workflow-check for the plan\'s register: --style legal reaches writing and writing/legal, econ does not reach legal', () => {
  const dropped = plug({
    'checks/writing/constraints/zzw.py': FIRES('zzw'),
    'checks/writing/legal/constraints/zzl.py': FIRES('zzl'),
    'checks/writing/econ/constraints/zze.py': FIRES('zze'),
  })
  const check = (style: string) => {
    const p = project({ 'notes/x.md': 'A plain note.\n', 'refs.bib': '', 'plan.md': '# Plan\n' })
    return sh('bash', [join(ROOT, 'skills', 'writing', 'scripts', 'check.sh'), '--project', p, '--bib', join(p, 'refs.bib'), '--plan', join(p, 'plan.md'),
      '--plan-hash', 'h', '--style', style], { WORKFLOW_CHECKS_PATH: `${ROOT}:${dropped}` })
  }
  const legal = check('legal'); const out = legal.stdout + legal.stderr
  expect(legal.status, out).toBeGreaterThanOrEqual(1) // other legs of this thin fixture may exit 2; the marker's finding alone is exit 1
  expect(out).toContain('ZZW fired'); expect(out).toContain('ZZL fired'); expect(out).not.toContain('ZZE fired')
  const econ = check('econ'); const o2 = econ.stdout + econ.stderr
  expect(o2).toContain('ZZW fired'); expect(o2).toContain('ZZE fired'); expect(o2).not.toContain('ZZL fired')
})

test('prose-audit discovers a pattern table dropped into checks/writing/constraints with no edit to the script', () => {
  // A private copy of the tree prose-audit reads, so the checkout itself is never written to.
  const tree = mkTmp('wfc-audit-')
  for (const d of ['scripts', 'checks', 'skills/ai-anti-patterns', 'skills/de-ai-revise', 'skills/writing'])
    if (existsSync(join(ROOT, d))) cpSync(join(ROOT, d), join(tree, d), { recursive: true, filter: s => !/__pycache__|node_modules|\.pixi/.test(s) })
  const table = 'PAT = [(r"\\bzorbulat\\w+", "zz-label")]\n_HARD_VIOLATIONS = PAT\n_SOFT_VIOLATIONS = PAT\nPATTERNS = PAT\n_PATTERNS = PAT\n'
  put(tree, { 'checks/writing/constraints/zz-table.py': table, 'draft.md': 'We zorbulate the sample before we estimate anything.\n' })
  const r = sh('uv', ['run', '--with', 'lxml,pyyaml', 'python3', join(tree, 'scripts', 'prose-audit.py'), '--json', join(tree, 'draft.md')], { WORKFLOW_CHECKS_PATH: tree })
  expect([0, 1], r.stdout + r.stderr).toContain(r.status)
  expect(r.stdout).toContain('zz-label')
})

test('skills/writing/SKILL.md\'s example dispatch names the workflow (no <register rules> placeholder) and the rules docs cite the new paths', () => {
  const lines = read('skills/writing/SKILL.md').split('\n').filter(l => /ruleChecks/.test(l))
  expect(lines.length).toBeGreaterThan(0)
  for (const l of lines) {
    expect(l).toMatch(/--workflow\s+writing\b|workflow-check\s+writing\b/)
    expect(l).not.toContain('<register rules>')
    expect(l).not.toContain('constraints/jev')
  }
  for (const f of readdirSync(join(ROOT, 'skills/writing/rules')).filter(f => f.endsWith('.md')))
    expect(read(`skills/writing/rules/${f}`), f).not.toMatch(/skills\/writing\/constraints\/|skills\/ai-anti-patterns\/constraints\/|constraints\/jev\/(writing|legal|econ)\b/)
})
