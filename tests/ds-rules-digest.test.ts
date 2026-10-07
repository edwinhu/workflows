// The ds-rules skill is a digest DERIVED from skills/ds/rules/*.md and the rules/ files they
// index, and it is what the ds agents carry in context. A rule edit that is not regenerated leaves
// every agent obeying the old text with nothing to say so — so staleness is a test failure.
import { test, expect } from 'bun:test'
import { readFileSync, cpSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { generate, indexEntries } from '../skills/ds-rules/scripts/gen-digest.ts'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()

const ROOT = join(import.meta.dir, '..')
const SKILL = join(ROOT, 'skills', 'ds-rules', 'SKILL.md')

test('committed ds-rules digest equals a fresh generation', () => {
  expect(readFileSync(SKILL, 'utf8')).toBe(generate())
})

test('the digest carries every indexed id, each with a rule statement', () => {
  const ids = indexEntries().map(e => e.id)
  expect(ids.length).toBe(28)
  for (const p of ['C', 'V', 'A', 'E']) expect(ids.some(i => i.startsWith(p))).toBe(true)
  const digest = readFileSync(SKILL, 'utf8')
  for (const id of ids) {
    const body = digest.split(new RegExp(`^### ${id} — .*$`, 'm'))[1]?.split(/^### /m)[0] ?? ''
    expect(body.replace(/^_.*_ \(`.*`\)$/m, '').trim().length).toBeGreaterThan(40)
  }
})

test('--check fails when a canonical rule file changes', () => {
  const tmp = mkTmp('ds-rules-digest-')
  for (const d of ['skills/ds/rules', 'skills/ds-rules', 'rules']) cpSync(join(ROOT, d), join(tmp, d), { recursive: true })
  const run = () => spawnSync('bun', [join(tmp, 'skills/ds-rules/scripts/gen-digest.ts'), '--check'], { encoding: 'utf8', timeout: 30_000 })
  expect(run().status).toBe(0)
  const rule = join(tmp, 'rules', 'ds-se-matching.md')
  writeFileSync(rule, readFileSync(rule, 'utf8').replace('Match SE specification', 'Match the SE specification'))
  const stale = run()
  expect(stale.status).toBe(1)
  expect(stale.stderr).toContain('STALE')
})
