#!/usr/bin/env bun
/**
 * suite-lint-report.test.ts — the false-positive measurement, verified by RECOMPUTATION.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/suite-lint-report.test.ts
 *
 * Issue 134's open question 4 is that the false-positive rate against this repo's suites is
 * unmeasured, and that a refusing gate wrong once costs a dispatch. The report is that measurement.
 * A report stating raw counts without an FP column answers a question nobody asked.
 *
 * This suite runs the corpus mode itself and compares, so the document cannot drift from the tool:
 * a stale report fails here rather than being believed.
 *
 * WHAT IS PINNED, AND WHY IT IS NOT THE WHOLE-TREE TOTAL
 * The report's raw column counts every suite file in the repository, so it moves when any unrelated
 * test file is added — it was hand-corrected three times in a fortnight, each correction a commit
 * editing a document so a suite would pass, none of it evidence about the lint. Pinned here instead
 * is the AUDITED CORPUS: the per-rule counts over exactly the files this investigation read and
 * cites. That set is invariant under repo growth and moves only when the lint's behaviour over those
 * files moves, which is the regression worth catching. The raw column survives as a dated snapshot,
 * held honest by arithmetic (audited <= raw, fp + tp = raw) rather than by recomputation.
 *
 * THE REPORT CONTRACT
 *   - one markdown table, one row per rule id, with header cells matching /audited corpus/i, /raw/i
 *     and /false positive/i; every such cell on every row is an integer
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
  const audited = t!.header.findIndex(h => /audited.corpus/i.test(h))
  expect(audited).toBeGreaterThan(-1)
  return {
    audited,
    raw: t!.header.findIndex(h => /raw/i.test(h)),
    fp: t!.header.findIndex(h => /false.positive/i.test(h)),
    rows: t!.rows,
  }
}

const CITE = /[A-Za-z0-9_.\/-]+\/[A-Za-z0-9_.-]+\.(?:test\.ts|py):\d+/g
const fileOf = (where: string) => where.replace(/:\d+$/, '')

/**
 * The audited corpus: the files this report cites by `file:line`, which is the set it actually read.
 * Deriving it from the document rather than recording it separately keeps one fact in one place —
 * a checked-in file list would be a second thing to drift.
 */
function auditedFiles(text: string): Set<string> {
  return new Set((text.match(CITE) ?? []).map(fileOf))
}

describe('the report measures what the gating decision needs', () => {
  test('every rule has a row', async () => {
    const { RULE_IDS } = await mod()
    const { rows } = measurement(md())
    for (const id of RULE_IDS) {
      expect(rows.some(r => r.cells.some(c => c.includes(id)))).toBe(true)
    }
  })

  test('the AUDITED-CORPUS counts equal a freshly executed run over the files this report read', async () => {
    // The pinned measurement, and the reason it is not the whole-repository total. A whole-tree
    // count moves when ANY suite file is added anywhere in the repo, so it was hand-corrected
    // repeatedly for reasons having nothing to do with the lint — a document edited to make a test
    // pass is not evidence. The audited corpus is the file set this investigation actually read and
    // cites, so it is invariant under repo growth and moves only when the LINT's behaviour over
    // those files moves: a rule that stops firing drops to 0, a rule that fires wider goes up.
    const { lintCorpus, RULE_IDS } = await mod()
    const fresh = lintCorpus(REPO)
    const files = auditedFiles(md())
    expect(files.size).toBeGreaterThan(0)
    const counts = Object.fromEntries(RULE_IDS.map((id: string) => [id, 0])) as Record<string, number>
    for (const f of fresh.findings as any[]) {
      if (files.has(fileOf(String(f.where)))) counts[f.rule]++
    }
    const { audited, rows } = measurement(md())
    for (const id of RULE_IDS) {
      const row = rows.find(r => r.cells.some(c => c.includes(id)))!
      expect(`${id}: ${row.cells[audited]}`).toBe(`${id}: ${counts[id]}`)
    }
  })

  test('the whole-repo raw column cannot be smaller than the audited corpus it contains', () => {
    // The raw column is an unpinned snapshot; this is the arithmetic that keeps it from being free.
    const { audited, raw, rows } = measurement(md())
    for (const r of rows) {
      expect(r.cells[raw]).toMatch(/^\d+$/)
      expect(Number(r.cells[audited])).toBeLessThanOrEqual(Number(r.cells[raw]))
    }
  })

  test('the one true positive this report found by reading still fires, under its own rule', async () => {
    // The FP measurement's whole point is which findings survived inspection. Exactly one did, and
    // a rule change that silently stopped reporting it would gut the report while leaving every
    // count plausible.
    const { lintCorpus } = await mod()
    const fresh = lintCorpus(REPO)
    const tp = fresh.findings.find((f: any) =>
      String(f.where) === 'skills/work/scripts/work-redispatch.test.ts:776')
    expect(tp?.rule).toBe('positive-match-failure-vocabulary')
    expect(md()).toContain('skills/work/scripts/work-redispatch.test.ts:776')
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
    const cited = [...new Set(md().match(CITE) ?? [])]
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
      const all = [...new Set(section.match(CITE) ?? [])]
      // Attribution, not just existence: a citation in this rule's section must be a finding THIS
      // rule reports. Filtering the mismatches away instead would let a rule's evidence quietly
      // become another rule's findings while the section still looked populated.
      expect(`${id} misattributed: ${all.filter(c => !byRule.get(id)!.has(c))}`).toBe(`${id} misattributed: `)
      const cited = all.filter(c => byRule.get(id)!.has(c))
      // Two citations, or every finding there is: a rule that fired once in the whole corpus
      // (existence-only-artifact, 2026-09-12) can show its work with exactly one.
      const need = Math.min(2, byRule.get(id)!.size)
      expect(`${id} verified citations: ${new Set(cited).size}`)
        .toBe(`${id} verified citations: ${Math.max(need, new Set(cited).size)}`)
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
