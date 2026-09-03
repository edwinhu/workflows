import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The drainer is where the fix lives: it must WAIT FOR IDLE before every `agent prompt`.
 *
 * Measured 2026-09-02: Claude Code enqueues a prompt that arrives mid-turn and does not parse
 * slash commands out of it, so a send without a preceding wait sets no goal however cleanly it
 * reports. `agent wait --until idle --until done` is the whole repair; a drainer that prompts
 * first is the defect restored.
 */

const REPO = join(import.meta.dir, '..')
const DRAIN = join(REPO, 'skills/craft/scripts/goal-send-drain.sh')

function runDrain(lines: string[], opts: { promptFails?: boolean; focused?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'drain-'))
  const log = join(dir, 'calls.log')
  const q = join(dir, 'q')
  writeFileSync(q, lines.join('\n') + (lines.length ? '\n' : ''))
  const promptOut = opts.promptFails
    ? '{"error":{"code":"agent_blocked"}}'
    : '{"result":{"type":"agent_prompted"}}'
  writeFileSync(join(dir, 'herdr'), `#!/usr/bin/env bash
echo "$@" >> ${log}
if [ "$2" = "list" ]; then
  printf '%s' '{"result":{"agents":[{"pane_id":"wT:p1","focused":${opts.focused ? 'true' : 'false'}}]}}'
  exit 0
fi
[ "$2" = "prompt" ] && printf '%s' '${promptOut}'
exit 0
`)
  chmodSync(join(dir, 'herdr'), 0o755)
  const r = spawnSync('bash', [DRAIN, 'wT:p1', q], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GOAL_SEND_WAIT_MS: '1000',
           GOAL_SEND_FOCUS_TRIES: '2', GOAL_SEND_FOCUS_SLEEP: '0' },
  })
  return { r, calls: existsSync(log) ? readFileSync(log, 'utf8') : '',
           queue: readFileSync(q, 'utf8') }
}

describe('the drainer waits for idle before it prompts', () => {
  const { r, calls, queue } = runDrain(['/goal the thing is measured'])
  const order = calls.trim().split('\n').filter(l => !l.includes('agent list'))

  test('it waits before prompting — the send is worthless without it', () => {
    expect(order[0]).toContain('agent wait')
    expect(order[0]).toContain('--until idle')
    expect(order[0]).toContain('--until done')
    expect(order[1]).toContain('agent prompt')
  })

  test('a delivered line is popped from the queue', () => {
    expect(queue.trim()).toBe('')
    expect(r.status).toBe(0)
  })
})

describe('two lines each get their own idle window', () => {
  const { calls } = runDrain(['/goal measured thing', '/loop 30m tick'])
  const waits = (calls.match(/agent wait/g) || []).length
  const prompts = (calls.match(/agent prompt/g) || []).length

  test('one wait per send, never one wait for both', () => {
    expect(waits).toBe(2)
    expect(prompts).toBe(2)
  })

  test('they alternate wait,prompt,wait,prompt — a /goal starts a turn the /loop must wait out', () => {
    const kinds = calls.trim().split('\n').filter(l => !l.includes('agent list'))
      .map(l => l.includes('wait') ? 'w' : 'p')
    expect(kinds.join('')).toBe('wpwp')
  })
})

describe('an undelivered line is not lost', () => {
  const { r, queue } = runDrain(['/goal measured thing'], { promptFails: true })

  test('the queue keeps the line when delivery is not confirmed', () => {
    expect(queue).toContain('/goal measured thing')
  })

  test('it exits non-zero rather than reporting a send it did not make', () => {
    expect(r.status).not.toBe(0)
  })
})

describe('a focused pane is given a grace window before typing into it', () => {
  test('it probes focus and still delivers rather than dropping the goal', () => {
    const { r, calls, queue } = runDrain(['/goal measured thing'], { focused: true })
    expect(calls).toContain('agent list')
    expect(calls).toContain('agent prompt')
    expect(queue.trim()).toBe('')
    expect(r.status).toBe(0)
  })

  test('an unfocused pane is not delayed — one probe, then send', () => {
    const { calls } = runDrain(['/goal measured thing'], { focused: false })
    expect((calls.match(/agent list/g) || []).length).toBe(1)
  })
})
