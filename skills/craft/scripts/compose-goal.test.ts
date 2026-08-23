/**
 * compose-goal.sh — the /goal line craft self-sends, built so every clause is DECIDABLE.
 *
 * Two defects it fixes, both measured on a live episode that could not close its own goal:
 *
 *  1. `or stop after N turns` was prose and nothing counted turns. /goal installs a Stop hook judged
 *     by a model reading the transcript; no num_turns / turn_count exists anywhere. The judge found
 *     the clause satisfied on four consecutive evaluations and reasoned out of each, ending at the
 *     position that stopping DELIBERATELY disqualifies the escape while losing control would qualify
 *     — a condition that releases on runaway but not on a clean finish. The escape now names a
 *     ROUND COUNTER FILE, so the check is a `cat` whose output lands in the transcript as evidence.
 *
 *  2. `workflow.js has returned PASS ... at its current hash` is unsatisfiable after success. Craft
 *     fails any task whose redCommand is green at baseline (red-not-red), so a completed plan's
 *     gates are all green by construction and a re-run flags every task. The episode ended at
 *     redNotRed: 5. The goal now names the terminal HUMAN event — the review gate's verdict — which
 *     stays reachable once the work is done.
 *
 * Run: bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/compose-goal.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = `${import.meta.dir}/compose-goal.sh`
const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

function compose(
  args: {
    plan?: string
    runDir?: string
    rounds?: string
    readOnly?: boolean
    reversal?: string
    delivery?: string
    env?: Record<string, string>
  } = {}
) {
  const dir = mkdtempSync(join(tmpdir(), 'compose-goal-'))
  scratch.push(dir)
  const argv = [
    SCRIPT,
    args.plan ?? '/p/plan.md',
    args.runDir ?? join(dir, 'run'),
    args.rounds ?? '9',
    args.readOnly ? '1' : '0',
    ...(args.extra ?? []),
  ]
  // Positional and optional: a caller that declares neither field gets the pre-existing 4-arg form.
  if (args.reversal !== undefined || args.delivery !== undefined)
    argv.push(args.reversal ?? '', args.delivery ?? '')
  try {
    return {
      code: 0,
      out: execFileSync('bash', argv, {
        encoding: 'utf8',
        env: { ...process.env, ...(args.env ?? {}) },
      }).trim(),
    }
  } catch (e: any) {
    return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

describe('compose-goal.sh', () => {
  test('emits a /goal line naming the plan', () => {
    const r = compose({ plan: '/p/my-plan.md' })
    expect(r.code).toBe(0)
    expect(r.out.startsWith('/goal ')).toBe(true)
    expect(r.out).toContain('/p/my-plan.md')
  })

  test('the escape clause names the round counter IN args.json — a field, not a new state file', () => {
    const r = compose({ runDir: '/r/abc', rounds: '9' })
    expect(r.out).toContain('/r/abc/args.json')
    expect(r.out).toContain('rounds')
    expect(r.out).toContain('9')
    // The defect: an uncountable turn budget dressed as a limit.
    expect(r.out.toLowerCase()).not.toContain('turns')
  })

  test('the escape tells the reader to READ the counter, so the check is evidence not judgement', () => {
    expect(compose().out.toLowerCase()).toMatch(/\bjq\b|\bread\b/)
  })

  test('a writing run does not name "workflow.js has returned PASS" — unsatisfiable after success', () => {
    const out = compose({ readOnly: false }).out
    expect(out).not.toContain('returned PASS')
    // It names craft's own verdict. It used to name the human review gate; that clause moved to
    // the skill's Phase 5, because a goal must state what a session can close by working.
    expect(out).toMatch(/craft has returned a verdict/)
  })

  test('a readOnly run names a verdict rather than a pass', () => {
    const out = compose({ readOnly: true }).out
    expect(out).not.toContain('returned PASS')
    expect(out).toMatch(/verdict/i)
  })

  test('rejects a non-numeric round budget rather than emitting a goal nobody can check', () => {
    expect(compose({ rounds: 'lots' }).code).not.toBe(0)
  })

  test('requires all four arguments', () => {
    try {
      execFileSync('bash', [SCRIPT, '/p/plan.md'], { encoding: 'utf8' })
      throw new Error('should have failed')
    } catch (e: any) {
      expect(e.status).not.toBe(0)
    }
  })
})

describe('the goal carries a wall-clock escape, not only a round count', () => {
  // Measured 2026-08-19 (mail-bridge): rounds ran 3h+, so `rounds >= 4` put the guaranteed stop
  // twelve hours out. The session worked all night and could not close its own goal.
  test('the emitted goal names craft-elapsed.sh and a minutes ceiling', () => {
    const r = compose({ rounds: '4' })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/craft-elapsed\.sh/)
    expect(r.out).toMatch(/10 minutes or more/)
  })

  // The ceiling bounds WAITING. A session with work left keeps working whatever it says, so a
  // short default costs nothing and buys back the hours a run used to spend on an absent human.
  test('CRAFT_GOAL_MAX_HOURS still settles a goal composed before the switch', () => {
    expect(compose({ rounds: '4', env: { CRAFT_GOAL_MAX_HOURS: '2' } }).out)
      .toMatch(/120 minutes or more/)
  })

  test('a readOnly goal carries it too', () => {
    expect(compose({ readOnly: true }).out).toMatch(/craft-elapsed\.sh/)
  })

  test('the rounds escape survives alongside it', () => {
    const out = compose({ rounds: '4' }).out
    expect(out).toMatch(/reads 4 or more/)
  })
})

/**
 * HUMAN REVIEW IS NOT A GOAL CLAUSE.
 *
 * A goal states what a session can close BY WORKING. A human verdict is not that: it makes the run
 * stoppable only by a person, who may have walked away. Measured 2026-08-22 — a tested, reversible
 * bugfix sat behind that clause for ~18 hours while the mail outage it repaired stayed live, and the
 * clause had been emitted at dispatch, before anyone had seen the diff.
 *
 * Review still happens. It moved to the skill's Phase 5, after the goal clears.
 */
describe('the goal closes on a machine verdict, never on a human', () => {
  test('no composed goal mentions human review', () => {
    expect(compose({ rounds: '4' }).out).not.toMatch(/human review/i)
    expect(compose({ readOnly: true }).out).not.toMatch(/human review/i)
  })

  test('a writing run closes on craft-result.sh exiting 0 or 1 rather than 2', () => {
    const out = compose({ rounds: '4' }).out
    expect(out).toMatch(/craft has returned a verdict/)
    expect(out).toMatch(/craft-result\.sh/)
    // 2 is REFUSED — a gate that could not be adjudicated is not a verdict.
    expect(out).toMatch(/exits 0 or 1 rather than 2/)
  })

  test('a readOnly run still closes on its own verdict', () => {
    expect(compose({ readOnly: true }).out).toMatch(/workflow\.js has returned a verdict/)
  })

  test('both machine escapes survive in either mode', () => {
    for (const out of [compose({ rounds: '4' }).out, compose({ rounds: '4', readOnly: true }).out]) {
      expect(out).toMatch(/reads 4 or more/)
      expect(out).toMatch(/craft-elapsed\.sh/)
    }
  })

  test('the extra positional args the reversibility experiment added are gone', () => {
    const r = compose({ rounds: '4', extra: ['some-reversal', 'some-check'] })
    expect(r.code).not.toBe(0)
  })
})
