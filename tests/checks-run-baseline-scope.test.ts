import { expect, setDefaultTimeout, test } from 'bun:test'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from './helpers/tmp.ts'

// Every check that scopes "this run's changes" honors WORK_RUN_BASELINE (the dispatch-time tree snapshot): uncommitted
// work already there when the run began is the user's, not the run's. Without it the scope is HEAD, as before.
setDefaultTimeout(150_000)
const mkTmp = useTmp()
const ROOT = join(import.meta.dir, '..')
const SNAPSHOT = join(ROOT, 'skills', 'work', 'scripts', 'tree-snapshot.sh')

const sh = (cmd: string, args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20_000, env: { ...process.env, WORKFLOW_CHECKS_PATH: ROOT, ...env } })
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

/** A repo with `committed`, then `wip` left uncommitted, a baseline snapshot of that, and the tree sha. */
function fixture(committed: Record<string, string>, wip: Record<string, string>) {
  const d = mkTmp('bscope-')
  const git = (...a: string[]) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8', timeout: 30_000 })
  const put = (m: Record<string, string>) => {
    for (const [n, b] of Object.entries(m)) { mkdirSync(dirname(join(d, n)), { recursive: true }); writeFileSync(join(d, n), b) }
  }
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  put({ 'README.md': 'x', ...committed }); git('add', '-A'); git('commit', '-qm', 'i')
  put(wip)
  const base = spawnSync('bash', [SNAPSHOT, d], { encoding: 'utf8', timeout: 20_000 }).stdout.trim()
  expect(base).toMatch(/^[0-9a-f]{40,64}$/)
  return { d, base }
}

const SCAN = join(ROOT, 'checks', 'dev', 'constraints', 'diff-scan.py')
const scan = (d: string, f: string, env: Record<string, string> = {}) => sh('python3', [SCAN, '--project-dir', d, '--files', join(d, f)], env)

test('diff-scan ignores a WIP violation the baseline already holds, and judges the run edit after it', () => {
  const { d, base } = fixture({ 'a.test.ts': "it('a', () => {})\n" }, { 'a.test.ts': "it('a', () => {})\ndescribe.skip('wip', () => {})\n" })
  appendFileSync(join(d, 'a.test.ts'), "it('run', () => {})\n")
  const w = scan(d, 'a.test.ts', { WORK_RUN_BASELINE: base })
  expect(w.out).not.toContain('focused-or-skipped-test')
  expect(w.status).toBe(0)
  expect(w.out).toMatch(/1 added line/)
  const bare = scan(d, 'a.test.ts')
  expect(bare.status).toBe(1)
  expect(bare.out).toContain('focused-or-skipped-test')
  // a violating RUN edit is still caught under the baseline
  appendFileSync(join(d, 'a.test.ts'), "it.only('run2', () => {})\n")
  const bad = scan(d, 'a.test.ts', { WORK_RUN_BASELINE: base })
  expect(bad.status).toBe(1)
  expect(bad.out).toContain('a.test.ts:4:')
})

test('diff-scan under a baseline reads an untracked file the run created whole, and one that predates it not at all', () => {
  const { d, base } = fixture({}, { 'old.test.ts': "describe.skip('wip', () => {})\n" })
  writeFileSync(join(d, 'new.test.ts'), "describe.skip('run', () => {})\n")
  expect(scan(d, 'old.test.ts', { WORK_RUN_BASELINE: base }).status).toBe(0)
  expect(scan(d, 'new.test.ts', { WORK_RUN_BASELINE: base }).status).toBe(1)
})

test('workflow-check --constraints-only scopes its files by the baseline', () => {
  const { d, base } = fixture({}, { 'wip.test.ts': "describe.skip('wip', () => {})\n" })
  writeFileSync(join(d, 'run.ts'), 'export const x = 1\n')
  const args = ['dev', '--project-dir', d, '--constraints-only']
  const w = sh(join(ROOT, 'bin', 'workflow-check'), args, { WORK_RUN_BASELINE: base })
  expect(w.out).not.toContain('focused-or-skipped-test')
  expect(w.status).toBe(0)
  const bare = sh(join(ROOT, 'bin', 'workflow-check'), args)
  expect(bare.status).toBe(1)
  expect(bare.out).toContain('focused-or-skipped-test')
  // --since is the same baseline spelled as a flag
  expect(sh(join(ROOT, 'bin', 'workflow-check'), [...args, '--since', base]).status).toBe(0)
})

const DECK = join(ROOT, 'checks', 'workshop', 'constraints', 'workshop-deck.py')
const nar = (d: string, env: Record<string, string> = {}) => {
  const code = `import importlib.util as u,sys,pathlib\ns=u.spec_from_file_location('wd',${JSON.stringify(DECK)});m=u.module_from_spec(s);s.loader.exec_module(m)\nr=m.check_nar(pathlib.Path(${JSON.stringify(join(d, 'notes.typ'))}),pathlib.Path(${JSON.stringify(d)}))\nprint('STATUS',r['status']);print(r.get('detail',''))`
  return sh('python3', ['-c', code], env)
}

test('workshop-deck NAR ignores a narrating notes bullet the baseline already holds', () => {
  const ok = '- Revenue fell by a third after the rule.\n'
  const { d, base } = fixture({ 'notes.typ': ok }, { 'notes.typ': ok + '- As you can see, revenue fell.\n' })
  appendFileSync(join(d, 'notes.typ'), '- The estimate is robust to the placebo.\n')
  const w = nar(d, { WORK_RUN_BASELINE: base })
  expect(w.out).toContain('STATUS PASS')
  expect(nar(d).out).toContain('STATUS FAIL')
  appendFileSync(join(d, 'notes.typ'), '- As you can see, the run narrates.\n')
  expect(nar(d, { WORK_RUN_BASELINE: base }).out).toContain('STATUS FAIL')
})
