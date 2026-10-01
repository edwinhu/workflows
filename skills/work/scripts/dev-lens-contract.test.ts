#!/usr/bin/env bun
/**
 * dev-lens-contract.test.ts — the dev template's ONE lens and its per-task authority.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/dev-lens-contract.test.ts
 *
 * `work` takes ONE `lens`, so the four dimensions dev declared as four parallel `reviewLenses`
 * entries are a CHECKLIST inside one prompt. What survived is what each of those four judged, not
 * the array that carried them: criteria, scope, security and performance are each asked for BY NAME,
 * and a dimension dropped out of the prompt is a review nobody runs.
 *
 * NOTHING HERE READS `git show HEAD:` — deliberately. An earlier draft took its baseline from HEAD
 * and asserted the baseline still shipped a tests lens; that holds only while the change is
 * uncommitted, so the suite would have gone permanently red on the first commit and taken the whole
 * work mechanical check (`bun test .../skills/work/scripts/`) with it. A suite whose verdict
 * depends on whether the tree has been committed is not a contract. (That sentence is cited by
 * line number in docs/investigations/2026-08-27_suite-lint-false-positives.md, so it stays put.)
 *
 * The tests LENS stays retired: four mechanical shapes it used to catch late are computed before
 * dispatch, and the eleven Warning Signs it cannot mechanise are better spent shaping tests as they
 * are written than judging them after they exist. So the vendored writing-good-tests.md lives in the
 * per-task refs and authorityExtra, where every implementer reads it before writing a test.
 *
 * Non-vacuity is proved instead by MUTATION: the same parsers are run over synthetic templates that
 * still carry the old `reviewLenses` array, or that drop a checklist dimension, and must report
 * them. A parser that silently found nothing would fail those tests, so "the array is gone" and
 * "all four dimensions are asked for" cannot pass by accident.
 *
 * skills/dev/SKILL.md is context-loaded on EVERY dev invocation, so every line is a recurring token
 * cost paid by every agent. The ceiling below is absolute rather than HEAD-relative for the same
 * reason: a budget measured against a moving baseline is not a budget.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseLenses } from '../../plugin-creator/scripts/pc-probe.ts'

const REPO = join(import.meta.dir, '..', '..', '..')
const SKILL = join(REPO, 'skills/dev/SKILL.md')
const now = readFileSync(SKILL, 'utf8')

const DOC = 'writing-good-tests.md'

/**
 * The checklist dimensions the four retired lenses judged. Each must be asked for BY NAME in the one
 * prompt — the words are the contract, because a dimension that is not named is not judged.
 */
const DIMENSIONS = ['CRITERIA', 'SCOPE', 'SECURITY', 'PERFORMANCE'] as const

/**
 * The template was 232 lines when the tests lens came out, 233 when that landed, and 223 once four
 * lenses collapsed into one. The ceiling is headroom for ordinary edits, not licence for a new
 * section: every line here is re-read by every agent on every dev invocation.
 */
const LINE_CEILING = 232

/** Use the same fenced-code parser the agent and plugin contracts exercise. */
const declaredLenses = (md: string) => parseLenses(SKILL, md, REPO)

/** Keys of a `reviewLenses: [{ key: "…" }]` array — the retired shape, detected so it cannot return. */
function retiredLensKeys(md: string): string[] {
  const start = md.indexOf('reviewLenses: [')
  if (start < 0) return []
  const end = md.indexOf('\n  ],', start)
  const body = md.slice(start, end < 0 ? md.length : end)
  return [...body.matchAll(/\{\s*key:\s*"([^"]+)"/g)].map(m => m[1])
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

/** The shipped template with the retired array spliced back in — the mutation these tests must detect. */
function withReviewLensesArray(md: string): string {
  const anchor = '  authorityExtra: ['
  expect(md).toContain(anchor)
  return md.replace(anchor,
    '  reviewLenses: [\n    { key: "security",\n      agentType: "Explore",\n      refs: [],\n' +
    '      prompt: "Judge only the security of the changed code." },\n  ],\n\n' + anchor)
}

describe('dev declares exactly ONE lens', () => {
  test('the shipped template carries exactly one `lens` object', () => {
    expect(declaredLenses(now)).toHaveLength(1)
  })

  test('MUTATION: a second lens is detected', () => {
    const duplicate = now.replace('  authorityExtra: [',
      '  lens: { agentType: "Explore", refs: [], prompt: "extra dimension" },\n\n  authorityExtra: [')
    expect(declaredLenses(duplicate)).toHaveLength(2)
  })

  test('no `reviewLenses` array remains', () => {
    expect(now).not.toContain('reviewLenses')
    expect(retiredLensKeys(now)).toEqual([])
  })

  test('MUTATION: the same parser DOES report a reviewLenses array when one is present', () => {
    // Without this, `toEqual([])` would pass just as well against a parser that returned an empty
    // array for every input.
    expect(retiredLensKeys(withReviewLensesArray(now))).toEqual(['security'])
  })

  test('the lens carries the agentType, refs and prompt `work` needs', () => {
    const lens = declaredLenses(now)[0]!
    expect(lens.agentType).toBe('Explore')
    expect(lens.refs).not.toBe('')
    expect(lens.prompt).toContain('Severity')
  })

  test('a brace inside the prompt does not truncate the lens object', () => {
    const fixture = '```js\n  lens: {\n    prompt: "route it to {taskId} or \'plan\'",\n    agentType: "Explore",\n  },\n```\n'
    expect(declaredLenses(fixture)[0]?.agentType).toBe('Explore')
  })
})

describe('the one prompt still asks for all four retired dimensions', () => {
  const lens = declaredLenses(now)[0]!

  for (const dim of DIMENSIONS) {
    test(`the checklist names ${dim}`, () => {
      expect(lens.prompt).toContain(dim)
    })
  }

  test('MUTATION: dropping a dimension from the prompt is detectable', () => {
    for (const dim of DIMENSIONS) {
      const mutated = now.replace(lens.prompt, lens.prompt.split(dim).join(''))
      expect(declaredLenses(mutated)[0]?.prompt).not.toContain(dim)
    }
  })

  test('both per-dimension reference files are refs of the one lens', () => {
    for (const ref of ['lens-security.md', 'lens-performance.md']) {
      expect(lens.refs).toContain(ref)
      expect(readFileSync(join(REPO, 'skills/dev/references', ref), 'utf8').length).toBeGreaterThan(0)
    }
  })

  test('both review modes state their outputs and carried-finding rulings', () => {
    expect(lens.prompt).toMatch(/RED.*diagnose EVERY failure.*route it.*task id.*'plan'/)
    expect(lens.prompt).toMatch(/GREEN.*open-ended pass.*ownerTask/)
    expect(lens.prompt).toMatch(/carried finding open or closed.*evidence/)
  })

  test('no `tests` dimension came back with the merge', () => {
    expect(lens.prompt).not.toMatch(/\bTESTS\b/)
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
