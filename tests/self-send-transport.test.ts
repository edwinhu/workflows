import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The herdr transport must submit with `agent prompt`, which returns a typed `agent_prompted`
 * event, and must NOT hand-roll `pane send-text` + `send-keys` + an input-line readback.
 *
 * Measured 2026-09-01, both directions from identical output: four self-send probes in this
 * session reported `sitting unsubmitted` and registered anyway, while workflows/f31b7734 reported
 * the same string and genuinely never submitted — the goal text never appeared as a user prompt
 * and the user typed it by hand. A screen-scrape cannot separate those two; `agent_prompted` can.
 * The readback also deadlocked its own collision guard (exit 6, "input box is not empty") on
 * residue it could not interpret, refusing a `/goal clear` that `agent prompt` then delivered.
 */

const REPO = join(import.meta.dir, '..')
const SEND = join(REPO, 'skills/craft/scripts/goal-self-send.sh')
const SID = 'transport-test-session'

function runWithStubHerdr(arg: string) {
  const dir = mkdtempSync(join(tmpdir(), 'selfsend-'))
  const log = join(dir, 'calls.log')
  // stub herdr: record argv, answer `agent list` with one claiming pane, accept `agent prompt`
  writeFileSync(join(dir, 'herdr'), `#!/usr/bin/env bash
echo "$@" >> ${log}
if [ "$1" = "agent" ] && [ "$2" = "list" ]; then
  printf '%s' '{"result":{"agents":[{"agent":"claude","pane_id":"wT:p1","agent_session":{"kind":"id","value":"${SID}"}}]}}'
  exit 0
fi
if [ "$1" = "agent" ] && [ "$2" = "prompt" ]; then
  printf '%s' '{"result":{"type":"agent_prompted","agent":{"agent_session":{"kind":"id","value":"${SID}"}}}}'
  exit 0
fi
exit 0
`)
  chmodSync(join(dir, 'herdr'), 0o755)
  const r = spawnSync(SEND, [arg, '--no-lint'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CLAUDE_CODE_SESSION_ID: SID,
           HERDR_PANE_ID: 'wT:p1' },
  })
  return { r, calls: existsSync(log) ? readFileSync(log, 'utf8') : '' }
}

describe('the herdr transport submits with `agent prompt`', () => {
  const { r, calls } = runWithStubHerdr('/goal `x` exits 0 within 60 minutes; rounds in a.json reads 3 or more. You may decide alone. When a run returns, take the next action.')

  test('it calls `agent prompt`', () => {
    expect(calls).toContain('agent prompt')
  })

  test('it does NOT hand-roll send-text / send-keys / ctrl+u', () => {
    expect(calls).not.toContain('pane send-text')
    expect(calls).not.toContain('send-keys')
    expect(calls).not.toContain('ctrl+u')
  })

  test('a successful submission exits 0', () => {
    expect(r.status).toBe(0)
  })

  test('it does not pass --wait (cannot work for a self-send)', () => {
    expect(calls).not.toContain('--wait')
  })
})
