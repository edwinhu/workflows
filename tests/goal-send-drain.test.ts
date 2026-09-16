import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Two things make a self-sent goal actually land, and the drainer must do both.
 *
 * 1. WAIT FOR IDLE. A prompt arriving mid-turn is enqueued by Claude Code and parsed as literal
 *    text, so a send without a preceding wait sets no goal however cleanly it reports.
 * 2. TYPE, DON'T PASTE. Measured 2026-09-03: `agent prompt` honors bracketed paste and Claude Code
 *    does not run a slash command out of a paste. Three consecutive `agent prompt` sends to a
 *    confirmed-idle pane landed literal, including a 94-char /loop; a 679-char goal sent with
 *    `pane send-text` + `send-keys enter` executed with a `Goal set:` receipt. Length is not the
 *    variable — 2,373 chars has executed, 182 has not.
 *
 * And delivery is not execution: only an executed slash command writes a <command-name> record.
 */

const REPO = join(import.meta.dir, '..')
const DRAIN = join(REPO, 'skills/work/scripts/goal-send-drain.sh')
const SID = 'drain-test-session'

function runDrain(lines: string[],
                 opts: { focused?: boolean; executes?: boolean; seedUnconfirmed?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'drain-'))
  const log = join(home, 'calls.log')
  const q = join(home, `herdr-goal-send-${SID}.q`)
  writeFileSync(q, lines.join('\n') + (lines.length ? '\n' : ''))
  // A record of earlier sends that never confirmed, as the drainer would have left it.
  if (opts.seedUnconfirmed !== undefined) writeFileSync(`${q}.unconfirmed`, opts.seedUnconfirmed)

  // The transcript Claude Code would write. `executes: false` = the line landed as literal text.
  const proj = join(home, '.claude', 'projects', 'p')
  mkdirSync(proj, { recursive: true })
  const ts = new Date(Date.now() + 1000).toISOString()
  const records = opts.executes === false ? [] : lines.map(l => ({
    type: 'system', subtype: 'local_command', timestamp: ts,
    content: `<command-name>/${l.split(' ')[0].replace('/', '')}</command-name>`,
  }))
  writeFileSync(join(proj, `${SID}.jsonl`), records.map(r => JSON.stringify(r)).join('\n') + '\n')

  writeFileSync(join(home, 'herdr'), `#!/usr/bin/env bash
echo "$@" >> ${log}
if [ "$2" = "list" ]; then
  printf '%s' '{"result":{"agents":[{"pane_id":"wT:p1","focused":${opts.focused ? 'true' : 'false'}}]}}'
fi
exit 0
`)
  chmodSync(join(home, 'herdr'), 0o755)
  const r = spawnSync('bash', [DRAIN, 'wT:p1', q], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${home}:${process.env.PATH}`,
           GOAL_SEND_WAIT_MS: '1000', GOAL_SEND_FOCUS_TRIES: '2', GOAL_SEND_FOCUS_SLEEP: '0',
           GOAL_SEND_CONFIRM_TRIES: '2', GOAL_SEND_CONFIRM_SLEEP: '0',
           GOAL_SEND_ATTEMPTS: '3' },
  })
  return { r, calls: existsSync(log) ? readFileSync(log, 'utf8') : '',
           queue: readFileSync(q, 'utf8'),
           unconfirmed: existsSync(`${q}.unconfirmed`) ? readFileSync(`${q}.unconfirmed`, 'utf8') : '',
           drainLog: existsSync(`${q}.log`) ? readFileSync(`${q}.log`, 'utf8') : '' }
}

describe('it types the command rather than pasting it', () => {
  const { calls } = runDrain(['/goal the thing is measured'])

  test('it uses pane send-text + send-keys enter', () => {
    expect(calls).toContain('pane send-text')
    expect(calls).toContain('pane send-keys wT:p1 enter')
  })

  test('it does NOT use `agent prompt` — that pastes, and a paste is never a slash command', () => {
    expect(calls).not.toContain('agent prompt')
  })

  test('it still waits for idle first', () => {
    const order = calls.trim().split('\n').filter(l => !l.includes('agent list'))
    expect(order[0]).toContain('agent wait')
    expect(order[0]).toContain('--until idle')
    expect(order[0]).toContain('--until done')
  })
})

describe('delivery is not execution', () => {
  test('a <command-name> record in the transcript confirms it', () => {
    const { drainLog, unconfirmed, queue } = runDrain(['/goal the thing is measured'])
    expect(drainLog).toContain('EXECUTED')
    expect(unconfirmed).toBe('')
    expect(queue.trim()).toBe('')
  })

  test('no record means UNCONFIRMED and is recorded, not reported as success', () => {
    const { drainLog, unconfirmed, calls } = runDrain(['/goal the thing is measured'], { executes: false })
    expect(drainLog).toContain('UNCONFIRMED')
    expect(unconfirmed).toContain('/goal the thing is measured')
    // A /goal is idempotent, so an unconfirmed one is re-attempted rather than abandoned.
    expect((calls.match(/pane send-text/g) || []).length).toBe(3)
  }, 30000)

  // A /loop USED to get one attempt, to stop two lines becoming two crons. Measured across
  // every session's log on 2026-09-16: /goal landed 127 and missed 36, /loop landed 52 and
  // missed 29 — a third of every heartbeat ever raised, with nothing to report it. The guard
  // was unnecessary: `confirmed` looks for the command's EXECUTION receipt, and a cron exists
  // only if the command executed, so "unconfirmed" is evidence that no cron was made.
  //
  // What still must hold is the thing one-attempt achieved: a CONFIRMED /loop is never sent
  // twice. That is the assertion below, and it is the one that prevents two crons.
  test('an unconfirmed /loop IS retried — no cron exists to duplicate', () => {
    const { calls } = runDrain(['/loop 30m tick'], { executes: false })
    expect((calls.match(/pane send-text/g) || []).length).toBe(3)
  }, 30000)

  test('a CONFIRMED /loop is sent exactly once — this is what stops two crons', () => {
    const { calls } = runDrain(['/loop 30m tick'], { executes: true })
    expect((calls.match(/pane send-text/g) || []).length).toBe(1)
  }, 30000)

  // `.unconfirmed` is append-only and goal-verify.sh reads it, so a superseded failure would
  // warn forever — and a warning that cannot clear is one people learn to skip, which is how
  // the original miss went unnoticed for weeks.
  test('a successful send clears its own earlier failure from the record', () => {
    const r = runDrain(['/loop 30m tick'], {
      executes: true,
      seedUnconfirmed: '/loop 30m tick\n/goal something else\n',
    })
    expect(r.unconfirmed).not.toContain('/loop 30m tick')
    // ...and leaves every OTHER unresolved failure alone.
    expect(r.unconfirmed).toContain('/goal something else')
  }, 30000)

  test('an unconfirmed /loop is recorded, because nothing else would say it never armed', () => {
    const { queue, unconfirmed } = runDrain(['/loop 30m tick'], { executes: false })
    expect(queue.trim()).toBe('')
    expect(unconfirmed).toContain('/loop 30m tick')
  }, 30000)
})

describe('a command over 800 chars is chunked, because Claude Code pastes above that', () => {
  // `kre=800` in the Claude Code bundle: a single insert longer than 800 chars (or ~2 lines)
  // becomes a "[Pasted text #N]" block, and the slash parser requires input starting with "/".
  // Sub-threshold inserts concatenate exactly like typing. Measured: a 1,460-char goal failed
  // four times in one call and executed first try when chunked.
  const long = '/goal ' + 'x'.repeat(1400)
  const { calls } = runDrain([long])
  const sends = calls.split('\n').filter(l => l.startsWith('pane send-text'))

  test('it splits into several send-text calls', () => {
    expect(sends.length).toBeGreaterThan(1)
  })

  test('every chunk is comfortably under the 800-char paste threshold', () => {
    for (const s of sends) {
      const payload = s.replace(/^pane send-text \S+ /, '')
      expect(payload.length).toBeLessThan(800)
    }
  })

  test('one Enter for the whole command, not one per chunk', () => {
    expect((calls.match(/pane send-keys/g) || []).length).toBe(1)
  })
})

describe('two lines each get their own idle window', () => {
  const { calls } = runDrain(['/goal measured thing', '/loop 30m tick'])

  test('each line gets its own idle wait — a /goal starts a turn the /loop must wait out', () => {
    expect((calls.match(/agent wait/g) || []).length).toBe(2)
    expect((calls.match(/pane send-text/g) || []).length).toBe(2)
  })
})

describe('a focused pane is given a grace window before typing into it', () => {
  test('it probes focus and still delivers', () => {
    const { calls, queue } = runDrain(['/goal measured thing'], { focused: true })
    expect(calls).toContain('agent list')
    expect(calls).toContain('pane send-text')
    expect(queue.trim()).toBe('')
  })
})
