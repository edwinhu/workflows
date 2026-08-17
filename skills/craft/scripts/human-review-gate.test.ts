/**
 * The review gate's verdict rule — approval must be expressible in words.
 *
 * The gate matched \bREJECT\b in a comment and had no APPROVE counterpart, while ANY comment forced
 * the verdict `findings`. So a reviewer could reject with one word but could not approve with any
 * number of them: measured on a live episode, a human wrote "looks good to me, ship" and then "all
 * good", and both registered as outstanding work, leaving the run unable to close.
 *
 * These drive `review-verdict.py` — the module the gate itself imports, not a copy of its logic. A
 * test over a re-implementation proves the re-implementation works.
 *
 * Run: bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/human-review-gate.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'

const MODULE = `${import.meta.dir}/review-verdict.py`

function verdictFor(comments: string[], reviewed = 0, changesRequested = false) {
  const py = `
from importlib.machinery import SourceFileLoader
rv = SourceFileLoader("rv", ${JSON.stringify(MODULE)}).load_module()
import json, sys
comments = [{"content": c} for c in json.loads(sys.argv[1])]
print(rv.verdict(comments, ${reviewed}, changes_requested=${changesRequested ? 'True' : 'False'}))
`
  return execFileSync('python3', ['-c', py, JSON.stringify(comments)], { encoding: 'utf8' }).trim()
}

describe('review gate verdicts', () => {
  test('a bare REJECT still rejects — precedence unchanged', () => {
    expect(verdictFor(['REJECT this approach'], 1)).toBe('rejected')
  })

  test('APPROVE approves — the asymmetry this fixes', () => {
    expect(verdictFor(['APPROVE — ship it'])).toBe('approved')
  })

  test('LGTM approves', () => {
    expect(verdictFor(['LGTM'])).toBe('approved')
  })

  test('REJECT beats APPROVE in one session — the asymmetric cost decides', () => {
    expect(verdictFor(['APPROVE', 'REJECT the second file'], 1)).toBe('rejected')
  })

  test('a forge CHANGES_REQUESTED still rejects even with an APPROVE comment', () => {
    expect(verdictFor(['APPROVE'], 1, true)).toBe('rejected')
  })

  test('ordinary praise is still findings — approval is explicit, never inferred from tone', () => {
    expect(verdictFor(['looks good to me, ship'])).toBe('findings')
    expect(verdictFor(['all good'])).toBe('findings')
  })

  test('lowercase approve is discussion, not a decision', () => {
    expect(verdictFor(['I would approve this once the tests land'])).toBe('findings')
  })

  test('files marked reviewed with no comments still approves', () => {
    expect(verdictFor([], 2)).toBe('approved')
  })

  test('nothing at all is unreviewed, never approval', () => {
    expect(verdictFor([], 0)).toBe('unreviewed')
  })
})
