#!/usr/bin/env bun
/**
 * Stop hook: hold the session on an objective until a COMMAND says it is met.
 *
 * This is what `/goal` does, done by running the check rather than reading the transcript —
 * and without a transport. The self-send this replaced only QUEUED; its drainer needed the pane
 * IDLE to type into, so a session running back-to-back checks never provided a window and the goal
 * never landed. Measured 2026-09-16: `/goal` landed 127 times and missed 36, `/loop` landed 52 and
 * missed 29, and a `/goal` sat undelivered for hours while the session worked. The transport and
 * its drainer were deleted; this hook and `CronCreate` are what replaced them.
 *
 * The three things that make a Stop hook safe rather than a trap, all copied from
 * ~/.claude/hooks/main-thread-guard.sh, which has been doing this in production:
 *
 *   1. `stop_hook_active` — set when the stop was already blocked once. Ignoring it means
 *      blocking your own block, forever.
 *   2. SELF-CLEARING — the state file is removed the moment the check passes, so the normal
 *      ending needs no human action.
 *   3. BOUNDED — a round counter and a wall clock, both checked here. A hold that cannot expire
 *      is a session someone has to kill.
 *
 * INERT unless armed. The state file is per session, so this fires for exactly one session
 * rather than every session in the project.
 *
 *   arm:     hound-arm.sh '<check command>' [--rounds N] [--minutes M]
 *   release: the check passes, a ceiling is reached, or the USER confirms `--disarm` at a
 *            terminal. Deleting the state file is not a release: the ledger beside it records
 *            the arm, and this hook restores a hold that vanished without one.
 */

import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

interface State {
  check: string
  startedAt: number      // epoch seconds
  ceilingMinutes: number
  maxRounds: number
  rounds: number
}

export function statePath(session: string): string {
  return join(process.env.TMPDIR || tmpdir(), `hound-${session}.json`)
}

/**
 * The ledger beside the state file. `hound-arm.sh` appends `armed` here when it arms and
 * `released by user` / `declined` / `refused` when release is attempted; this hook appends
 * `passed` and `expired`. It exists because the state file alone made the hold `rm`-able: a
 * session that could not argue its way out could still delete its way out. If the state file is
 * gone while the ledger's last word is `armed`, the hold was removed by something other than the
 * two sanctioned exits, and it is RESTORED rather than honoured.
 */
export function ledgerPath(session: string): string {
  return join(process.env.TMPDIR || tmpdir(), `hound-${session}.releases.log`)
}

function lastLedgerVerb(ledger: string): string | null {
  if (!existsSync(ledger)) return null
  const lines = readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean)
  const last = lines[lines.length - 1]
  if (!last) return null
  return (last.split('\t')[1] || '').trim() || null
}

/** What the hook decides, separated from the IO so it can be tested. */
export function decide(
  s: State,
  checkExit: number,
  nowSeconds: number,
): { action: 'pass' | 'block' | 'expired'; reason?: string } {
  if (checkExit === 0) return { action: 'pass' }

  const minutes = Math.floor((nowSeconds - s.startedAt) / 60)
  if (minutes >= s.ceilingMinutes) {
    return {
      action: 'expired',
      reason: `held for ${minutes} min, at or past the ${s.ceilingMinutes} min ceiling`,
    }
  }
  if (s.rounds >= s.maxRounds) {
    return { action: 'expired', reason: `${s.rounds} rounds, at the ${s.maxRounds} ceiling` }
  }
  return {
    action: 'block',
    reason:
      `\`${s.check}\` exits ${checkExit}, so the objective is NOT met. Take the next action ` +
      `now rather than proposing it — and judge from the command, not from this conversation. ` +
      `Round ${s.rounds + 1} of ${s.maxRounds}; ${s.ceilingMinutes - minutes} min left of the ` +
      `ceiling. Nothing is loosened to make it pass: fix the cause, or record why the rule does ` +
      `not apply, with the reason on the line.`,
  }
}

export function main(): void {
  const payload = JSON.parse(readFileSync(0, 'utf8') || '{}')

  // Blocking a stop causes another stop. Without this the session can never end.
  if (payload.stop_hook_active === true) process.exit(0)

  const session = payload.session_id || process.env.CLAUDE_CODE_SESSION_ID || ''
  if (!session) process.exit(0)
  const path = statePath(session)
  const ledger = ledgerPath(session)

  if (!existsSync(path)) {
    // Gone. Was it one of the sanctioned exits, or did someone delete it?
    const verb = lastLedgerVerb(ledger)
    const armed = verb !== null && verb.startsWith('armed')
    if (!armed) process.exit(0)                   // never armed, or properly released: inert
    const record = (verb.split('\u0000')[0] || '').slice(0)
    void record
    const saved = (readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).pop() || '')
    const json = saved.split('\t')[2] || ''
    try {
      const restored = JSON.parse(json) as State
      writeFileSync(path, JSON.stringify(restored))
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: `the hold on \`${restored.check}\` was removed without a user-confirmed --disarm; it has been restored. Release needs the user to confirm at a terminal, or the check to pass.`,
      }))
      process.exit(0)
    } catch {
      process.exit(0)                             // unparseable ledger: do not invent a hold
    }
  }

  let s: State
  try {
    s = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // An unreadable state file is a hold nobody can reason about; drop it rather than hold
    // the session on terms that cannot be read.
    rmSync(path, { force: true })
    process.exit(0)
  }

  const r = spawnSync('bash', ['-lc', s.check], { encoding: 'utf8', timeout: 900_000 })
  const exit = r.status ?? 2
  const d = decide(s, exit, Math.floor(Date.now() / 1000))

  if (d.action === 'pass') {
    appendFileSync(ledger, `${new Date().toISOString()}\tpassed\t${s.check}\n`)
    rmSync(path, { force: true })
    process.stderr.write(`until: \`${s.check}\` exits 0 — objective met, hold released.\n`)
    process.exit(0)
  }
  if (d.action === 'expired') {
    appendFileSync(ledger, `${new Date().toISOString()}\texpired\t${s.check}\n`)
    rmSync(path, { force: true })
    process.stderr.write(`until: ${d.reason}. Hold released UNMET — say so.\n`)
    process.exit(0)
  }

  s.rounds += 1
  writeFileSync(path, JSON.stringify(s))
  process.stdout.write(JSON.stringify({ decision: 'block', reason: `${d.reason} (state: ${path})` }))
  process.exit(0)
}

if (import.meta.main) main()
