import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * `goal-self-send.sh` is the single chokepoint every `/goal` passes through, which is what makes it
 * the place to enforce skills/goal-and-loop rather than merely publish it. These tests pin the gate:
 * a critical finding refuses BEFORE any transport is touched, everything else goes through.
 *
 * The session id is varied deliberately. Unset (exit 4) and set-but-unreachable (exit 3) are the
 * two ways identification can end, and a permitted goal must reach one of them — reaching either is
 * the proof that the lint let it past. Neither value can address a live session, so no test here
 * can type into a real pane.
 */

const REPO = join(import.meta.dir, '..')
const SEND = join(REPO, 'skills/craft/scripts/goal-self-send.sh')
const NO_SESSION = ''
const UNREACHABLE_SESSION = 'goal-lint-gate-test-not-a-real-session'

const send = (arg: string, opts: { sid?: string; flags?: string[] } = {}) => {
  const r = spawnSync(SEND, [arg, ...(opts.flags ?? [])], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: opts.sid ?? NO_SESSION },
  })
  return { code: r.status, err: r.stderr ?? '', out: r.stdout ?? '' }
}

/** Everything the gate lets through lands in one of the identification/transport exits. */
const reachedTransport = (code: number | null) => code === 3 || code === 4

describe('the goal-and-loop gate on self-send', () => {
  test('a milestone goal is refused with 8, and the refusal names the skill to read', () => {
    // The exact goal that closed on a hard FAIL in npx-reconcile, 2026-08-27. Cost: 4h10m.
    const r = send('/goal craft has returned a verdict for .planning/npx-iss-reconciliation.md')
    expect(r.code).toBe(8)
    expect(r.err).toContain('[CRITICAL] G1')
    expect(r.err).toContain('skills/goal-and-loop/SKILL.md')
    // Refused before any transport: no identification error was ever printed.
    expect(r.err).not.toContain('CLAUDE_CODE_SESSION_ID unset')
  })

  test('the refusal is the same with a session id present — the gate runs before identification', () => {
    const r = send('/goal craft has returned a verdict for plan.md', { sid: UNREACHABLE_SESSION })
    expect(r.code).toBe(8)
    expect(r.err).toContain('[CRITICAL] G1')
  })

  test('a human-only clause is refused too', () => {
    const r = send('/goal the tuicr gate has returned approved on the plan')
    expect(r.code).toBe(8)
    expect(r.err).toContain('G2')
  })

  test('--no-lint sends the same goal anyway', () => {
    const r = send('/goal craft has returned a verdict for plan.md', { flags: ['--no-lint'] })
    expect(r.code).not.toBe(8)
    expect(r.err).toContain('CLAUDE_CODE_SESSION_ID unset')
  })

  test('major-only findings warn and go through', () => {
    const r = send('/goal the parser is fixed')
    expect(r.code).not.toBe(8)
    expect(r.err).toContain('[MAJOR]')
    expect(r.err).toContain('sending anyway')
    expect(reachedTransport(r.code)).toBe(true)
  })

  test('"/goal clear" is never linted', () => {
    const r = send('/goal clear', { sid: UNREACHABLE_SESSION })
    expect(r.code).not.toBe(8)
    expect(r.err).not.toContain('[MAJOR]')
    expect(r.err).not.toContain('[CRITICAL]')
    expect(reachedTransport(r.code)).toBe(true)
  })

  test('what compose-goal.sh emits passes silently — craft dispatches are untouched', () => {
    const composed = spawnSync(
      join(REPO, 'skills/craft/scripts/compose-goal.sh'),
      ['/p/plan.md', '/tmp/r', '6', '0'],
      { encoding: 'utf8' },
    )
    expect(composed.status).toBe(0)
    const r = send(composed.stdout.trim(), { sid: UNREACHABLE_SESSION })
    expect(r.code).not.toBe(8)
    expect(r.err).not.toContain('[CRITICAL]')
    expect(r.err).not.toContain('sending anyway')
    expect(reachedTransport(r.code)).toBe(true)
  })

  test('argument validation still runs, and runs first', () => {
    expect(send('not a goal').code).toBe(2)
    expect(send('/goal    ').code).toBe(2)
  })
})
