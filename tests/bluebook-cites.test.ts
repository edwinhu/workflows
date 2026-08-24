// Gate for the bluebook skill: every rule/table citation in a reference file must be
// backed by the extracted 22e corpus, or be explicitly marked UNVERIFIED near where it
// is made. A cite to a rule nobody has read is the defect this whole effort exists to
// remove — and it is decidable, so it is a test rather than a review opinion.
import { test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const CORPUS = join(ROOT, 'scratch', 'bb22', 'corpus.txt')
const REFS = ['cases', 'statutes', 'secondary-sources', 'short-forms',
              'signals-parentheticals', 'quotations', 'abbreviations', 'audit-patterns']

const corpus = existsSync(CORPUS) ? readFileSync(CORPUS, 'utf8') : ''
// A bare `corpus.includes(stem)` was a FALSE-NEGATIVE machine: "3.4" matches any incidental
// "3.4" in 300KB of text — a page number, a dollar figure, a subsection of an unrelated rule —
// so a cite to a rule that was never extracted sailed through. Build the set of rule ids the
// corpus actually documents instead, from two independent signals:
//   - the page URLs:  .../10-cases/10-2-case-names           -> 10.2
//   - the headings:   "10.2Case Names (pp. 101-07)"          -> 10.2
// and require membership. A rule number absent from both is not in the corpus, whatever
// digit strings happen to appear elsewhere.
const RULE_IDS = new Set<string>()
// URL form: /5-quotations/5-1-formatting-of-quotations -> 5.1. The parent segment is
// <digits>-<words>, not <digits>-<digits>; requiring the latter silently dropped every rule.
for (const m of corpus.matchAll(/\/\d{1,2}-[a-z][a-z-]*\/(\d{1,2})-(\d{1,2})(?:-(\d))?[a-z-]*/g)) {
  RULE_IDS.add(`${m[1]}.${m[2]}` + (m[3] ? `.${m[3]}` : ''))
}
// Heading form: "5.1Formatting of Quotations". It appears MID-LINE inside a breadcrumb
// ("Rules –Quotations –5.1Formatting…"), so anchoring to line start dropped it too.
for (const m of corpus.matchAll(/(?<![\d.])(\d{1,2}\.\d{1,2}(?:\.\d)?)(?=[A-Z(])/g)) {
  RULE_IDS.add(m[1])
}
// A subsection is backed when its parent rule is documented: 10.2.1 counts if 10.2 does.
const inCorpus = (stem: string) =>
  RULE_IDS.has(stem) || RULE_IDS.has(stem.split('.').slice(0, 2).join('.'))

function unbackedCites(file: string) {
  const path = join(ROOT, 'skills', 'bluebook', 'references', `${file}.md`)
  if (!existsSync(path)) return { missing: [], total: 0 }
  const lines = readFileSync(path, 'utf8').split('\n')
  const missing: string[] = []
  let total = 0
  lines.forEach((line, i) => {
    // A cite is unverified-exempt if this line or either neighbour says so.
    const ctx = [lines[i - 1] ?? '', line, lines[i + 1] ?? ''].join(' ')
    const exempt = /UNVERIFIED|not in the corpus|not extracted|could not be/i.test(ctx)
    for (const m of line.matchAll(/\b(\d{1,2}\.\d{1,2}(?:\.\d)?)/g)) {
      // A STATUTE section number is not a rule cite. "Tex. Fam. Code Ann. § 6.001"
      // matched as rule "6.00" and failed the gate on a line containing no rule
      // citation at all — a false positive in the checker, not a defect in the file.
      const before = line.slice(Math.max(0, m.index! - 4), m.index!)
      if (/[§¶]\s*$/.test(before)) continue
      // Bluebook rules run 1-23. A "rule" numbered above that is definitionally not one,
      // so it is a regulation or statute section the patterns above did not catch:
      // "FAR 52.249-2(e)" yielded 52.24, as "§ 28.501" once yielded 28. Bounding by the
      // real rule range retires that whole class instead of excluding each source by name.
      if (Number(m[1].split('.')[0]) > 23) continue
      // Nor is a DOI or any other number living inside a URL: "https://doi.org/10.34190/..."
      // matched as rule "10.34". Reference files are full of example citations with links.
      const around = line.slice(Math.max(0, m.index! - 40), m.index! + 20)
      if (/https?:\/\/|doi\.org|www\./i.test(around)) continue
      // A longer dotted run ("1.2.3.4") is a version string, not a rule id. Match a DIGIT
      // only — an earlier version of this skipped anything followed by a period, which is
      // most sentence-final cites, and silently disabled the gate.
      const after = line.slice(m.index! + m[1].length, m.index! + m[1].length + 2)
      if (/^\.\d/.test(after)) continue
      // "Model Rules of Pro. Conduct r. 3.12" cites the ABA's rules, not the Bluebook's.
      // Reference files quote such citations as EXAMPLES, so a rule number inside one is
      // the example's own, not a claim about Bluebook rule 3.12.
      if (/Model Rules|Model Code|Pro\. Conduct|A\.B\.A\.|Restatement/i.test(line)) continue
      total++
      if (!exempt && !inCorpus(m[1])) missing.push(`${file}:${i + 1} ${m[1]}`)
    }
  })
  return { missing, total }
}

// The corpus is scraped from a licensed subscription and is gitignored, so it exists on
// the machine that extracted it and nowhere else. A gate that hard-fails without it would
// go red on every fresh clone and be disabled within a day — so absence SKIPS, and only
// presence gates. Regenerate it with the recipe in references/editions-21-to-22.md.
const haveCorpus = corpus.length > 200_000

test('corpus present (skipped when not extracted locally)', () => {
  if (!haveCorpus) { console.warn('bluebook: no local 22e corpus — cite gate skipped'); return }
  expect(corpus.length).toBeGreaterThan(200_000)
})

for (const f of REFS) {
  test(`${f}.md cites only rules the corpus backs (or marks them UNVERIFIED)`, () => {
    if (!haveCorpus) return
    const { missing } = unbackedCites(f)
    expect(missing).toEqual([])
  })
}

// ── Coverage gate ────────────────────────────────────────────────────────────────
// The cite gate above is satisfied by a file that cites NOTHING, which is exactly the
// state the two unverified references are in: abbreviations.md carries 0 rule cites and
// audit-patterns.md carries 0 table cites, so both pass vacuously. A reference that has
// been checked against the 22e leaves evidence — it names the edition and anchors its
// claims to rules or tables it can point at.
const MIN_ANCHORS: Record<string, { rules: number; tables: number }> = {
  'abbreviations':   { rules: 3, tables: 3 },
  'audit-patterns':  { rules: 5, tables: 1 },
}

for (const [f, need] of Object.entries(MIN_ANCHORS)) {
  test(`${f}.md is anchored to the 22e, not merely free of bad cites`, () => {
    if (!haveCorpus) return
    const path = join(ROOT, 'skills', 'bluebook', 'references', `${f}.md`)
    const text = readFileSync(path, 'utf8')
    const rules = (text.match(/\b\d{1,2}\.\d{1,2}(\.\d)?/g) ?? []).length
    const tables = (text.match(/\bT\d{1,2}\b/g) ?? []).length
    expect({ file: f, rules: rules >= need.rules, tables: tables >= need.tables, names22e: /22e/.test(text) })
      .toEqual({ file: f, rules: true, tables: true, names22e: true })
  })
}

// T3's gate: the skill's status table must not call a rebuilt file UNVERIFIED. Decidable,
// so it is a test rather than a reviewer's impression of whether the table "looks right".
test('SKILL.md status table lists no rebuilt reference as UNVERIFIED', () => {
  if (!haveCorpus) return
  const skill = readFileSync(join(ROOT, 'skills', 'bluebook', 'SKILL.md'), 'utf8')
  const rebuilt = ['abbreviations.md', 'audit-patterns.md']
  const stillUnverified = skill.split('\n')
    .filter(l => rebuilt.some(r => l.includes(r)) && /UNVERIFIED/i.test(l))
    .map(l => l.trim().slice(0, 60))
  expect(stillUnverified).toEqual([])
})
