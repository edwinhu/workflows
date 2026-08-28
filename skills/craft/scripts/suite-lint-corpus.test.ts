#!/usr/bin/env bun
/**
 * suite-lint-corpus.test.ts — corpus mode: walk a tree, lint every suite in both dialects, report
 * per-rule counts AND how many files could not be parsed.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/suite-lint-corpus.test.ts
 *
 * A file that was never linted is not a clean file. Silently skipping an unparseable suite reports
 * zero findings over it, which is indistinguishable from a clean verdict — the same reasoning that
 * makes a dead lens a synthesized critical in workflow.js. So the count is part of the output.
 *
 * THE CONTRACT THIS SUITE PINS
 *
 *   lintCorpus(root) -> {
 *     root: string
 *     filesLinted: number
 *     unparseable: number
 *     unparseableFiles: string[]          // root-relative, sorted
 *     counts: Record<RuleId, number>      // every rule id present, zero included
 *     findings: Finding[]                 // sorted by file, then line, then rule; `where` paths
 *                                         // are ROOT-RELATIVE
 *   }
 *   formatCorpusSummary(summary) -> string   // per-rule counts + a machine-readable summary
 *   CLI:  bun suite-lint.ts --corpus <root>  -> that string on stdout, exit 0
 *
 * Determinism is a hard requirement: no wall-clock, no randomness, sorted paths. Two consecutive
 * runs over one tree must be byte-identical, or the FP number in the investigation report cannot be
 * recomputed by anyone who disputes it.
 *
 * `extract` throws on a source it cannot scan; an unterminated string literal is such a source, and
 * corpus mode counts that file rather than dropping it.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = `${import.meta.dir}/suite-lint.ts`
const mod = () => import('./suite-lint.ts')
const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

const R1 = 'positive-match-failure-vocabulary'
const R2 = 'single-distinct-literal'
const R3 = 'existence-only-artifact'
const R4 = 'injected-key-never-varied'

/**
 * One fixture tree, four dialect-mixed suites: one defect per rule, one clean suite, and one file
 * whose string literal never closes.
 */
function tree() {
  const dir = mkdtempSync(join(tmpdir(), 'suite-lint-corpus-'))
  scratch.push(dir)
  mkdirSync(join(dir, 'nested', 'deep'), { recursive: true })
  const w = (rel: string, ...lines: string[]) => writeFileSync(join(dir, rel), lines.join('\n') + '\n')

  w('r1.test.ts',
    "const FAILURE_MESSAGE = 'plan NOT SAVED to disk'",
    "test('the hook saves the plan', () => {",
    '  expect(runHook()).toMatch(/saved/i)',
    '})')
  w(join('nested', 'test_r2.py'),
    'def test_a_zero_budget_disables_the_loop():',
    '    assert budget_for(0).enabled is False',
    'def test_a_budget_enables_the_loop():',
    '    assert budget_for(0).enabled is True')
  w(join('nested', 'deep', 'r3.test.ts'),
    "test('the run writes its report', () => {",
    "  expect(existsSync('docs/report.md')).toBe(true)",
    '})')
  w(join('nested', 'test_r4.py'),
    'def test_the_runner_honours_the_timeout():',
    "    cfg = {'CRAFT_ASSERT_TIMEOUT': '30'}",
    '    assert run(cfg).ok')
  w('clean.test.ts',
    "test('a generous timeout writes the report', () => {",
    "  expect(readFileSync('docs/report.md', 'utf8')).toContain('single-distinct-literal')",
    '})')
  w('broken.test.ts',
    "const unterminated = 'this quote never closes",
    "test('x', () => { expect(1).toBe(1) })")
  // Not a test suite: corpus mode walks SUITES, and a production file is not one.
  w(join('nested', 'helper.ts'), "export const x = 'docs/report.md'")
  return dir
}

const cli = (root: string, ...extra: string[]) =>
  execFileSync('bun', [SCRIPT, '--corpus', root, ...extra], { encoding: 'utf8' })

describe('corpus mode reports per-rule counts over a whole tree', () => {
  test('every rule that has a defect in the tree is counted, and a rule with none reports zero', async () => {
    const { lintCorpus, RULE_IDS } = await mod()
    const s = lintCorpus(tree())
    for (const id of RULE_IDS) expect(Object.keys(s.counts)).toContain(id)
    expect(s.counts[R1]).toBe(1)
    expect(s.counts[R2]).toBe(1)
    expect(s.counts[R3]).toBe(1)
    expect(s.counts[R4]).toBe(1)
    expect(s.findings.length).toBe(4)
  })

  test('it walks nested directories and both dialects', async () => {
    const { lintCorpus } = await mod()
    const s = lintCorpus(tree())
    const files = s.findings.map((f: any) => String(f.where).split(':')[0])
    expect(files.some((p: string) => p.includes('deep/r3.test.ts'))).toBe(true)
    expect(files.some((p: string) => p.endsWith('test_r2.py'))).toBe(true)
    expect(files.some((p: string) => p.endsWith('test_r4.py'))).toBe(true)
  })

  test('the clean suite contributes nothing, and a non-suite file is never walked', async () => {
    const { lintCorpus } = await mod()
    const s = lintCorpus(tree())
    const files = s.findings.map((f: any) => String(f.where).split(':')[0])
    expect(files.some((p: string) => p.includes('clean.test.ts'))).toBe(false)
    expect(files.some((p: string) => p.includes('helper.ts'))).toBe(false)
  })
})

describe('an unparseable file is COUNTED, never dropped', () => {
  test('the file with the unterminated literal is reported by name, not silently skipped', async () => {
    const { lintCorpus } = await mod()
    const s = lintCorpus(tree())
    expect(s.unparseable).toBe(1)
    expect(s.unparseableFiles).toEqual(['broken.test.ts'])
    // and it is NOT counted among the files that were actually linted
    expect(s.filesLinted).toBe(5)
  })

  test('the printed summary names the unparseable count where a reader will see it', () => {
    const out = cli(tree())
    expect(out).toMatch(/unparseable/i)
    expect(out).toMatch(/broken\.test\.ts/)
  })

  test('a tree with nothing unparseable reports zero, so the field is not a constant', async () => {
    const { lintCorpus } = await mod()
    const dir = mkdtempSync(join(tmpdir(), 'suite-lint-clean-'))
    scratch.push(dir)
    writeFileSync(join(dir, 'clean.test.ts'), "test('a', () => { expect(f(1)).toBe(2) })\n")
    const s = lintCorpus(dir)
    expect(s.unparseable).toBe(0)
    expect(s.unparseableFiles).toEqual([])
    expect(s.filesLinted).toBe(1)
  })
})

describe('the output is deterministic, so the number can be recomputed and disputed', () => {
  test('two consecutive CLI runs over one tree are byte-identical', () => {
    const dir = tree()
    expect(cli(dir)).toBe(cli(dir))
  })

  test('two lintCorpus calls over one tree serialize identically', async () => {
    const { lintCorpus } = await mod()
    const dir = tree()
    expect(JSON.stringify(lintCorpus(dir))).toBe(JSON.stringify(lintCorpus(dir)))
  })

  test('findings are sorted by file then line, not by walk order', async () => {
    const { lintCorpus } = await mod()
    const s = lintCorpus(tree())
    const keys = s.findings.map((f: any) => String(f.where))
    expect(keys).toEqual([...keys].sort())
  })

  test('the printed summary pairs each rule id with ITS OWN count, not just a number somewhere', () => {
    const out = cli(tree())
    for (const id of [R1, R2, R3, R4]) {
      const line = out.split('\n').find(l => l.includes(id) && !l.trimStart().startsWith('"'))
      expect(line).toBeDefined()
      expect(line).toMatch(new RegExp(`${id}\\D+1(\\D|$)`))
    }
  })

  test('the machine-readable half parses, and agrees with lintCorpus', async () => {
    const { lintCorpus } = await mod()
    const dir = tree()
    const out = cli(dir)
    const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)
    const parsed = JSON.parse(json)
    const s = lintCorpus(dir)
    expect(parsed.counts).toEqual(s.counts)
    expect(parsed.unparseable).toBe(s.unparseable)
    expect(parsed.filesLinted).toBe(s.filesLinted)
  })

  test('finding paths are ROOT-RELATIVE, so the summary does not embed the machine it ran on', async () => {
    const { lintCorpus } = await mod()
    const dir = tree()
    const s = lintCorpus(dir)
    for (const f of s.findings) expect(String(f.where).startsWith(dir)).toBe(false)
    expect(s.findings.map((f: any) => String(f.where).split(':')[0]).sort())
      .toEqual(['nested/deep/r3.test.ts', 'nested/test_r2.py', 'nested/test_r4.py', 'r1.test.ts'])
  })
})
