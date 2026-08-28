#!/usr/bin/env bun
/**
 * suite-lint-report.test.ts — the false-positive measurement, verified by RECOMPUTATION.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/suite-lint-report.test.ts
 *
 * Issue 134's open question 4 is that the false-positive rate against this repo's suites is
 * unmeasured, and that a refusing gate wrong once costs a dispatch. The report is that measurement.
 * A report stating raw counts without an FP column answers a question nobody asked.
 *
 * This suite runs the corpus mode itself and compares, so the document cannot drift from the tool:
 * a stale report fails here rather than being believed.
 *
 * THE REPORT CONTRACT
 *   - one markdown table, one row per rule id, with a header cell matching /raw/i and one matching
 *     /false positive/i; both cells on every row are integers
 *   - a line naming the unparseable-file count
 *   - a Method section carrying the exact command, so the number can be re-run by someone who
 *     disputes it
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..', '..')
const REPORT = join(REPO, 'docs/investigations/2026-08-27_suite-lint-false-positives.md')
const md = () => readFileSync(REPORT, 'utf8')
const mod = () => import('./suite-lint.ts')

type Row = { cells: string[] }
function tableRows(text: string): { header: string[]; rows: Row[] }[] {
  const out: { header: string[]; rows: Row[] }[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) continue
    const cut = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
    const header = cut(lines[i])
    const rows: Row[] = []
    for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) rows.push({ cells: cut(lines[j]) })
    out.push({ header, rows })
    i += rows.length + 1
  }
  return out
}

/** The one table whose header carries both the raw and the false-positive column. */
function measurement(text: string) {
  const t = tableRows(text).find(t =>
    t.header.some(h => /raw/i.test(h)) && t.header.some(h => /false.positive/i.test(h)))
  expect(t).toBeDefined()
  return {
    raw: t!.header.findIndex(h => /raw/i.test(h)),
    fp: t!.header.findIndex(h => /false.positive/i.test(h)),
    rows: t!.rows,
  }
}

describe('the report measures what the gating decision needs', () => {
  test('every rule has a row', async () => {
    const { RULE_IDS } = await mod()
    const { rows } = measurement(md())
    for (const id of RULE_IDS) {
      expect(rows.some(r => r.cells.some(c => c.includes(id)))).toBe(true)
    }
  })

  test('the raw counts equal a FRESHLY EXECUTED corpus run over this repository', async () => {
    const { lintCorpus, RULE_IDS } = await mod()
    const fresh = lintCorpus(REPO)
    const { raw, rows } = measurement(md())
    for (const id of RULE_IDS) {
      const row = rows.find(r => r.cells.some(c => c.includes(id)))!
      expect(`${id}: ${row.cells[raw]}`).toBe(`${id}: ${fresh.counts[id]}`)
    }
  })

  test('every rule carries a stated false-positive count, an integer no larger than its raw count', () => {
    const { raw, fp, rows } = measurement(md())
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.cells[fp]).toMatch(/^\d+$/)
      expect(Number(r.cells[fp])).toBeLessThanOrEqual(Number(r.cells[raw]))
    }
  })

  test('the true-positive column is the arithmetic complement, so the three numbers cannot disagree', () => {
    const t = measurement(md())
    const tp = tableRows(md()).find(x => x.header.some(h => /raw/i.test(h)))!
      .header.findIndex(h => /true.positive/i.test(h))
    expect(tp).toBeGreaterThan(-1)
    for (const r of t.rows) {
      expect(r.cells[tp]).toMatch(/^\d+$/)
      expect(Number(r.cells[t.fp]) + Number(r.cells[tp])).toBe(Number(r.cells[t.raw]))
    }
  })

  test('EVERY finding the report cites is a finding the tool actually reports', async () => {
    // Without this the FP column is an unfalsifiable integer: a report claiming 0 false positives,
    // or citing lines that no run ever produced, would pass a suite that only checks the raw
    // column by recomputation. Here the evidence itself has to survive re-execution.
    const { lintCorpus } = await mod()
    const real = new Set(lintCorpus(REPO).findings.map((f: any) => String(f.where)))
    const cited = [...new Set((md().match(/[A-Za-z0-9_.\/-]+\/[A-Za-z0-9_.-]+\.(?:test\.ts|py):\d+/g) ?? []))]
    expect(cited.length).toBeGreaterThan(0)
    const invented = cited.filter(c => !real.has(c))
    expect(invented).toEqual([])
  })

  test('each rule that fired at all shows its work — at least two verified citations in its own section', async () => {
    const { lintCorpus, RULE_IDS } = await mod()
    const fresh = lintCorpus(REPO)
    const byRule = new Map<string, Set<string>>()
    for (const id of RULE_IDS) byRule.set(id, new Set())
    for (const f of fresh.findings as any[]) byRule.get(f.rule)?.add(String(f.where))

    const text = md()
    for (const id of RULE_IDS) {
      if (!byRule.get(id)!.size) continue
      const start = text.indexOf(`## ${id}`)
      expect(start).toBeGreaterThan(-1)
      const rest = text.slice(start + 3)
      const nextHeading = rest.indexOf('\n## ')
      const section = nextHeading < 0 ? rest : rest.slice(0, nextHeading)
      const cited = (section.match(/[A-Za-z0-9_.\/-]+\/[A-Za-z0-9_.-]+\.(?:test\.ts|py):\d+/g) ?? [])
        .filter(c => byRule.get(id)!.has(c))
      expect(`${id} verified citations: ${new Set(cited).size}`)
        .toBe(`${id} verified citations: ${Math.max(2, new Set(cited).size)}`)
    }
  })

  test('the unparseable count is present and agrees with the tool', async () => {
    const { lintCorpus } = await mod()
    const stated = /unparseable[^\n\d]*(\d+)/i.exec(md()) ?? /(\d+)[^\n]*unparseable/i.exec(md())
    expect(stated).not.toBeNull()
    expect(Number(stated![1])).toBe(lintCorpus(REPO).unparseable)
  })

  test('the method names the command and the root, so a doubter can re-run it', () => {
    const text = md()
    expect(text).toMatch(/##\s*Method/i)
    expect(text).toContain('--corpus')
    expect(text).toContain('suite-lint.ts')
  })

  test('the FP judgement is reasoned, not just tallied', () => {
    // Every rule id is discussed in prose somewhere outside its table row.
    const text = md()
    const outsideTables = text.split('\n').filter(l => !/^\s*\|/.test(l)).join('\n')
    for (const id of ['positive-match-failure-vocabulary', 'single-distinct-literal',
                      'existence-only-artifact', 'injected-key-never-varied']) {
      expect(outsideTables).toContain(id)
    }
  })
})
