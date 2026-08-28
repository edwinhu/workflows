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
 *  2. `workflow.js has returned PASS ... AT ITS CURRENT HASH` was unsatisfiable after success — the
 *     hash clause, not the PASS clause, was the defect: the FAIL loop is expected to amend and
 *     re-hash the plan, so a pinned digest self-invalidates. The reading that PASS itself is
 *     unreachable (red-not-red on a completed plan) was already stale when it was written:
 *     `redDisposition` shipped 2026-08-17 and is what a completed task declares instead of a red
 *     gate. The goal names PASS by PATH, and the round cap stops a run that cannot get there.
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

  test('a writing run names PASS by PATH and never by a pinned hash', () => {
    const out = compose({ readOnly: false }).out
    expect(out).toMatch(/craft has returned PASS/)
    // The hash clause is what self-invalidated: the FAIL loop amends the plan and re-hashes, so a
    // run would PASS against a digest the condition no longer names. The path is stable.
    expect(out).not.toMatch(/at its current hash/)
    expect(out).not.toMatch(/[0-9a-f]{16}/)
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
  test('the default ceiling outlasts a round, so a walked-away run does not stop empty', () => {
    // 12h, raised 2026-08-28 with maxRounds 3 -> 6: maxRounds x a measured round still fits under it.
    const r = compose({ rounds: '4' })
    expect(r.code).toBe(0)
    expect(Number(/(\d+) minutes or more/.exec(r.out)![1])).toBeGreaterThanOrEqual(240)
  })

  test('the emitted goal names craft-elapsed.sh and a minutes ceiling', () => {
    const r = compose({ rounds: '4' })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/craft-elapsed\.sh/)
    expect(r.out).toMatch(/720 minutes or more/)
  })

  // The ceiling must outlast a ROUND, not just a human's attention span. Measured 2026-08-27 in
  // the workflows repo: round 1 of a six-task run took 54 minutes (dispatch 17:29, result.json
  // 18:23) against a 10-minute default, so `craft-elapsed.sh` printed CEILING REACHED with zero
  // rounds on disk and no verdict — the escape written to stop a session waiting on a sleeping
  // human fired five times over before the first round returned anything.
  test('CRAFT_GOAL_MAX_HOURS still settles a goal composed before the switch', () => {
    expect(compose({ rounds: '4', env: { CRAFT_GOAL_MAX_HOURS: '2' } }).out)
      .toMatch(/120 minutes or more/)
  })

  test('the settling command CARRIES the ceiling, so the clause and the script cannot disagree', () => {
    // The number lived in two places: this script's default and craft-elapsed.sh's. They drifted to
    // 480 and 10 — 48x apart — so a goal saying "480 minutes or more" named a script that reports
    // CEILING REACHED at ten. craft-elapsed.sh already takes the ceiling as $2; passing it makes the
    // clause self-describing and the second default a fallback for hand invocation only.
    const out = compose({ rounds: '4' }).out
    const stated = /(\d+) minutes or more/.exec(out)
    expect(stated).not.toBeNull()
    const invocation = /craft-elapsed\.sh (\S+) (\d+)/.exec(out)
    expect(invocation).not.toBeNull()
    expect(`elapsed arg ${invocation![2]}`).toBe(`elapsed arg ${stated![1]}`)
  })

  test('an overridden ceiling reaches the settling command too', () => {
    const out = compose({ rounds: '4', env: { CRAFT_GOAL_MAX_MINUTES: '90' } }).out
    expect(out).toMatch(/90 minutes or more/)
    expect(out).toMatch(/craft-elapsed\.sh \S+ 90/)
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

  test('a writing run closes on PASS, NOT on any verdict — a FAIL keeps the loop turning', () => {
    // Measured 2026-08-27: with `exits 0 or 1`, round 1 FAILING with 8 surviving blocking findings
    // SATISFIED the goal. craft's own diagram is gate FAIL -> fix -> re-run; accepting exit 1 means
    // nothing carries that loop, and the run ends holding a list of defects instead of a fix.
    const out = compose({ rounds: '4' }).out
    expect(out).toMatch(/craft-result\.sh/)
    expect(out).toMatch(/exits 0\b/)
    expect(out).not.toMatch(/exits 0 or 1/)
    // 2 is REFUSED and 1 is FAIL; neither is done. The round cap is what stops a losing run.
    expect(out).not.toMatch(/or 1 rather than 2/)
  })

  test('the round escape names the round budget craft actually enforces', () => {
    // The counter this clause reads is `args.rounds`, incremented per round and hard-stopped at
    // `maxRounds` (craft-redispatch exits 4 beyond it). Composing against anything larger — craft
    // dispatched with goalTurns, 24 against a maxRounds of 3 — makes the clause UNREACHABLE, which
    // is how the 10-minute ceiling became the only escape that ever fired.
    expect(compose({ rounds: '3' }).out).toMatch(/reads 3 or more/)
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
