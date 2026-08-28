#!/usr/bin/env bun
/**
 * dev-lens-contract.test.ts — the dev template's lens set and its per-task authority.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/dev-lens-contract.test.ts
 *
 * The tests LENS is retired: four mechanical shapes it used to catch late are now computed before
 * dispatch, and the eleven Warning Signs it cannot mechanise are better spent shaping tests as they
 * are written than judging them after they exist. So the vendored writing-good-tests.md moves into
 * the per-task refs and authorityExtra, where every implementer reads it before writing a test.
 *
 * NOTHING HERE READS `git show HEAD:` — deliberately. An earlier draft took its baseline from HEAD
 * and asserted the baseline still shipped a tests lens; that holds only while the change is
 * uncommitted, so the suite would have gone permanently red on the first commit and taken the whole
 * craft mechanical check (`bun test .../skills/craft/scripts/`) with it. A suite whose verdict
 * depends on whether the tree has been committed is not a contract.
 *
 * Non-vacuity is proved instead by MUTATION: the same parser is run over a synthetic template that
 * still carries a tests lens, and must report it. A parser that silently found nothing would fail
 * that test, so "no tests lens remains" cannot pass by accident.
 *
 * skills/dev/SKILL.md is context-loaded on EVERY dev invocation, so every line is a recurring token
 * cost paid by every agent. The ceiling below is absolute rather than HEAD-relative for the same
 * reason: a budget measured against a moving baseline is not a budget.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..', '..')
const SKILL = join(REPO, 'skills/dev/SKILL.md')
const now = readFileSync(SKILL, 'utf8')

const DOC = 'writing-good-tests.md'
const SURVIVING = ['criteria-vs-artifacts', 'scope-fidelity', 'security', 'performance']

/**
 * The template was 232 lines when the tests lens came out and 233 when this landed. The ceiling is
 * headroom for ordinary edits, not licence for a new section: every line here is re-read by every
 * agent on every dev invocation.
 */
const LINE_CEILING = 240

/** The `reviewLenses: [ … ]` array of the shipped args block, brace-balanced rather than line-guessed. */
function lensEntries(md: string): { key: string; text: string }[] {
  const start = md.indexOf('reviewLenses: [')
  if (start < 0) throw new Error('the dev template ships no reviewLenses array')
  const out: { key: string; text: string }[] = []
  let i = start
  for (;;) {
    const open = md.indexOf('{ key:', i)
    if (open < 0) break
    let depth = 0, end = open
    for (; end < md.length; end++) {
      if (md[end] === '{') depth++
      else if (md[end] === '}') { depth--; if (depth === 0) { end++; break } }
    }
    const text = md.slice(open, end)
    const key = /\{ key: "([^"]+)"/.exec(text)?.[1]
    if (!key) break
    out.push({ key, text })
    i = end
    const nextOpen = md.indexOf('{ key:', i)
    const close = md.indexOf('\n  ],', i)
    if (close >= 0 && (nextOpen < 0 || close < nextOpen)) break
  }
  return out
}

/** Everything between `tasks: [` and the array's close — where a per-task `refs` lives. */
function tasksBlock(md: string): string {
  const start = md.indexOf('tasks: [')
  expect(start).toBeGreaterThan(-1)
  const end = md.indexOf('\n  ],', start)
  expect(end).toBeGreaterThan(start)
  return md.slice(start, end)
}

function authorityExtra(md: string): string {
  const start = md.indexOf('authorityExtra: [')
  expect(start).toBeGreaterThan(-1)
  const end = md.indexOf('].join(', start)
  expect(end).toBeGreaterThan(start)
  return md.slice(start, end)
}

/** The shipped template with a tests lens spliced back in — the mutation these tests must detect. */
function withTestsLens(md: string): string {
  const anchor = '  ],\n\n  authorityExtra: ['
  expect(md).toContain(anchor)
  return md.replace(anchor,
    '\n    { key: "tests",\n      agentType: "Explore",\n      refs: [],\n' +
    '      prompt: "Judge only the tests covering this change." },\n' + anchor)
}

describe('the tests lens is retired', () => {
  test('no reviewLenses entry with key `tests` remains', () => {
    expect(lensEntries(now).map(l => l.key)).not.toContain('tests')
  })

  test('MUTATION: the same parser DOES report a tests lens when one is present', () => {
    // Without this, "not.toContain('tests')" would pass just as well against a parser that
    // returned an empty array for every input.
    const keys = lensEntries(withTestsLens(now)).map(l => l.key)
    expect(keys).toContain('tests')
    expect(keys).toEqual([...SURVIVING, 'tests'])
  })

  test('exactly the four surviving lenses ship, in order', () => {
    expect(lensEntries(now).map(l => l.key)).toEqual(SURVIVING)
  })

  test('each surviving lens still carries the agentType, refs and prompt craft needs', () => {
    for (const l of lensEntries(now)) {
      expect(l.text).toContain('agentType: "Explore"')
      expect(l.text).toMatch(/refs: \[/)
      expect(l.text).toMatch(/prompt: "/)
      expect(l.text).toMatch(/Severity: /)
    }
  })
})

describe('the vendored doc is read by the agents that write the tests', () => {
  test('it is a per-task ref, so every implementer is handed it before writing a test', () => {
    const block = tasksBlock(now)
    expect(block).toContain(DOC)
    expect(/refs: \[[^\]]*writing-good-tests\.md/s.test(block)).toBe(true)
  })

  test('it is named in authorityExtra, which is the text no agent can decline to read', () => {
    expect(authorityExtra(now)).toContain(DOC)
  })

  test('the ref points at a file that exists and carries the Warning Signs the rules do not mechanise', () => {
    const cited = /\$\{CLAUDE_PLUGIN_ROOT\}\/(\S*writing-good-tests\.md)/.exec(now)?.[1]
    expect(cited).toBeDefined()
    const doc = readFileSync(join(REPO, cited!), 'utf8')
    expect(doc).toContain('Warning Signs')
    expect(doc).toContain('Mutation Check')
  })
})

describe('the file that every dev invocation loads stays small', () => {
  test(`no more than ${LINE_CEILING} lines`, () => {
    expect(now.split('\n').length).toBeLessThanOrEqual(LINE_CEILING)
  })
})
