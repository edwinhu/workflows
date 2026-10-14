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

// T4 — workshop, elide and authoring join the layout. Plan: groovy-strolling-octopus.md (Design + T4). Needs T1, nothing later.

const TYPST_RULES = ['T-CALLOUT', 'T-HOLLOW', 'T-STORY', 'T-TAKEAWAY', 'T-TRANSITION']
const ELIDE_RULES = ['EL-EMPH', 'EL-GAP', 'EL-HOLDING', 'EL-NOTE', 'EL-VOICE']
const AUTHORING_RULES = ['A-DESC', 'A-FLAG', 'A-GATE', 'A-PAD', 'A-SOFT', 'A-STATE']
const ELIDE_CHECKS = ['check-quotes', 'check-addendum', 'check-marks', 'check-stranded-headings', 'check-source-identity'].map(n => `${n}.py`)
const T4_SKILLS = ['workshop', 'elide-case', 'workflow-creator', 'skill-creator', 'plugin-creator']

test('workshop, elide and authoring rules and elide\'s checkers live under checks/<workflow>/ and the old locations hold none of them', () => {
  const moved: [string, string[]][] = [['workshop', TYPST_RULES], ['elide', ELIDE_RULES], ['authoring', AUTHORING_RULES]]
  for (const [wf, names] of moved) for (const n of names) expect(existsSync(join(ROOT, 'checks', wf, 'rules', `${n}.py`)), `checks/${wf}/rules/${n}.py`).toBe(true)
  for (const d of ['typst', 'elide', 'authoring']) expect(pyIn(`constraints/jev/${d}`), `constraints/jev/${d} must hold no .py`).toEqual([])
  for (const f of ELIDE_CHECKS) {
    expect(existsSync(join(ROOT, 'checks', 'elide', 'constraints', f)), `checks/elide/constraints/${f}`).toBe(true)
    expect(existsSync(join(ROOT, 'skills', 'elide-case', 'scripts', f)), `skills/elide-case/scripts/${f} must be gone`).toBe(false)
  }
  expect(existsSync(join(ROOT, 'checks', 'workshop', 'constraints', 'workshop-deck.py')), 'the deck check is a workshop constraint').toBe(true)
  expect(existsSync(join(ROOT, 'skills', 'workshop', 'scripts', 'workshop-deck.py')), 'skills/workshop/scripts/workshop-deck.py must be gone').toBe(false)
})

test('workflow-check resolves workshop, elide and authoring and each --list is exactly the files on disk', () => {
  for (const wf of ['workshop', 'elide', 'authoring']) {
    const r = wcheck([wf, '--list'])
    expect(r.status, `${wf}: ${r.stderr}`).toBe(0)
    const disk = onDisk(ROOT, wf)
    expect(disk.length, `${wf} has runnable files`).toBeGreaterThan(0)
    expect(listed(r.stdout), wf).toEqual(disk)
  }
}, 300_000)

test('the elide checkers honour the CLI contract: nothing relevant is an explicit empty scope, an addendum is counted', () => {
  const p = project({ 'LICENSE.txt': 'MIT\n', 'addenda/01-case.typ': '= A case\n\nSome text.\n' })
  for (const f of ELIDE_CHECKS) {
    const script = join(ROOT, 'checks', 'elide', 'constraints', f)
    const empty = sh('python3', [script, '--project-dir', p, '--files', join(p, 'LICENSE.txt')])
    expect(empty.status, `${f}\n${empty.stdout}${empty.stderr}`).toBe(0)
    expect(first(empty.stdout), f).toMatch(EMPTY)
    const real = sh('python3', [script, '--project-dir', p, '--files', join(p, 'addenda/01-case.typ')])
    expect([0, 1, 2], f).toContain(real.status)
    expect(first(real.stdout), `${f}\n${real.stdout}${real.stderr}`).toMatch(LEG)
  }
}, 870_000)

test('workshop check.sh honours --project-dir: the constraints it runs receive the project, whatever the cwd', () => {
  const dropped = plug({ 'checks/workshop/constraints/zzws.py': 'import sys\nprint("zzws: 1 file(s) examined")\nprint("slides.typ:1: ZZWS fired " + " ".join(sys.argv[1:]))\nsys.exit(1)\n' })
  const p = project({ 'slides.typ': '= A deck\n', 'plan.md': '# Plan\n' })
  const elsewhere = mkTmp('wfc-cwd-')
  // check.sh's probe-tests leg runs pytest, whose tmp_path root is $TMPDIR/pytest-of-<user>: a swept TMPDIR keeps it out of the caller's.
  const r = sh('bash', [join(ROOT, 'skills', 'workshop', 'scripts', 'check.sh'), '--plan', join(p, 'plan.md'), '--project-dir', p],
    { WORKFLOW_CHECKS_PATH: `${ROOT}:${dropped}`, TMPDIR: mkTmp('wfc-tmpdir-') }, elsewhere)
  const out = r.stdout + r.stderr
  expect(r.status, out).toBeGreaterThanOrEqual(1)
  expect(out).toContain('ZZWS fired')
  expect(out).toContain(`--project-dir ${p}`)
}, 160_000)

test('elide and workflow-creator check.sh reach workflow-check for their workflow', () => {
  expect(read('skills/elide-case/scripts/check.sh')).toMatch(/workflow-check[^\n]*\belide\b[^\n]*--constraints-only/)
  expect(read('skills/workflow-creator/scripts/check.sh')).toMatch(/workflow-check[^\n]*\bauthoring\b[^\n]*--constraints-only/)
  expect(read('skills/workshop/scripts/check.sh')).toMatch(/workflow-check[^\n]*\bworkshop\b[^\n]*--constraints-only/)
})

test('no absolute /home/eh/projects/workflows path remains in the skills this task owns', () => {
  const bad: string[] = []
  const walk = (d: string) => { for (const e of readdirSync(join(ROOT, d))) {
    const p = `${d}/${e}`
    if (/node_modules|__pycache__|\.pixi/.test(e)) continue
    if (statSync(join(ROOT, p)).isDirectory()) { walk(p); continue }
    if (/\.(png|pdf|jpg|jpeg|gif|pyc|docx|xlsx|zip|ttf|otf|woff2?)$/i.test(e) || /\.test\.(ts|mjs)$/.test(e)) continue
    if (/\/home\/eh\/projects\/workflows(?![-\w])/.test(read(p))) bad.push(p)
  } }
  for (const s of T4_SKILLS) walk(`skills/${s}`)
  expect(bad).toEqual([])
})

test('the example dispatches of the skills this task owns name their workflow instead of a rules directory', () => {
  const want: Record<string, RegExp> = { workshop: /--workflow\s+workshop\b|workflow-check\s+workshop\b/, 'elide-case': /--workflow\s+elide\b|workflow-check\s+elide\b/,
    'workflow-creator': /--workflow\s+authoring\b|workflow-check\s+authoring\b/, 'skill-creator': /--workflow\s+authoring\b|workflow-check\s+authoring\b/,
    'plugin-creator': /--workflow\s+authoring\b|workflow-check\s+authoring\b/ }
  for (const [skill, re] of Object.entries(want)) {
    const lines = read(`skills/${skill}/SKILL.md`).split('\n').filter(l => /rule-check\.ts|ruleChecks|workflow-check/.test(l))
    expect(lines.length, skill).toBeGreaterThan(0)
    expect(lines.some(l => re.test(l)), `${skill}: a dispatch line names its workflow`).toBe(true)
    for (const l of lines) expect(l, `${skill}: no rules directory`).not.toContain('constraints/jev')
  }
})
