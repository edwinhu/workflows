/**
 * The review gate must say where the review is, and must never wait on a tuicr that is not running.
 *
 * Measured 2026-10-02: `human-review-gate.sh --file findings.md --no-update-check` printed nothing for
 * >2 min. tuicr had opened in an unfocused herdr tab in another workspace, and the launcher's wait
 * loop polled for a sentinel with no notice and no exit condition — a closed tab, or a `pane run`
 * that never started tuicr, would have held it forever.
 *
 * herdr and tuicr are stubbed on PATH so no real tab opens. Run:
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/human-review-gate-launch.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { useTmp } from '../../../tests/helpers/tmp.ts'

const mkTmp = useTmp()
const GATE = `${import.meta.dir}/human-review-gate.sh`

// mode: ok = pane runs the command; closed = pane disappears without running it; hang = tuicr
// waits on the human forever; runfail = `pane run` errors.
const HERDR = `#!/usr/bin/env bash
st="$STUB_STATE"
case "$1 $2" in
  "tab list") exit 0 ;;
  "tab create") echo '{"result":{"tab":{"tab_id":"wX:t9"},"root_pane":{"pane_id":"wX:p9"}}}' ;;
  "tab close"|"tab focus") exit 0 ;;
  "pane process-info") echo '{"result":{"process_info":{"shell_pid":1}}}' ;;
  "pane read") echo '┌ tuicr' ;;
  "pane get") [ -f "$st/gone" ] && { echo '{"error":{"code":"pane_not_found"}}'; exit 1; }; echo '{}' ;;
  "pane run")
    case "$STUB_MODE" in
      runfail) echo '{"error":{"code":"pane_not_found"}}'; exit 1 ;;
      closed) touch "$st/gone" ;;
      hang) : ;;
      ok) (sh -c "$4" >/dev/null 2>&1 &) ;;
    esac ;;
esac
`
const TUICR = `#!/usr/bin/env bash
[ "$1" = review ] && { echo '[]'; exit 0; }
exit 0
`

function run(mode: string, extraEnv: Record<string, string> = {}) {
  const dir = mkTmp('hrg-launch-')
  const bin = join(dir, 'bin'); mkdirSync(bin)
  const st = join(dir, 'state'); mkdirSync(st)
  const home = join(dir, 'home'); mkdirSync(home)
  writeFileSync(join(bin, 'herdr'), HERDR); chmodSync(join(bin, 'herdr'), 0o755)
  writeFileSync(join(bin, 'tuicr'), TUICR); chmodSync(join(bin, 'tuicr'), 0o755)
  writeFileSync(join(dir, 'findings.md'), '# findings\n')
  const t0 = Date.now()
  const r = spawnSync('bash', [GATE, '--file', 'findings.md', '--no-update-check'], {
    cwd: dir,
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, TMPDIR: dir,
      STUB_MODE: mode, STUB_STATE: st, HERDR_WORKSPACE_ID: 'wX', ...extraEnv,
    },
    encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { ...r, secs: (Date.now() - t0) / 1000, dir }
}

describe('human-review-gate launch', () => {
  test('a tab closed before tuicr ran ends the wait with a message, not a hang', () => {
    const r = run('closed')
    expect(r.signal).toBeNull() // spawnSync's timeout would SIGTERM a hang
    expect(r.secs).toBeLessThan(15)
    expect(r.stderr).toMatch(/closed before tuicr exited/)
    expect(JSON.parse(r.stdout).verdict).toBe('unreviewed')
  }, 30_000)

  test('a failing pane run fails fast with a message', () => {
    const r = run('runfail')
    expect(r.signal).toBeNull()
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/could not start tuicr/)
  }, 30_000)

  test('while the human reviews, stderr names the tab before blocking', () => {
    const r = run('hang', { TUICR_WAIT_MAX: '3' })
    expect(r.signal).toBeNull()
    expect(r.stderr).toMatch(/waiting for review in herdr tab wX:t9/)
    expect(r.stderr).toMatch(/still open after 3s/)
    expect(r.status).not.toBe(0)
  }, 30_000)

  test('a normal quit still yields the verdict JSON', () => {
    const r = run('ok')
    expect(r.signal).toBeNull()
    expect(r.status).toBe(0)
    expect(r.stderr).toMatch(/TUICR_RC=0/)
    expect(JSON.parse(r.stdout).verdict).toBe('unreviewed')
    expect(existsSync(r.dir)).toBe(true)
  }, 30_000)
})
