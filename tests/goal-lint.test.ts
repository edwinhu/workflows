import { describe, expect, test } from 'bun:test'
import { lint } from '../skills/goal-writing/scripts/goal-lint'

/**
 * The corpus is the three goals that actually stalled on the night of 2026-08-27/28, plus the goal
 * `compose-goal.sh` emits. A rule that does not fire on a real stall, or that fires on the
 * reference implementation, is not a rule this repo can afford.
 */

const rules = (t: string, unattended = false, brief = false) =>
  lint(t, unattended, brief).map((f) => f.rule)

const COMPOSED =
  'craft has returned PASS for /p/plan.md — `bash /s/craft-result.sh /r/result.json` exits 0 — ' +
  'or the rounds field in /r/args.json reads 5 or more — `jq -r .rounds` it to check — or the run ' +
  'has been going 480 minutes or more, which `bash /s/craft-elapsed.sh /r 480` prints and settles'

describe('the goal compose-goal.sh emits', () => {
  test('is clean, so the lint cannot be at war with the reference implementation', () => {
    expect(lint(COMPOSED, false)).toEqual([])
  })
})

describe('the three goals that stalled', () => {
  test('npx-reconcile: a verdict is a milestone, and it closed on a hard FAIL', () => {
    // Cost: 4h10m, 2026-08-27 02:42 local.
    expect(rules('craft has returned a verdict for .planning/npx-iss-reconciliation.md')).toContain(
      'G1',
    )
  })

  test('the review-loop template names a human gate and counts turns', () => {
    const r = rules(
      'workflow.js has returned PASS for .claude/plans/slug.md at its current hash, and the ' +
        'tuicr gate has returned approved, or stop after N turns',
    )
    expect(r).toContain('G2') // human-only clause — measured 18h on 2026-08-22
    expect(r).toContain('G3') // nothing counts turns
  })

  test('"when done or blocked, notify" makes a hard fixture terminal', () => {
    // Cost: 5h07m, 2026-08-28 01:42 local, with 10 of 15 rounds unspent.
    expect(rules('Carry out the brief. When done or blocked, notify the spawning session.')).toContain(
      'G9',
    )
  })

  test('an unattended goal with no standing authority and no continuation is flagged', () => {
    // mail-bridge held three green commits overnight because nothing said it could push.
    const r = rules(COMPOSED, true)
    expect(r).toContain('G10')
    expect(r).toContain('G11')
  })
})

describe('the remaining rules', () => {
  test('G4/G5/G6: a bare sentence has no check, no ceiling and no counter', () => {
    const r = rules('the parser has been made better')
    expect(r).toContain('G4')
    expect(r).toContain('G5')
    expect(r).toContain('G6')
  })

  test('G7: an adjective where a number belongs', () => {
    expect(rules('the pipeline works correctly')).toContain('G7')
  })

  test('G7 stands down once a number with a denominator is present', () => {
    expect(rules('the pipeline works on 31902 of 31902 filings')).not.toContain('G7')
  })

  test('G8: a goal may not contain a question, but a brief may', () => {
    expect(rules('is the parser right?')).toContain('G8')
    expect(rules('is the parser right?', false, true)).not.toContain('G8')
  })

  test('G0: an empty goal is the only finding', () => {
    expect(rules('   ')).toEqual(['G0'])
  })
})

describe('the rewrites in references/templates.md', () => {
  const REWRITES = [
    // 1 — npx-reconcile, with the FAIL branch pre-decided
    'craft has returned PASS for .planning/npx-iss-reconciliation.md — `bash craft-result.sh ' +
      'r/result.json` exits 0 — or the rounds field in r/args.json reads 6 or more — `jq -r .rounds` ' +
      'it to check — or the run has been going 480 minutes or more, which `bash craft-elapsed.sh r ' +
      '480` prints and settles. On FAIL: read the surviving blocking findings, amend the plan, ' +
      're-dispatch — in that order, without asking.',
    // 2 — mail-bridge, with recon landing declared a middle rather than an end
    'the six parked ambiguous operations are settled and no new 504 on an idempotent verb parks — ' +
      '`bun test tests/ambiguous-settlement.test.ts` exits 0 — or the rounds field in ' +
      '.craft/a/args.json reads 4 or more — `jq -r .rounds` it to check — or the run has been going ' +
      '300 minutes or more, which `bash craft-elapsed.sh .craft/a 300` prints and settles. Standing ' +
      'authority: commit and push green work, bump the patch version, and plan the next round ' +
      'yourself. Recon landing is not a stopping point — write the plan and dispatch it in the same turn.',
  ]

  test.each(REWRITES.map((r, i) => [i + 1, r] as const))(
    'rewrite %i passes --unattended, so the skill does not ship advice its own lint rejects',
    (_i, goal) => {
      expect(lint(goal, true)).toEqual([])
    },
  )
})
