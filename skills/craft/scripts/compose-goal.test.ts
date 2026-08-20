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

function compose(args: { plan?: string; runDir?: string; rounds?: string; readOnly?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'compose-goal-'))
  scratch.push(dir)
  const argv = [
    SCRIPT,
    args.plan ?? '/p/plan.md',
    args.runDir ?? join(dir, 'run'),
    args.rounds ?? '9',
    args.readOnly ? '1' : '0',
  ]
  try {
    return { code: 0, out: execFileSync('bash', argv, { encoding: 'utf8' }).trim() }
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
    expect(out).toMatch(/review gate|human review/i)
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
  test('the emitted goal names craft-elapsed.sh and an hours ceiling', () => {
    const r = compose({ rounds: '4' })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/craft-elapsed\.sh/)
    expect(r.out).toMatch(/8 hours or more/)
  })

  test('a readOnly goal carries it too', () => {
    expect(compose({ readOnly: true }).out).toMatch(/craft-elapsed\.sh/)
  })

  test('the rounds escape survives alongside it', () => {
    const out = compose({ rounds: '4' }).out
    expect(out).toMatch(/reads 4 or more/)
  })
})
