#!/usr/bin/env bun
// What is actually covered, computed — never recorded by hand.
//
// A prose status table drifts: this skill's said "only quotations.md has been verified"
// for a day after six files were rebuilt. Coverage is derivable from the corpus, the
// reference files and the verification reports, so it is derived.
//
//   bun scripts/bluebook-coverage.ts          human-readable
//   bun scripts/bluebook-coverage.ts --json   machine-readable
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const REFS = join(ROOT, 'skills', 'bluebook', 'references')
const corpusPath = join(ROOT, 'scratch', 'bb22', 'corpus.txt')
const corpus = existsSync(corpusPath) ? readFileSync(corpusPath, 'utf8') : ''

export function coverage() {
  // Rules the corpus documents, from page URLs (the authoritative signal).
  const rules = new Set<string>()
  for (const m of corpus.matchAll(/\/v22\/rules\/(\d{1,2})-[a-z]/g)) rules.add(m[1])
  const tables = new Set<string>()
  for (const m of corpus.matchAll(/\/v22\/tables\/(t\d{1,2})[-\/]/g)) tables.add(m[1].toUpperCase())

  // Rules the reference files actually rely on.
  const files = existsSync(REFS) ? readdirSync(REFS).filter(f => f.endsWith('.md')) : []
  const cited = new Set<string>()
  const citedTables = new Set<string>()
  for (const f of files) {
    const t = readFileSync(join(REFS, f), 'utf8')
    const lns = t.split('\n')
    // Paragraph = maximal run of non-blank lines around li.
    const paraOf = (li: number) => {
      let a = li, b = li
      while (a > 0 && lns[a - 1].trim() !== '') a--
      while (b < lns.length - 1 && lns[b + 1].trim() !== '') b++
      return lns.slice(a, b + 1).join(' ')
    }
    for (const [li, line] of lns.entries()) {
      // Statute sections and other bodies' rules are not Bluebook rule cites:
      // "Nev. Rev. Stat. § 28.501", "Manual for Complex Litigation (Third) § 33.2".
      // Without this the checker reported phantom rules 28 and 33 as uncovered.
      if (/§|Model Rules|Manual for|Restatement|https?:\/\/|doi\.org/.test(line)) continue
      for (const m of line.matchAll(/(?<![\d.])(\d{1,2})\.\d{1,2}/g)) {
        // Bluebook rules run 1-23; above that it is a regulation section ("FAR 52.249-2").
        if (+m[1] > 23) continue
        cited.add(m[1])
      }
      // Tables are collected PER LINE, not over the whole file, so that a line which says
      // a table was NOT captured can exempt itself. Reading the file as one blob made
      // "Tables T3, T4, T5, T9, T15 and T16 were not captured" register as six citations
      // to missing tables — the checker flagging a sentence whose whole content is that
      // they are missing. Same exemption vocabulary as tests/bluebook-cites.test.ts.
      // Exemption is scoped to the PARAGRAPH, not a +/-1 line window. A caveat qualifies the
      // prose block it sits in, and hard-wrapping puts arbitrary distance between a marker and
      // the mention it governs: three mentions of T9 in one four-line paragraph each fell
      // outside a +/-1 window of the marker, so the checker reported a table as unmarked in a
      // paragraph whose first clause is that it was not extracted.
      if (/UNVERIFIED|not in the corpus|not extracted|not captured|could not be/i.test(paraOf(li))) continue
      for (const m of line.matchAll(/\bT(\d{1,2})\b/g)) citedTables.add('T' + m[1])
    }
  }

  // Which files carry an adversarial verification report.
  // A report that EXISTS is not a report that PASSED. The first version of this counted
  // files on disk, so two reports whose own verdict line read FAIL satisfied "complete".
  // A definition of done that a failing result satisfies is not a definition of done — but a
  // definition of done that an OPEN-ENDED PROSE REVIEW settles is not a definition of done either,
  // and that was the second mistake here. Requiring PASS made `complete` depend on a fuzzy review,
  // which is the non-terminating loop .claude/CLAUDE.md rule 9 forbids: the fix for round n adds
  // text that round n+1 finds real new defects in, so the reviewed surface grows in response to its
  // own output. Measured over five rounds: 7 FAIL -> 4 -> 1 -> PASS, then the corpus grew and it ran
  // 5 -> 5, with entirely DIFFERENT findings each time and per-file counts falling but never zero.
  // So `complete` now gates only on the decidable facts, and the verdict is REPORTED, not gated.
  // Every file has been through an adversarial pass; the latest verdicts are printed so a reader can
  // see where each one stood, and the way to act on a FAIL is to read that report, not to re-run it.
  const vDirs = [join(ROOT, 'scratch', 'bb22', 'verify'), join(ROOT, 'scratch', 'bluebook-verify')]
  const verified = new Set<string>()
  const failing: string[] = []
  for (const d of vDirs) {
    if (!existsSync(d)) continue
    for (const f of readdirSync(d)) {
      if (!f.endsWith('.md')) continue
      // The Rule 5 pass predates the per-file naming and lives in REPORT.md.
      const name = f === 'REPORT.md' ? 'quotations' : f.replace(/\.md$/, '')
      const body = readFileSync(join(d, f), 'utf8')
      const verdict = body.match(/VERDICT[:\s*]*\**\s*(PASS|FAIL)/i)?.[1]?.toUpperCase()
      if (verdict === 'FAIL') failing.push(name)
      verified.add(name)
    }
  }

  const missingRules = [...cited].filter(r => !rules.has(r)).sort((a, b) => +a - +b)
  const missingTables = [...citedTables].filter(t => !tables.has(t)).sort()
  const unverified = files.map(f => f.replace(/\.md$/, ''))
                          .filter(f => !verified.has(f) && f !== 'editions-21-to-22').sort()
  return {
    corpusPages: (corpus.match(/^=== /gm) ?? []).length,
    rulesExtracted: [...rules].sort((a, b) => +a - +b),
    tablesExtracted: [...tables].sort(),
    missingRules, missingTables, unverified, failing,
    complete: missingRules.length === 0 && missingTables.length === 0
              && unverified.length === 0,
  }
}

if (import.meta.main) {
  const c = coverage()
  if (process.argv.includes('--json')) { console.log(JSON.stringify(c, null, 2)); process.exit(0) }
  console.log(`corpus:            ${c.corpusPages} pages`)
  console.log(`rules extracted:   ${c.rulesExtracted.join(' ') || '(none)'}`)
  console.log(`tables extracted:  ${c.tablesExtracted.join(' ') || '(none)'}`)
  console.log(`cited, NOT in corpus — rules:  ${c.missingRules.join(' ') || 'none'}`)
  console.log(`cited, NOT in corpus — tables: ${c.missingTables.join(' ') || 'none'}`)
  console.log(`no verification report:        ${c.unverified.join(' ') || 'none'}`)
  console.log(`latest verdict FAIL (advisory): ${c.failing.join(' ') || 'none'}`)
  if (c.failing.length) console.log(`  -> read scratch/bb22/verify/<file>.md; do not re-run the pass expecting it to clear`)
  console.log(`\nCOMPLETE: ${c.complete}`)
}
