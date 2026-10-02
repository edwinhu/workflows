/**
 * The child env for any test that starts a grind loop.
 *
 * grind.sh notifies by DEFAULT: agent-msg to $CLAUDE_CODE_SESSION_ID plus a herdr popup where herdr
 * is installed. A suite run from inside a live Claude Code session inherits that session id and a
 * PATH carrying the real binaries, so every throwaway loop that reaches a terminal state messages
 * the operator's own session. Measured 2026-09-29: 90 notifier calls, 45 of them agent-msg to the
 * running session, from one `bun test skills/grind/scripts/` pass.
 *
 * Two halves, because either alone leaks: the session identity is stripped (agent-msg has no target)
 * AND the first PATH entry holds silent no-op `agent-msg`/`herdr`, so neither a real binary nor a
 * recording shim further down PATH is reachable.
 *
 * The tests that exist to ASSERT the default notifier do not use this — they build their own PATH of
 * recording stubs with no real directory on it, which is hermetic by construction.
 *
 * Verify: bash scripts/grind-notify-hermetic-check.sh
 */
import { existsSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDir } from '../../../tests/helpers/tmp.ts'

const {
  CLAUDE_CODE_SESSION_ID: _sid,
  CLAUDE_CODE_BRIDGE_SESSION_ID: _bid,
  ...REST
} = process.env

let shimDir: string | null = null

/** A directory of silent no-ops named for every notifier grind.sh may reach for. Removed by the
 *  importing test file's useTmp() sweep, so the cache is re-checked: the next file gets a new one. */
function shims(): string {
  if (shimDir && existsSync(shimDir)) return shimDir
  const dir = tmpDir('grind-test-shims-')
  for (const name of ['agent-msg', 'herdr']) {
    const p = join(dir, name)
    writeFileSync(p, '#!/usr/bin/env bash\nexit 0\n')
    chmodSync(p, 0o755)
  }
  shimDir = dir
  return dir
}

/** `process.env` with no session identity and no reachable notifier, plus whatever the test pins. */
export function grindEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...(REST as Record<string, string>),
    PATH: `${shims()}:${process.env.PATH ?? ''}`,
    // grind.sh appends farm-events rows and mktemps its round logs under $TMPDIR; the shim dir is
    // swept, the caller's TMPDIR is not. A test that reads those events pins its own TMPDIR.
    TMPDIR: shims(),
    ...extra,
  }
}
