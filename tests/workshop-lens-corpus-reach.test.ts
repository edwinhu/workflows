// The workshop lens (workshop-reviewer) must reach the deck-rules BODIES through refs, so item 6 does not
// grade a corpus the lens only claims to hold. Refs name every rule `typst-rules slides,notes,workshop` lists.
import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const skill = readFileSync(join(ROOT, 'skills', 'workshop', 'SKILL.md'), 'utf8')
const reviewer = readFileSync(join(ROOT, 'user-agents', 'workshop-reviewer.md'), 'utf8')
const lens = skill.slice(skill.indexOf('  lens: {'), skill.indexOf('  authorityExtra: ['))
const refs = [...lens.matchAll(/\$\{typstRules\}\/([\w-]+\.md)/g)].map((m) => m[1])

function typstRoot(): string {
  try {
    const r = execFileSync('typst-plugin-root', [], { encoding: 'utf8', timeout: 3_000 }).trim()
    if (r) return r
  } catch { /* fall through */ }
  return join(process.env.HOME!, '.claude/skills/typst')
}

test('the lens refs carry every rule body the deck-rules index lists', () => {
  const index = execFileSync('typst-rules', ['slides,notes,workshop'], { encoding: 'utf8', timeout: 3_000 })
  const names = [...index.matchAll(/`([^`]+\.md)`/g)].map((m) => basename(m[1]))
  expect(names.length).toBeGreaterThan(0)
  for (const n of names) expect(refs).toContain(n)
})

const TYPST = typstRoot()

test('every lens ref resolves to a corpus file', () => {
  for (const f of refs) expect(existsSync(join(TYPST, 'rules', f))).toBe(true)
})

test('item 6 grades against the refs and draws MODULES CONSIDERED from them', () => {
  const item6 = lens.slice(lens.indexOf('(6) DECK CONSTRAINTS'), lens.indexOf('(6) DECK CONSTRAINTS') + 900)
  expect(item6).toMatch(/refs/)
  expect(item6).not.toMatch(/in your context/)
})

test('the reviewer example names only real modules, marked illustrative', () => {
  const line = reviewer.match(/MODULES CONSIDERED: (.*)/)![1]
  const ex = line.split(/\s+\(/)[0].split(/,\s*/).map((s) => s.replace(/\W+$/, '').trim()).filter(Boolean)
  for (const n of ex) expect(existsSync(join(TYPST, 'rules', `${n}.md`))).toBe(true)
  expect(reviewer).toMatch(/illustrative/i)
})

test('no count-equality acceptanceCmd and no stated check count in the authority', () => {
  expect(skill).not.toMatch(/acceptanceCmd:[^\n]*grep -c/)
  expect(skill).not.toMatch(/all \w+ checks/)
})
