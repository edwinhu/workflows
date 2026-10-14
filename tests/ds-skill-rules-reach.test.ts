// The ds lens (ds-reviewer: no Skill tool) and implementer must reach rule BODIES without depending on a
// preload alone: the lens through refs, the implementer through a Skill(ds-rules) fallback.
import { expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const skill = readFileSync(join(ROOT, 'skills', 'ds', 'SKILL.md'), 'utf8')
const lens = skill.slice(skill.indexOf('  lens: {'), skill.indexOf('  authorityExtra: ['))
const authority = skill.slice(skill.indexOf('  authorityExtra: ['), skill.indexOf('  implementerAgentType'))

test('the lens refs carry the rule bodies its checklist grades', () => {
  const refs = [...lens.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/rules\/(ds-[\w-]+\.md)/g)].map((m) => m[1])
  for (const body of ['ds-se-matching.md', 'ds-join-diagnostics.md', 'ds-p-hacking-prevention.md', 'ds-sample-selection.md'])
    expect(refs).toContain(body)
  for (const f of refs) expect(existsSync(join(ROOT, 'rules', f))).toBe(true)
})

test('the lens prompt does not assert a preload the lens has no tool to fall back from', () => {
  expect(lens).not.toMatch(/preloaded/i)
})

test('the implementer authority tells it to invoke Skill(ds-rules) when the digest is absent', () => {
  expect(authority).toMatch(/Skill\(ds-rules\)/)
})

test('DQ4/DQ6 are described as FAIL on an absent output, not "always N/A"', () => {
  expect(skill).not.toMatch(/always N\/A/)
})

test('lens item (5) excludes the ids item (3) reserves for jev-rules and the ids a constraints checker decides', () => {
  const item3 = lens.slice(lens.indexOf('(3) DATA-QUALITY'), lens.indexOf('(4) METHODOLOGY'))
  const item5 = lens.slice(lens.indexOf('(5) DS-CONSTRAINTS'), lens.indexOf('Severity across'))
  const wired = readdirSync(join(ROOT, 'checks/ds/rules')).filter((f) => /^[^_.].*\.py$/.test(f)).map((f) => f.replace(/\.py$/, ''))
  const named = item3.slice(item3.indexOf('A1, A4'), item3.indexOf('are the jev-rules verdicts')).split(/,\s*|\s+and\s+/).map((s) => s.trim())
  expect(named.sort()).toEqual(wired.sort())
  expect(item5).toMatch(/except the ids item \(3\)/)
  expect(item5).toMatch(/checks\/ds\/constraints\//)
})
