import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const REPO = join(import.meta.dir, '..')
import { lint } from '../skills/hound/scripts/heartbeat-lint'

/**
 * The corpus is the three runs that actually stalled on the night of 2026-08-27/28, plus the text
 * `compose-goal.sh` emits — the one string in this repo that is composed rather than typed, and
 * that this lint still gates at the self-send chokepoint. A rule that does not fire on a real
 * stall, or that fires on the reference implementation, is not a rule this repo can afford.
 */

const rules = (t: string, brief = false) => lint(t, brief).map((f) => f.rule)

// DERIVED by running compose-goal.sh, never transcribed. A hardcoded copy drifted from the
// script it claimed to represent: on 2026-09-16 the real emitted text had gained nothing while
// this fixture still described it, and the suite below asserted the MISSING authority and
// continuation as expected behaviour.
const COMPOSED = (() => {
  const d = mkdtempSync(join(tmpdir(), 'gl-'))
  mkdirSync(join(d, 'run'), { recursive: true })
  writeFileSync(join(d, 'plan.md'), '# P\n\n<!-- craft:dispatch\n{"runId":"x","args":{}}\n-->\n')
  const r = spawnSync('bash',
    [join(REPO, 'skills/work/scripts/compose-goal.sh'), join(d, 'plan.md'), join(d, 'run'), '6', '0'],
    { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`compose-goal.sh exited ${r.status} — the reference text could not be built, which is not the same as its being clean`)
  return r.stdout.trim().replace(/^\/goal /, '')
})()

describe('what compose-goal.sh emits', () => {
  test('is clean, so the lint cannot be at war with the reference implementation', () => {
    expect(lint(COMPOSED)).toEqual([])
  })

  test('it carries the teardown, which no shell or hook can perform', () => {
    expect(COMPOSED).toContain('CronDelete')
  })
})

describe('the three runs that stalled', () => {
  test('npx-reconcile: a verdict is a milestone, and it closed on a hard FAIL', () => {
    // Cost: 4h10m, 2026-08-27 02:42 local.
    expect(rules('craft has returned a verdict for .planning/npx-iss-reconciliation.md')).toContain(
      'C1',
    )
  })

  test('the review-loop template names a human gate and counts turns', () => {
    const r = rules(
      'workflow.js has returned PASS for .claude/plans/slug.md at its current hash, and the ' +
        'tuicr gate has returned approved, or stop after N turns',
    )
    expect(r).toContain('C2') // human-only clause — measured 18h on 2026-08-22
    expect(r).toContain('C3') // nothing counts turns; the ceilings are --rounds and --minutes
  })

  test('"when done or blocked, notify" makes a hard fixture terminal', () => {
    // Cost: 5h07m, 2026-08-28 01:42 local, with 10 of 15 rounds unspent.
    expect(rules('Carry out the brief. When done or blocked, notify the spawning session.')).toContain(
      'C7',
    )
  })

  test('no standing authority and no continuation is flagged', () => {
    // mail-bridge held three green commits overnight because nothing said it could push.
    const bare = 'Run `c` and report its exit code. End this heartbeat with CronDelete.'
    const r = rules(bare)
    expect(r).toContain('C8')
    expect(r).toContain('C9')
  })

  // The phrase that let a text with NO continuation pass: the recommended terminal-blockers
  // sentence ends "Everything else is the next task, difficulty included", which is about not
  // filing a difficulty as a blocker and says nothing about budget.
  test('a terminal-blockers sentence does not count as a continuation clause', () => {
    const blockersOnly =
      'Run `c` and report its exit code. You may commit. TERMINAL BLOCKERS: a dead network. ' +
      'Everything else is the next task, difficulty included. End this heartbeat with CronDelete.'
    expect(rules(blockersOnly)).toContain('C9')
  })
})

describe('the remaining rules', () => {
  test('C4: a bare sentence names no command to run', () => {
    expect(rules('the parser has been made better')).toContain('C4')
  })

  test('the escapes are NOT lint rules — they are hound-arm.sh flags the hook enforces', () => {
    // A prompt that restates a ceiling in prose is the bug this rule set refuses to reward.
    const r = rules('Run `bun test` and report its exit code. Take the next action without asking. ' +
                    'End this heartbeat with CronDelete.')
    expect(r).toEqual([])
  })

  test('C5: an adjective where a number belongs', () => {
    expect(rules('the pipeline works correctly')).toContain('C5')
  })

  test('C5 stands down once a number with a denominator is present', () => {
    expect(rules('the pipeline works on 31902 of 31902 filings')).not.toContain('C5')
  })

  test('C6: a tick may not contain a question, but a brief may', () => {
    expect(rules('is the parser right?')).toContain('C6')
    expect(rules('is the parser right?', true)).not.toContain('C6')
  })

  test('C10: no CronDelete is a cron nothing can end', () => {
    expect(rules('Run `c`. Take the next action without asking.')).toContain('C10')
  })

  test('C0: an empty prompt is the only finding', () => {
    expect(rules('   ')).toEqual(['C0'])
  })
})

describe('the cron prompts in references/templates.md', () => {
  const PROMPTS = [
    // 1 — npx-reconcile, with the FAIL branch pre-decided
    'Run `bash skills/work/scripts/work-result.sh .craft/0827-npx-iss/result.json` and report its ' +
      'exit code — judge from the command, not from the conversation. On FAIL: read the surviving ' +
      'blocking findings, amend the plan, re-dispatch — in that order, without asking. The only ' +
      'terminal blockers are a rejected credential or an unreachable grid. End this heartbeat with ' +
      'CronDelete.',
    // 2 — mail-bridge, with recon landing declared a middle rather than an end
    'Run `bun test tests/ambiguous-settlement.test.ts` and report its exit code — judge from the ' +
      'command, not from the conversation. Standing authority: commit and push green work, bump the ' +
      'patch version, and plan the next round yourself. Recon landing is not a stopping point — ' +
      'write the plan and dispatch it in the same turn. End this heartbeat with CronDelete.',
  ]

  test.each(PROMPTS.map((p, i) => [i + 1, p] as const))(
    'prompt %i is clean, so the skill does not ship advice its own lint rejects',
    (_i, prompt) => {
      expect(lint(prompt)).toEqual([])
    },
  )
})
