#!/usr/bin/env bun
/**
 * readonly-guard.test.ts — a readOnly run that changed its project tree FAILS in work-result.sh.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/readonly-guard.test.ts
 *
 * The baseline is what work-dispatch.sh records (tree-snapshot.sh --objects <run>/readonly-objects, in
 * args.readOnlyBaseline); a stub "run" is whatever the test does to the tree between that and the verdict.
 */
import { afterAll, describe, expect, test, setDefaultTimeout } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

setDefaultTimeout(120_000)

const SNAP = join(import.meta.dir, 'tree-snapshot.sh')
const RESULT = join(import.meta.dir, 'work-result.sh')
const GUARD = join(import.meta.dir, 'readonly-guard.sh')

const scratch: string[] = []
afterAll(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }) })

const git = (d: string, ...a: string[]) =>
  execFileSync('git', ['-C', d, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8', timeout: 60_000 })

const PASS = {
  overallPass: true, verdict: 'PASS', scoreTable: {}, findings: [], tasksThatFlagged: [],
  mechanicalThatFailed: [], lensesThatFlagged: [], rulesThatFailed: [],
}

/** A git project plus a run dir (outside it) holding args.json with the dispatch-time baseline. */
function fixture(opts: { readOnly?: boolean; baseline?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ro-guard-'))
  scratch.push(root)
  const proj = join(root, 'proj'), run = join(root, 'run')
  mkdirSync(proj); mkdirSync(run)
  writeFileSync(join(proj, 'a.txt'), 'a\n')
  git(proj, 'init', '-q'); git(proj, 'add', '-A'); git(proj, 'commit', '-qm', 'base')
  writeFileSync(join(proj, 'wip.txt'), 'pre-existing wip\n')
  const args: Record<string, unknown> = { projectDir: proj, mechanicalChecks: [] }
  if (opts.readOnly !== false) args.readOnly = true
  if (opts.baseline !== false) {
    args.readOnlyBaseline = execFileSync('bash', [SNAP, '--objects', join(run, 'readonly-objects'), proj], { encoding: 'utf8', timeout: 60_000 }).trim()
  }
  writeFileSync(join(run, 'args.json'), JSON.stringify(args))
  writeFileSync(join(run, 'result.json'), JSON.stringify(PASS))
  return { proj, run, args: join(run, 'args.json'), result: join(run, 'result.json') }
}

const verdict = (f: { result: string }) => {
  const r = spawnSync(RESULT, [f.result], { encoding: 'utf8', timeout: 60_000 })
  expect(typeof r.status).toBe('number')
  return { code: r.status as number, out: r.stdout + r.stderr }
}

describe('readOnly guard', () => {
  test('snapshotting with --objects adds nothing under the project .git', () => {
    const f = fixture()
    const loose = execFileSync('git', ['-C', f.proj, 'count-objects'], { encoding: 'utf8', timeout: 60_000 })
    writeFileSync(join(f.proj, 'new.txt'), 'x\n')
    execFileSync('bash', [SNAP, '--objects', join(f.run, 'readonly-objects'), f.proj], { timeout: 60_000 })
    expect(execFileSync('git', ['-C', f.proj, 'count-objects'], { encoding: 'utf8', timeout: 60_000 })).toBe(loose)
    expect(existsSync(join(f.run, 'readonly-objects'))).toBe(true)
  })

  test('an untouched tree (WIP included) passes', () => {
    const f = fixture()
    expect(verdict(f).code).toBe(0)
  })

  test('a new file fails the run, naming it', () => {
    const f = fixture()
    writeFileSync(join(f.proj, 'stray.txt'), 'oops\n')
    const r = verdict(f)
    expect(r.code).toBe(1)
    expect(r.out).toContain('readOnly run changed stray.txt')
    expect(r.out).toContain('route: plan')
  })

  test('a modified tracked file and a deleted one are both named', () => {
    const f = fixture()
    writeFileSync(join(f.proj, 'a.txt'), 'changed\n')
    rmSync(join(f.proj, 'wip.txt'))
    const r = verdict(f)
    expect(r.code).toBe(1)
    expect(r.out).toContain('readOnly run changed a.txt')
    expect(r.out).toContain('readOnly run changed wip.txt')
  })

  test('__pycache__, .pytest_cache and .planning are not changes', () => {
    const f = fixture()
    for (const d of ['pkg/__pycache__', '.pytest_cache', '.planning']) {
      mkdirSync(join(f.proj, d), { recursive: true })
      writeFileSync(join(f.proj, d, 'x.pyc'), 'junk')
    }
    expect(verdict(f).code).toBe(0)
  })

  test('only __pycache__ written, then a real change: only the real one is named', () => {
    const f = fixture()
    mkdirSync(join(f.proj, '__pycache__')); writeFileSync(join(f.proj, '__pycache__', 'm.pyc'), 'j')
    writeFileSync(join(f.proj, 'real.txt'), 'r\n')
    const r = verdict(f)
    expect(r.code).toBe(1)
    expect(r.out).not.toContain('__pycache__')
    expect(r.out).toContain('readOnly run changed real.txt')
  })

  test('a non-readOnly run is unaffected by a changed tree', () => {
    const f = fixture({ readOnly: false })
    writeFileSync(join(f.proj, 'stray.txt'), 'fine\n')
    expect(verdict(f).code).toBe(0)
  })

  test('a readOnly run with no recorded baseline (non-git project) is skipped', () => {
    const f = fixture({ baseline: false })
    writeFileSync(join(f.proj, 'stray.txt'), 'x\n')
    expect(verdict(f).code).toBe(0)
  })

  test('an unreadable baseline is exit 2, not a pass', () => {
    const f = fixture()
    rmSync(join(f.run, 'readonly-objects'), { recursive: true, force: true })
    expect(verdict(f).code).toBe(2)
    const g = fixture()
    const a = JSON.parse(readFileSync(g.args, 'utf8')); a.readOnlyBaseline = 'not-a-sha'
    writeFileSync(g.args, JSON.stringify(a))
    expect(spawnSync(GUARD, [g.args], { encoding: 'utf8', timeout: 60_000 }).status).toBe(2)
  })
})
