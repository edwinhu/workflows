import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * A goal decides whether to continue; a loop guarantees something asks. `goal-self-send.sh` is the
 * only transport that can type into our own pane, so it is also the only way a craft dispatch can
 * raise the heartbeat — but it hard-rejected anything that was not `/goal ...`.
 *
 * Same session-id discipline as the lint-gate suite: unset (exit 4) and set-but-unreachable
 * (exit 3) are the two ways identification can end. Reaching either proves the argument was
 * ACCEPTED, and neither value can address a live session, so nothing here types into a real pane.
 */

const REPO = join(import.meta.dir, '..')
const SEND = join(REPO, 'skills/craft/scripts/goal-self-send.sh')
const UNREACHABLE = 'self-send-loop-test-not-a-real-session'

const send = (arg: string) =>
  spawnSync(SEND, [arg], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: UNREACHABLE },
  })

const ACCEPTED = [3, 4, 5, 6] // got past argument validation to a transport outcome
const REJECTED = 2            // argument validation refused it

describe('goal-self-send accepts a /loop line', () => {
  test('a well-formed /loop is accepted, not rejected as a bad argument', () => {
    const r = send('/loop 30m Check the goal. If it is not met, take the next action now.')
    expect(r.status).not.toBe(REJECTED)
    expect(ACCEPTED).toContain(r.status as number)
  })

  test('an empty /loop body is still refused', () => {
    expect(send('/loop ').status).toBe(REJECTED)
  })

  test('a non-goal non-loop slash command is still refused', () => {
    expect(send('/clear').status).toBe(REJECTED)
  })

  test('/goal is unaffected', () => {
    const r = send('/goal `x` exits 0, or 720 minutes elapse; rounds in a.json reads 6 or more. You may commit without asking. When a run returns, take the next action; keep going until the ceiling.')
    expect(r.status).not.toBe(REJECTED)
  })

  test('the loop line is NOT sent through the goal lint', () => {
    // goal-lint would flag a bare imperative with no ceiling/counter; a loop prompt is not a goal.
    const r = send('/loop 30m keep working')
    expect(r.status).not.toBe(8)
    expect(r.status).not.toBe(REJECTED)
  })
})
