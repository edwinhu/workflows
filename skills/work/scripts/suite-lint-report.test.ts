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
 * THE AUDITED UNIVERSE IS WHAT THIS REPOSITORY TRACKS
 * `lintCorpus` walks the filesystem, so its raw output depends on what happens to be on disk: a
 * gitignored `scratch/` snapshot, or an initialized `skills/bmll` submodule, each add suites nobody
 * audited. Recomputing against the filesystem therefore made this suite pass or fail on checkout
 * state rather than on the lint — three tests failed in a worktree without `git submodule update
 * --init` and passed in one with it. Every recomputation below is scoped to `git ls-files` (no
 * `--recurse-submodules`): a submodule is one mode-160000 gitlink entry, so nothing inside it is
 * tracked by THIS repo, and gitignored paths are excluded by the same mechanism. The filter belongs
 * here and not in `lintCorpus`, whose other two callers want the opposite: the dispatch tier
 * (`work-dispatch.sh` TIER 3) must lint the test an implementer just wrote and has not committed,
 * and `suite-lint-corpus.test.ts` lints mktemp trees that are not git repositories at all.
 *
 * CITATIONS ARE `path::test title`, NEVER `path:line`
 * A finding is cited by its file and the title of the innermost test declaration enclosing it — the
 * `test` field suite-lint.ts puts on every finding inside one — written in a code span, with
 * `<file scope>` for a finding outside any test. A line number moves whenever anything above it in
 * that file is edited, and line citations broke this suite three times on 2026-10-02 alone; a title
 * moves only when that test is renamed, deleted, or stops producing the finding, and those are the
 * events this suite exists to report.
 *
 * WHAT IS PINNED, AND WHY IT IS NOT A WHOLE-FILE OR WHOLE-TREE TOTAL
 * The report's raw column counts every suite file in the repository, so it moves when any unrelated
 * test file is added; it survives as a dated snapshot, held honest by arithmetic (cited <= raw,
 * fp + tp = raw) rather than by recomputation. Its predecessor as the pinned column, every finding
 * in every file the report cites, moved whenever a cited file gained or lost an unrelated finding —
 * an edit to a test nobody cited. Pinned instead is the CITED-FINDINGS column: per rule, the number
 * of distinct citations in that rule's own section, each of which must resolve to a finding the
 * tool reports under that rule. It moves only when the document's evidence changes or a cited
 * finding stops resolving.
 *
 * THE REPORT CONTRACT
 *   - one markdown table, one row per rule id, with header cells matching /cited findings/i, /raw/i
 *     and /false positive/i; every such cell on every row is an integer
 *   - a line naming the unparseable-file count
 *   - a Method section carrying the exact command, so the number can be re-run by someone who
 *     disputes it
 */
import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..', '..')
const REPORT = join(REPO, 'docs/investigations/2026-08-27_suite-lint-false-positives.md')
const md = () => readFileSync(REPORT, 'utf8')
const mod = () => import('./suite-lint.ts')

/**
 * Root-relative paths this repository tracks. `git ls-files` WITHOUT `--recurse-submodules` reports a
 * submodule as one mode-160000 gitlink entry and nothing under it, so an initialized `skills/bmll` or
 * `external/anthropic-skills` contributes no suite files here whether or not it is checked out. A
 * gitignored `scratch/` is excluded by the same call. No fallback if git is missing: a silent
 * filesystem fallback is exactly the checkout-dependence this scoping exists to remove, so a broken
 * `git` must fail the suite loudly.
 */
function trackedFiles(): Set<string> {
  const out = execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { timeout: 120_000, encoding: 'utf8', maxBuffer: 64 << 20 })
  return new Set(out.split('\0').filter(Boolean))
}

/**
 * The corpus run, restricted to the tracked universe. Both halves are filtered: an unparseable file
 * inside a submodule would otherwise move the stated unparseable count the same way a finding does.
 */
function auditedRun(lintCorpus: (root: string) => any) {
  const tracked = trackedFiles()
  expect(tracked.size).toBeGreaterThan(0)
  const s = lintCorpus(REPO)
  const findings = (s.findings as any[]).filter(f => tracked.has(fileOf(String(f.where))))
  const unparseableFiles = (s.unparseableFiles as string[]).filter(f => tracked.has(f))
  return { findings, unparseableFiles, unparseable: unparseableFiles.length }
}

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
  const cited = t!.header.findIndex(h => /cited.findings/i.test(h))
  expect(cited).toBeGreaterThan(-1)
  return {
    cited,
    raw: t!.header.findIndex(h => /raw/i.test(h)),
    fp: t!.header.findIndex(h => /false.positive/i.test(h)),
    rows: t!.rows,
  }
}

const FILE_SCOPE = '<file scope>'
/** `` `path::test title` `` — the path ends in a suite extension, the title runs to the closing tick. */
const CITE = /`([A-Za-z0-9_.\/-]+\.(?:(?:test|spec)\.[cm]?[jt]sx?|py))::([^`\n]+)`/g
const fileOf = (where: string) => where.replace(/:\d+$/, '')
/** The handle a finding is cited by; the same string the document writes inside the code span. */
const handleOf = (f: any) => `${fileOf(String(f.where))}::${f.test ?? FILE_SCOPE}`
/** Every distinct citation in `text`, as handles. */
const citations = (text: string): string[] => [...new Set([...text.matchAll(CITE)].map(m => `${m[1]}::${m[2]}`))]

/** The text of `## <id>` up to the next level-2 heading. */
function sectionOf(text: string, id: string): string {
  const start = text.indexOf(`## ${id}`)
  expect(start).toBeGreaterThan(-1)
  const rest = text.slice(start + 3)
  const next = rest.indexOf('\n## ')
  return next < 0 ? rest : rest.slice(0, next)
}

describe('the report measures what the gating decision needs', () => {
  test('every rule has a row', async () => {
    const { RULE_IDS } = await mod()
    const { rows } = measurement(md())
    for (const id of RULE_IDS) {
      expect(rows.some(r => r.cells.some(c => c.includes(id)))).toBe(true)
    }
  })

  test('the CITED-FINDINGS counts equal the citations in each rule\'s section that a fresh run resolves', async () => {
    // The pinned measurement. Neither repo growth nor an edit to a cited file moves it unless the
    // edit renames, deletes or silences a cited finding: only resolving citations are counted, so a
    // finding that stops firing drops its rule's count and the stated number no longer matches.
    const { lintCorpus, RULE_IDS } = await mod()
    const fresh = auditedRun(lintCorpus)
    const text = md()
    const { cited, rows } = measurement(text)
    for (const id of RULE_IDS) {
      const real = new Set(fresh.findings.filter((f: any) => f.rule === id).map(handleOf))
      const resolved = citations(sectionOf(text, id)).filter(c => real.has(c)).length
      const row = rows.find(r => r.cells.some(c => c.includes(id)))!
      expect(`${id}: ${row.cells[cited]}`).toBe(`${id}: ${resolved}`)
    }
  })

  test('the whole-repo raw column cannot be smaller than the cited findings it contains', () => {
    // The raw column is an unpinned snapshot; this is the arithmetic that keeps it from being free.
    const { cited, raw, rows } = measurement(md())
    for (const r of rows) {
      expect(r.cells[raw]).toMatch(/^\d+$/)
      expect(Number(r.cells[cited])).toBeLessThanOrEqual(Number(r.cells[raw]))
    }
  })

  test('the one true positive this report found by reading still fires, under its own rule', async () => {
    // The FP measurement's whole point is which findings survived inspection. Exactly one did, and
    // a rule change that silently stopped reporting it would gut the report while leaving every
    // count plausible.
    const TP = 'skills/work/scripts/work-redispatch.test.ts::a run dir whose oldest archive is over 2h old triggers the self-eval early'
    const { lintCorpus } = await mod()
    const fresh = auditedRun(lintCorpus)
    const tp = fresh.findings.filter((f: any) => handleOf(f) === TP).map((f: any) => f.rule)
    expect(tp).toEqual(['positive-match-failure-vocabulary'])
    expect(citations(sectionOf(md(), 'positive-match-failure-vocabulary'))).toContain(TP)
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
    const real = new Set(auditedRun(lintCorpus).findings.map(handleOf))
    const cited = citations(md())
    expect(cited.length).toBeGreaterThan(0)
    const invented = cited.filter(c => !real.has(c))
    expect(invented).toEqual([])
  })

  test('each rule that fired at all shows its work — at least two verified citations in its own section', async () => {
    const { lintCorpus, RULE_IDS } = await mod()
    const fresh = auditedRun(lintCorpus)
    const byRule = new Map<string, Set<string>>()
    for (const id of RULE_IDS) byRule.set(id, new Set())
    for (const f of fresh.findings as any[]) byRule.get(f.rule)?.add(handleOf(f))

    const text = md()
    for (const id of RULE_IDS) {
      if (!byRule.get(id)!.size) continue
      const all = citations(sectionOf(text, id))
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
    expect(Number(stated![1])).toBe(auditedRun(lintCorpus).unparseable)
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
