import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * "Is the goal set?" must be answerable by exit code. It was not, and four self-sends failed
 * silently over three weeks because every available answer was a belief.
 *
 * Both screen-scrape channels were measured and rejected: `pane wait-output` over recent output
 * matched the assistant's OWN PROSE about the string "Goal set:", and Claude Code's `/goal active`
 * chrome renders only in the working spinner, so an idle pane shows nothing either way. The
 * transcript record is the only unforgeable channel, and only when matched at the start of a
 * STRING content field — prose and tool results carry content as a list of blocks.
 */

const REPO = join(import.meta.dir, '..')
const VERIFY = join(REPO, 'skills/goal-and-loop/scripts/goal-verify.sh')
const SID = 'verify-test-session'

function verify(records: unknown[]) {
  const home = mkdtempSync(join(tmpdir(), 'gv-'))
  const dir = join(home, '.claude', 'projects', 'proj')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${SID}.jsonl`), records.map(r => JSON.stringify(r)).join('\n') + '\n')
  return spawnSync('bash', [VERIFY, '--session', SID], {
    encoding: 'utf8', env: { ...process.env, HOME: home },
  })
}

const goalSet = (t: string, ts: string) => ({
  type: 'system', subtype: 'local_command', timestamp: ts,
  content: `<local-command-stdout>Goal set: ${t}</local-command-stdout>`,
})
const goalCleared = (ts: string) => ({
  type: 'system', subtype: 'local_command', timestamp: ts,
  content: '<local-command-stdout>No goal set</local-command-stdout>',
})
// What a self-send that never became a slash command looks like: bare text, promptSource "queued".
const queuedSelfSend = (t: string, ts: string) => ({
  type: 'user', promptSource: 'queued', timestamp: ts,
  message: { role: 'user', content: `/goal ${t}` },
})

describe('a real receipt is ACTIVE', () => {
  test('exit 0 and the goal text', () => {
    const r = verify([goalSet('the thing is measured', '2026-09-01T10:00:00Z')])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('the thing is measured')
  })
})

describe('the failure this exists to catch', () => {
  test('a queued self-send with no receipt is NOT a set goal', () => {
    const r = verify([queuedSelfSend('an elaborate lint-clean goal', '2026-09-03T01:55:00Z')])
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('NO GOAL SET')
  })

  test('a queued self-send does not override the older goal actually in force', () => {
    const r = verify([
      goalSet('get issnpx blank votes down to <1000', '2026-09-01T16:07:00Z'),
      queuedSelfSend('a much better goal that never landed', '2026-09-03T01:55:00Z'),
    ])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('issnpx blank votes')
  })
})

describe('prose cannot forge a receipt', () => {
  test('an assistant message quoting the marker is not a goal', () => {
    const r = verify([{
      type: 'assistant', timestamp: '2026-09-02T22:00:00Z',
      message: { role: 'assistant', content: [{ type: 'text',
        text: 'A real /goal writes <local-command-stdout>Goal set: something</local-command-stdout>.' }] },
    }])
    expect(r.status).toBe(1)
  })

  test('a tool result containing the marker is not a goal', () => {
    const r = verify([{
      type: 'user', timestamp: '2026-09-02T22:00:00Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1',
        content: 'local-command-stdout>Goal set: get issnpx blank votes down to <1000' }] },
    }])
    expect(r.status).toBe(1)
  })
})

describe('a cleared goal is not an active one', () => {
  test('the last record wins', () => {
    const r = verify([
      goalSet('the thing is measured', '2026-09-01T10:00:00Z'),
      goalCleared('2026-09-01T12:00:00Z'),
    ])
    expect(r.status).toBe(1)
  })
})
