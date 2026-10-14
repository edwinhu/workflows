// The ds lens (ds-reviewer: no Skill tool) and implementer must reach rule BODIES without depending on a
// preload alone: the lens through refs, the implementer through a Skill(ds-rules) fallback.
import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
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
