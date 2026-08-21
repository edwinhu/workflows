/**
 * `plansDirectory` is HONOURED, and by exactly one resolver.
 *
 * Plan mode writes the approved plan wherever `plansDirectory` says. Every consumer that looked
 * for `.claude/plans` instead found nothing when the setting was custom, and
 * `authenticatedWritingPlan()` returning null is indistinguishable from "no approved plan" — the
 * silence that cannot be told from a pass. These pin the resolution rules and the single
 * convention: no second hardcoded copy of the default path.
 *
 * Run: bun test tests/plans-dir.test.ts
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePlansDir } from '../hooks/lib/plans-dir.ts'
import { authenticatedWritingPlan } from '../hooks/lib/writing-plan-context.ts'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TMP = mkdtempSync(join(tmpdir(), 'plans-dir-test-'))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

function root(name: string): string {
  const dir = join(TMP, name)
  mkdirSync(join(dir, '.claude'), { recursive: true })
  return dir
}

function settings(dir: string, body: string, file = 'settings.json') {
  writeFileSync(join(dir, '.claude', file), body)
}

/** An armed craft WRITING plan (dispatch block + Writing Intent) at `path`. */
function plantWritingPlan(path: string, domain = 'legal') {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    `# plan\n\n<!-- craft:dispatch {"runId":"r","args":{"goal":"g"}} -->\n\n` +
      `## Writing Intent\n\n- Domain: ${domain}\n\n## Source Plan\n\n- Notebook: none\n`,
  )
}

describe('resolvePlansDir', () => {
  test('falls back to .claude/plans when nothing declares it', () => {
    const dir = root('unset')
    expect(resolvePlansDir(dir)).toBe(join(dir, '.claude', 'plans'))
  })

  test('honours a project-relative value, resolved from the project root', () => {
    const dir = root('relative')
    settings(dir, JSON.stringify({ plansDirectory: './.planning' }))
    expect(resolvePlansDir(dir)).toBe(join(dir, '.planning'))
  })

  test('honours an absolute value as written', () => {
    const dir = root('absolute')
    settings(dir, JSON.stringify({ plansDirectory: '/srv/plans' }))
    expect(resolvePlansDir(dir)).toBe('/srv/plans')
  })

  test('expands a ~-relative value against the home directory', () => {
    const dir = root('tilde')
    settings(dir, JSON.stringify({ plansDirectory: '~/my-plans' }))
    expect(resolvePlansDir(dir)).toBe(join(homedir(), 'my-plans'))
  })

  test('settings.local.json beats settings.json — Claude Code precedence', () => {
    const dir = root('precedence')
    settings(dir, JSON.stringify({ plansDirectory: './shared' }))
    settings(dir, JSON.stringify({ plansDirectory: './local' }), 'settings.local.json')
    expect(resolvePlansDir(dir)).toBe(join(dir, 'local'))
  })

  test('a malformed settings file falls back — a parse failure never throws out of a hook', () => {
    const dir = root('malformed')
    settings(dir, '{ NOT JSON')
    expect(() => resolvePlansDir(dir)).not.toThrow()
    expect(resolvePlansDir(dir)).toBe(join(dir, '.claude', 'plans'))
  })

  test('an empty or non-string value is treated as unset', () => {
    const blank = root('blank')
    settings(blank, JSON.stringify({ plansDirectory: '   ' }))
    expect(resolvePlansDir(blank)).toBe(join(blank, '.claude', 'plans'))
    const typed = root('mistyped')
    settings(typed, JSON.stringify({ plansDirectory: 42 }))
    expect(resolvePlansDir(typed)).toBe(join(typed, '.claude', 'plans'))
  })
})

describe('authenticatedWritingPlan follows plansDirectory', () => {
  test('finds the armed writing plan in a custom plansDirectory', () => {
    const dir = root('writing-custom')
    settings(dir, JSON.stringify({ plansDirectory: './.planning' }))
    plantWritingPlan(join(dir, '.planning', 'p.md'), 'legal')
    const found = authenticatedWritingPlan(join(dir, 'draft.md'))
    expect(found?.planPath).toBe(join(dir, '.planning', 'p.md'))
    expect(found?.projectRoot).toBe(dir)
    expect(found?.style).toBe('legal')
  })

  test('still finds it at the default path when the setting is unset', () => {
    const dir = root('writing-default')
    settings(dir, JSON.stringify({ someOtherKey: true }))
    plantWritingPlan(join(dir, '.claude', 'plans', 'p.md'))
    expect(authenticatedWritingPlan(join(dir, 'draft.md'))?.planPath).toBe(
      join(dir, '.claude', 'plans', 'p.md'),
    )
  })

  test('a plan left at the default path is NOT found once plansDirectory moves', () => {
    const dir = root('writing-moved')
    settings(dir, JSON.stringify({ plansDirectory: './.planning' }))
    mkdirSync(join(dir, '.planning'), { recursive: true })
    plantWritingPlan(join(dir, '.claude', 'plans', 'p.md'))
    expect(authenticatedWritingPlan(join(dir, 'draft.md'))).toBeNull()
  })
})

describe('one resolver, not two conventions', () => {
  /** Every .ts/.sh/.mjs file under hooks/ and scripts/, recursively. */
  function sources(dir: string): string[] {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (name === '__pycache__' || name === 'node_modules') continue
        out.push(...sources(path))
      } else if (/\.(ts|sh|mjs)$/.test(name) && !name.endsWith('.test.ts')) {
        out.push(path)
      }
    }
    return out
  }

  // The resolver is the one place that spells the default. Anything else naming `.claude/plans`
  // — in code OR in a message that tells a reader where to look — is a second convention.
  const ALLOWED = new Set([join(ROOT, 'hooks/lib/plans-dir.ts')])

  test('no file under hooks/ or scripts/ hardcodes the plans path outside the resolver', () => {
    const offenders: string[] = []
    for (const path of [...sources(join(ROOT, 'hooks')), ...sources(join(ROOT, 'scripts'))]) {
      if (ALLOWED.has(path)) continue
      const text = readFileSync(path, 'utf8')
      const lines = text.split('\n')
      lines.forEach((line, i) => {
        if (/\.claude\/plans|["']\.claude["']\s*,\s*["']plans["']/.test(line)) {
          offenders.push(`${path}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  test('session-start.ts mentions the default only in prose, never as a joined path', () => {
    const text = readFileSync(join(ROOT, 'hooks/session-start.ts'), 'utf8')
    expect(/["']\.claude["']\s*,\s*["']plans["']/.test(text)).toBe(false)
  })
})
