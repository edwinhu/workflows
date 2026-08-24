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
    for (const line of t.split('\n')) {
      // Statute sections and other bodies' rules are not Bluebook rule cites:
      // "Nev. Rev. Stat. § 28.501", "Manual for Complex Litigation (Third) § 33.2".
      // Without this the checker reported phantom rules 28 and 33 as uncovered.
      if (/§|Model Rules|Manual for|Restatement|https?:\/\/|doi\.org/.test(line)) continue
      for (const m of line.matchAll(/(?<![\d.])(\d{1,2})\.\d{1,2}/g)) cited.add(m[1])
    }
    for (const m of t.matchAll(/\bT(\d{1,2})\b/g)) citedTables.add('T' + m[1])
  }

  // Which files carry an adversarial verification report.
  const vDirs = [join(ROOT, 'scratch', 'bb22', 'verify'), join(ROOT, 'scratch', 'bluebook-verify')]
  const verified = new Set<string>()
  for (const d of vDirs) {
    if (!existsSync(d)) continue
    for (const f of readdirSync(d)) {
      if (!f.endsWith('.md')) continue
      // The Rule 5 pass predates the per-file naming and lives in REPORT.md.
      verified.add(f === 'REPORT.md' ? 'quotations' : f.replace(/\.md$/, ''))
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
    missingRules, missingTables, unverified,
    complete: missingRules.length === 0 && missingTables.length === 0 && unverified.length === 0,
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
  console.log(`\nCOMPLETE: ${c.complete}`)
}
