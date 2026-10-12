import { expect, setDefaultTimeout, test } from 'bun:test'
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from './helpers/tmp.ts'
import * as PcProbe from '../skills/plugin-creator/scripts/pc-probe.ts'

setDefaultTimeout(120_000)
const mkTmp = useTmp()

const ROOT = join(import.meta.dir, '..')
const RUNNER = join(ROOT, 'bin', 'workflow-check')
const probe: any = PcProbe

const LEG = /^[\w.-]+: \d+ \S.*examined/
const EMPTY = /^[\w.-]+: 0 \S.*examined.*nothing in scope \([^)]+\)/

// A missing binary is a null status and no output, never a throw: the assertions on them are what fail.
const sh = (cmd: string, args: string[], env: Record<string, string> = {}, cwd?: string) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 100_000, cwd, env: { ...process.env, ...env } })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error?.message ?? '') }
}
const out = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr
const first = (o: string) => o.split('\n')[0]
const wcheck = (args: string[]) => sh(RUNNER, args, { WORKFLOW_CHECKS_PATH: ROOT })
const listed = (o: string) => [...new Set([...o.matchAll(/(?<![\w-])checks\/[\w./-]+\.py/g)].map(m => m[0]))].sort()
/** The runnable files of a workflow on disk, parents included, computed from the filesystem. */
function onDisk(wf: string): string[] {
  const parts = wf.split('/')
  const res: string[] = []
  for (let i = 1; i <= parts.length; i++) for (const kind of ['constraints', 'rules']) {
    const rel = `checks/${parts.slice(0, i).join('/')}/${kind}`
    if (!existsSync(join(ROOT, rel))) continue
    for (const f of readdirSync(join(ROOT, rel))) if (/^[^_.].*\.py$/.test(f) && statSync(join(ROOT, rel, f)).isFile()) res.push(`${rel}/${f}`)
  }
  return res.sort()
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
/** Lines of `<rel>:<n>: …` findings whose text matches `rx`, as line numbers. */
const findingLines = (o: string, rel: string, rx: RegExp) =>
  [...o.matchAll(new RegExp(`^${rel.replace(/[./]/g, '\\$&')}:(\\d+): (.*)$`, 'gm'))].filter(m => rx.test(m[2])).map(m => Number(m[1]))

// R5 — writing's style leg becomes members (writing-style, and register-crossing for writing/legal and writing/econ), workshop-deck's CON
// row stops calling typst's workshop runner and resolves the overflow driver through typst-plugin-root, hooks/overflow-check.ts is deleted,
// and pc-probe's membership is only the checks/<wf>/ layout directory. Assumes nothing earlier. Plan: groovy-strolling-octopus.md (Design + R5).
const STYLE = 'checks/writing/constraints/writing-style.py'
const CROSSING = ['legal', 'econ'].map(r => `checks/writing/${r}/constraints/register-crossing.py`)

test('writing-style is listed for writing and its registers, register-crossing for writing/legal and writing/econ, and each --list is exactly the files on disk', () => {
  for (const f of [STYLE, ...CROSSING]) expect(existsSync(join(ROOT, f)), f).toBe(true)
  const lst = (wf: string) => { const r = wcheck([wf, '--list']); expect(r.status, `${wf}: ${r.stderr}`).toBe(0); return listed(r.stdout) }
  const w = lst('writing'), legal = lst('writing/legal'), econ = lst('writing/econ')
  expect(w).toEqual(onDisk('writing'))
  expect(legal).toEqual(onDisk('writing/legal'))
  expect(econ).toEqual(onDisk('writing/econ'))
  expect(w).toContain(STYLE)
  expect(legal).toContain(STYLE); expect(legal).toContain(CROSSING[0]); expect(legal).not.toContain(CROSSING[1])
  expect(econ).toContain(STYLE); expect(econ).toContain(CROSSING[1]); expect(econ).not.toContain(CROSSING[0])
})

test('writing-style and register-crossing honour the CLI contract: an explicit empty scope for a non-draft, a count line over a draft', () => {
  const p = project({ 'drafts/s.md': 'A plain draft sentence.\n', 'LICENSE.txt': 'MIT\n' })
  for (const f of [STYLE, ...CROSSING]) {
    expect(existsSync(join(ROOT, f)), f).toBe(true)
    const real = sh('python3', [join(ROOT, f), '--project-dir', p, '--files', join(p, 'drafts/s.md')])
    expect(real.status, `${f}\n${out(real)}`).toBe(0)
    expect(first(real.stdout), f).toMatch(/^[\w.-]+: [1-9]\d* \S.*examined/)
    const empty = sh('python3', [join(ROOT, f), '--project-dir', p, '--files', join(p, 'LICENSE.txt')])
    expect(empty.status, `${f}\n${out(empty)}`).toBe(0)
    expect(first(empty.stdout), f).toMatch(EMPTY)
  }
})

test('writing-style flags Ship diction and ALL-CAPS emphasis at their lines and passes a clean draft', () => {
  const p = project({ 'drafts/bad.md': 'We utilize the sample.\nThis is NOT the rule.\n', 'drafts/ok.md': 'We use the sample.\nThis is not the rule.\n' })
  expect(existsSync(join(ROOT, STYLE)), STYLE).toBe(true)
  const bad = sh('python3', [join(ROOT, STYLE), '--project-dir', p, '--files', join(p, 'drafts/bad.md')])
  expect(bad.status, out(bad)).toBe(1)
  expect(findingLines(bad.stdout, 'drafts/bad.md', /utili[sz]e/i)).toEqual([1])
  expect(findingLines(bad.stdout, 'drafts/bad.md', /\bNOT\b/)).toEqual([2])
  const ok = sh('python3', [join(ROOT, STYLE), '--project-dir', p, '--files', join(p, 'drafts/ok.md')])
  expect(ok.status, out(ok)).toBe(0)
})

test('the register is derived from the workflow level: writing/legal flags `This paper`, writing/econ flags `This Article`, through workflow-check', () => {
  const draft = 'This Article argues the point.\nThis paper argues the point.\n'
  const check = (wf: string) => {
    const p = project({ 'drafts/x.md': draft })
    const r = wcheck([wf, '--constraints-only', '--project-dir', p, '--files', join(p, 'drafts/x.md')])
    expect(first(r.stdout), `${wf}\n${out(r)}`).toMatch(/^[\w-]+: [1-9]\d* \S.*examined/)
    return findingLines(r.stdout, 'drafts/x.md', /This (Article|paper)/)
  }
  expect(check('writing/legal'), 'legal: only the `This paper` line').toEqual([2])
  expect(check('writing/econ'), 'econ: only the `This Article` line').toEqual([1])
  const sect = project({ 'drafts/y.md': 'As argued in Section 2 above, the rule applies.\n' })
  const legal = wcheck(['writing/legal', '--constraints-only', '--project-dir', sect, '--files', join(sect, 'drafts/y.md')])
  expect(findingLines(legal.stdout, 'drafts/y.md', /by Part/)).toEqual([1])
  const plain = wcheck(['writing', '--constraints-only', '--project-dir', sect, '--files', join(sect, 'drafts/y.md')])
  expect(findingLines(plain.stdout, 'drafts/y.md', /by Part/), 'a cross-reference by section is no crossing in the general register').toEqual([])
})

test('the writing gate has no style leg: the style rules run through workflow-check, and every other leg still reports', () => {
  const p = project({ 'drafts/x.md': 'A plain note.\n', 'refs.bib': '', 'plan.md': '# Plan\n' })
  const r = sh('bash', [join(ROOT, 'skills', 'writing', 'scripts', 'check.sh'), '--project', p, '--bib', join(p, 'refs.bib'), '--plan', join(p, 'plan.md'),
    '--plan-hash', 'h', '--style', 'legal'], { WORKFLOW_CHECKS_PATH: ROOT, TMPDIR: mkTmp('wfc-tmpdir-') })
  const legs = [...out(r).matchAll(/^leg (\S+) exit=/gm)].map(m => m[1])
  expect(legs.length, out(r).slice(0, 400)).toBeGreaterThan(0)
  expect(legs, 'style is a member now').not.toContain('style')
  for (const keep of ['grammar', 'prose', 'writing-legal-gate']) expect(legs, keep).toContain(keep)
  const script = readFileSync(join(ROOT, 'skills', 'writing', 'scripts', 'check.sh'), 'utf8')
  // computed: every script the gate runs by path still exists
  const named = [...script.matchAll(/"\$HERE\/([\w.-]+\.py)"/g)].map(m => m[1])
  expect(named.length).toBeGreaterThan(0)
  expect(named.filter(f => !existsSync(join(ROOT, 'skills', 'writing', 'scripts', f))), 'check.sh runs a script that is not there').toEqual([])
  expect(existsSync(join(ROOT, 'skills', 'writing', 'scripts', 'writing_style_check.py')), 'the style engine moved into the members').toBe(false)
})

test('workshop-deck settles CON without calling a typst runner, and finds the overflow driver through typst-plugin-root', () => {
  const d = mkTmp('wfc-wdeck-')
  cpSync(join(ROOT, 'skills', 'workshop', 'fixtures', 'clean'), join(d, 'proj'), { recursive: true })
  put(d, {
    'runner.py': `import sys, pathlib\npathlib.Path(${JSON.stringify(join(d, 'ran-runner'))}).write_text(" ".join(sys.argv))\nprint("{}")\n`,
    'typstroot/scripts/check-overflow.sh': `#!/bin/sh\necho "$@" > ${join(d, 'ran-driver')}\nexit 0\n`,
    'typstroot/scripts/validation.typ': '',
    'bin/typst-plugin-root': `#!/bin/sh\necho ${join(d, 'typstroot')}\n`,
  })
  chmodSync(join(d, 'typstroot/scripts/check-overflow.sh'), 0o755); chmodSync(join(d, 'bin/typst-plugin-root'), 0o755)
  const r = sh('uv', ['run', '--quiet', '--with', 'pypdf', 'python3', join(ROOT, 'checks', 'workshop', 'constraints', 'workshop-deck.py'),
    '--plan', join(d, 'proj/plan.md'), '--project-dir', join(d, 'proj')],
  { WORKSHOP_CONSTRAINT_RUNNER: join(d, 'runner.py'), WORKSHOP_OVERFLOW_DRIVER: '', PATH: `${join(d, 'bin')}:${process.env.PATH}`, TMPDIR: mkTmp('wfc-tmpdir-') })
  expect(first(r.stdout), out(r)).toMatch(/^workshop-deck: 13 deck check\(s\) examined/)
  expect(existsSync(join(d, 'ran-runner')), 'workshop-deck called a typst runner').toBe(false)
  const con = r.stdout.match(/^\[CON\] (\S+) \| (.*)$/m)
  expect(con, 'a CON line is still emitted').not.toBeNull()
  expect(con![1], con![0]).not.toBe('FAIL')
  expect(con![2], 'CON says what settles it').toMatch(/workshop constraints/i)
  expect(existsSync(join(d, 'ran-driver')), 'OVR ran the driver typst-plugin-root names').toBe(true)
})

test('hooks/overflow-check.ts is gone, and every script hooks.json runs exists', () => {
  expect(existsSync(join(ROOT, 'hooks', 'overflow-check.ts')), 'hooks/overflow-check.ts').toBe(false)
  const text = readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')
  expect(text.includes('overflow-check'), 'hooks.json still registers it').toBe(false)
  const cmds = [...text.matchAll(/"command":\s*"([^"]+)"/g)].map(m => m[1])
  const paths = cmds.flatMap(c => [...c.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)].map(m => m[1]))
  expect(paths.length).toBeGreaterThan(5)
  expect(paths.filter(p => !existsSync(join(ROOT, p))), 'a hook command names a file that is not there').toEqual([])
})

test('pc-probe: an APPLIES_TO declaration is not a checker contract, and a discovery runner no longer registers a module', () => {
  expect(probe.hasModuleContract('CONSTRAINT = "x"\nAPPLIES_TO = ["slides"]\n'), 'CONSTRAINT + APPLIES_TO alone').toBe(false)
  expect(probe.hasModuleContract('CONSTRAINT = "x"\nSEVERITY = "hard"\n'), 'CONSTRAINT + SEVERITY is the contract').toBe(true)
  expect(probe.hasCheckerContract('APPLIES_TO = ["slides"]\n'), 'APPLIES_TO alone').toBe(false)
  expect(probe.hasCheckerContract('def check(context):\n    return []\n'), 'a one-parameter check() is still a checker').toBe(true)

  const dir = (files: Record<string, string>) => {
    const d = mkTmp('pc-probe-resid-')
    put(d, { 'plugin.json': JSON.stringify({ name: 'fx', version: '0.0.1', description: 'fixture' }), ...files })
    return d
  }
  const module = ['"""A fixture checker."""', 'CONSTRAINT = "zz"', 'APPLIES_TO = ["slides"]', 'SEVERITY = "hard"', '', 'def check(context):', '    return []', ''].join('\n')
  const runner = ['from pathlib import Path', 'def run(root):', '    for py in sorted(Path(root).glob("*/references/*.py")):', '        mod = load(py)',
    '        if getattr(mod, "APPLIES_TO", None) and getattr(mod, "SEVERITY", None):', '            mod.check({})', ''].join('\n')
  const hook = JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'python3 ${CLAUDE_PLUGIN_ROOT}/constraints/run-constraints.py' }] }] } })
  const files = (modulePath: string) => ({
    'skills/writing/SKILL.md': '---\nname: writing\ndescription: fixture\n---\n\n# writing\n',
    'constraints/run-constraints.py': runner, 'hooks/hooks.json': hook, [modulePath]: module,
  })
  const flagged = (modulePath: string) => (probe.runProbe(dir(files(modulePath))).findings as any[]).filter(f => String(f.file).endsWith(modulePath))
  // reached only because a runner that reads APPLIES_TO globs near it: no longer membership
  expect(flagged('constraints/zz.py').length, 'a runner-reached module is stray').toBeGreaterThan(0)
  // the layout directory is the membership
  expect(flagged('checks/zz/constraints/zz.py')).toEqual([])
})
