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
// The corpus prints headings as "10.2Case Names"; match on the numeric stem only.
const inCorpus = (stem: string) => corpus.includes(stem)

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
      total++
      if (!exempt && !inCorpus(m[1])) missing.push(`${file}:${i + 1} ${m[1]}`)
    }
  })
  return { missing, total }
}

test('the 22e corpus is present and non-trivial', () => {
  expect(corpus.length).toBeGreaterThan(200_000)
})

for (const f of REFS) {
  test(`${f}.md cites only rules the corpus backs (or marks them UNVERIFIED)`, () => {
    const { missing } = unbackedCites(f)
    expect(missing).toEqual([])
  })
}
