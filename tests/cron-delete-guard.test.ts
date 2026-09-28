import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { hermeticEnv } from './helpers/hermetic-env'

const HOOK = join(import.meta.dir, '..', 'hooks', 'cron-delete-guard.ts')

/** A run directory: args.json always, result.json only when the run has a verdict. */
function mkRun(
  cwd: string,
  name: string,
  opts: { crons?: string[]; finished?: boolean; indent?: string } = {},
) {
  const dir = join(cwd, '.work', name)
  mkdirSync(dir, { recursive: true })
  const args: Record<string, unknown> = { projectDir: cwd, planPath: `/plans/${name}.md`, tasks: [] }
  if (opts.crons) args.heartbeatCrons = opts.crons
  writeFileSync(join(dir, 'args.json'), JSON.stringify(args, null, opts.indent ?? 2) + '\n')
  if (opts.finished) writeFileSync(join(dir, 'result.json'), JSON.stringify({ verdict: 'PASS' }))
  return dir
}

function newCwd() {
  return mkdtempSync(join(tmpdir(), 'cronguard-'))
}

/**
 * The run-based rule only: a payload with NO session_id, and a fresh TMPDIR, so no ambient hold
 * ledger can reach the hook and decide the case before the .work scan does.
 */
function guard(cwd: string, id: string, env: Record<string, string> = {}) {
  const r = spawnSync('bun', [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'CronDelete', cwd, tool_input: { id } }),
    encoding: 'utf8',
    env: hermeticEnv(mkdtempSync(join(tmpdir(), 'cronguard-tmp-')), env),
  })
  const decision = r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow'
  return { ...r, decision, reason: r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason : '' }
}

function record(cwd: string, prompt: string, response: unknown) {
  return spawnSync('bun', [HOOK, '--record'], {
    input: JSON.stringify({
      hook_event_name: 'PostToolUse', tool_name: 'CronCreate', cwd,
      tool_input: { prompt, cron: '*/7 * * * *' }, tool_response: response,
    }),
    encoding: 'utf8', env: hermeticEnv(mkdtempSync(join(tmpdir(), 'cronguard-tmp-'))),
  })
}

const crons = (cwd: string, name: string) =>
  JSON.parse(readFileSync(join(cwd, '.work', name, 'args.json'), 'utf8')).heartbeatCrons

describe('the guard is task-specific', () => {
  // The bug: run A finished, its heartbeat kept firing for hours because unrelated run B was live.
  test('a finished run’s own loop deletes while an unrelated run is in flight', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-a', { crons: ['541afe58'], finished: true })
    mkRun(cwd, 'run-b')
    const r = guard(cwd, '541afe58')
    expect(r.status).toBe(0)
    expect(r.decision).toBe('allow')
    expect(r.stdout.trim()).toBe('')
  })

  test('the loop of a run that IS in flight is refused, and the reason names that run', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-a', { crons: ['541afe58'], finished: true })
    mkRun(cwd, 'run-b', { crons: ['ab12cd34'] })
    const r = guard(cwd, 'ab12cd34')
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('.work/run-b/args.json')
    expect(r.reason).toContain('heartbeatCrons')
  })

  test('an UNCLAIMED id keeps the old rule: any run in flight refuses it', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-b')
    const r = guard(cwd, 'deadbeef')
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('no run')
    expect(r.reason).toContain('.work/run-b/args.json')
  })

  test('an unclaimed id with nothing in flight allows', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-a', { finished: true })
    expect(guard(cwd, 'deadbeef').decision).toBe('allow')
  })

  test('the override allows even with a claiming run in flight', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-b', { crons: ['ab12cd34'] })
    expect(guard(cwd, 'ab12cd34').decision).toBe('deny')
    expect(guard(cwd, 'ab12cd34', { WORK_ALLOW_CRON_DELETE: '1' }).decision).toBe('allow')
  })
})

describe('record mode', () => {
  test('writes the id into the run the prompt names, and into no other', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-a')
    mkRun(cwd, 'run-b')
    const r = record(cwd, 'bash work-loop.sh .work/run-a', { id: '541afe58' })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('') // never prints a decision
    expect(crons(cwd, 'run-a')).toEqual(['541afe58'])
    expect(crons(cwd, 'run-b')).toBeUndefined()
  })

  test('is idempotent, and preserves the other fields and the file’s formatting', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-a')
    const before = readFileSync(join(cwd, '.work', 'run-a', 'args.json'), 'utf8')
    record(cwd, 'loop for .work/run-a', { id: '541afe58' })
    record(cwd, 'loop for .work/run-a', { id: '541afe58' })
    const after = readFileSync(join(cwd, '.work', 'run-a', 'args.json'), 'utf8')
    expect(JSON.parse(after).heartbeatCrons).toEqual(['541afe58'])
    expect(JSON.parse(after).planPath).toBe('/plans/run-a.md')
    expect(after.split('\n')[1]).toMatch(/^ {2}"/) // same 2-space indent
    expect(after.endsWith('\n')).toBe(true)
    expect(before).not.toBe(after)
  })

  test('a second cron for the same run appends rather than replaces', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-a')
    record(cwd, '.work/run-a', { id: '541afe58' })
    record(cwd, '.work/run-a', { id: 'ab12cd34' })
    expect(crons(cwd, 'run-a')).toEqual(['541afe58', 'ab12cd34'])
    expect(guard(cwd, 'ab12cd34').decision).toBe('deny')
  })

  test('reads the id out of a STRING tool_response too', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-a')
    record(cwd, '.work/run-a', 'Scheduled job 541afe58 (*/7 * * * *)')
    expect(crons(cwd, 'run-a')).toEqual(['541afe58'])
  })

  test('a response with no id, and a prompt naming no run, change nothing and exit 0', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-a')
    expect(record(cwd, '.work/run-a', { status: 'ok' }).status).toBe(0)
    expect(record(cwd, 'nothing to do with any run', { id: '541afe58' }).status).toBe(0)
    expect(crons(cwd, 'run-a')).toBeUndefined()
  })
})

// ------------------------------------------------------ DONE MEANS THE GOAL IS MET, NOT CHECK GREEN
//
// The bug this closes: a work run armed with no `--goal` released the hold on
// `work-result.sh` exiting 0, the heartbeat's teardown clause read a green check as the goal
// closing, and the loop was deleted with the user's actual objective untouched. This guard now
// reads the hold's OWN release verb out of the same per-session ledger hooks/work-hold.ts writes.

/** A hold ledger for `session` under a TMPDIR the hook will look in. */
function holdLedger(entries: [string, string][], opts: { armed?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'holdgate-'))
  const sid = 'gate-session'
  if (entries.length)
    writeFileSync(join(dir, `work-hold-${sid}.releases.log`),
      entries.map(([verb, payload], i) => `2026-09-26T00:00:0${i}\t${verb}\t${payload}`).join('\n') + '\n')
  if (opts.armed)
    writeFileSync(join(dir, `work-hold-${sid}.json`), JSON.stringify({
      check: 'false', goal: 'the estimate lands inside the published interval',
      startedAt: 1, ceilingMinutes: 720, maxRounds: 8, rounds: 0,
    }))
  return { dir, sid }
}

function guardIn(cwd: string, id: string, h: { dir: string; sid: string }, env: Record<string, string> = {}) {
  const r = spawnSync('bun', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'CronDelete', cwd,
      session_id: h.sid, tool_input: { id },
    }),
    encoding: 'utf8',
    env: hermeticEnv(h.dir, env),
  })
  const parsed = r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null
  return { ...r, decision: parsed?.permissionDecision ?? 'allow', reason: parsed?.permissionDecisionReason ?? '' }
}

describe('the hold gate: CronDelete waits on an ARMED hold, and on nothing else', () => {
  // A cwd with nothing in flight, so the run-based rule allows and the hold gate is what decides.
  const quietCwd = () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-a', { crons: ['541afe58'], finished: true })
    return cwd
  }

  test('an ARMED hold denies, and names work-abandon.sh as the escape', () => {
    const r = guardIn(quietCwd(), '541afe58', holdLedger([['armed', '{"check":"false"}']], { armed: true }))
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('ARMED')
    expect(r.reason).toContain('work-abandon.sh')
  })

  // A RELEASED hold is not this gate's business, whatever verb it released on. `passed-unjudged`
  // used to deny here, which held the heartbeat open on a run the user had already walked away
  // from while saying nothing a re-arm could not say (AGK 2026-09-27).
  test('every RELEASED verb allows, including passed-unjudged, declined and the legacy passed', () => {
    for (const verb of [
      'passed-unjudged', 'passed-goal-met', 'expired', 'released by user',
      'declined', 'passed', 'refused (no tty)', 'abandoned by user',
    ]) {
      const r = guardIn(quietCwd(), '541afe58', holdLedger([
        ['armed', '{"check":"bash work-result.sh result.json"}'],
        [verb, 'bash work-result.sh result.json'],
      ]))
      expect(r.decision).toBe('allow')
    }
  })

  test('the override allows through the hold gate too', () => {
    const h = holdLedger([['armed', '{"check":"false"}']], { armed: true })
    expect(guardIn(quietCwd(), '541afe58', h).decision).toBe('deny')
    expect(guardIn(quietCwd(), '541afe58', h, { WORK_ALLOW_CRON_DELETE: '1' }).decision).toBe('allow')
  })

  test('NO ledger for the session keeps the old run-based rule, both ways', () => {
    const none = holdLedger([])
    expect(guardIn(quietCwd(), '541afe58', none).decision).toBe('allow')
    const busy = newCwd()
    mkRun(busy, 'run-b', { crons: ['ab12cd34'] })
    expect(guardIn(busy, 'ab12cd34', none).decision).toBe('deny')
    expect(guardIn(busy, 'ab12cd34', none).reason).toContain('.work/run-b/args.json')
  })

  /**
   * The identity comes from the PAYLOAD and from nowhere else. An ambient CLAUDE_CODE_SESSION_ID
   * used to be read when the payload named no session, so the hook answered about whatever session
   * merely LAUNCHED it — measured 2026-09-27, four tests above denied with the reason quoting the
   * live session's own ledger and a `.work` run in an unrelated repository.
   */
  test('an ambient CLAUDE_CODE_SESSION_ID is NOT a session — the payload is the only source', () => {
    const h = holdLedger([['passed-unjudged', 'false']], { armed: true })
    // Same ledger, same TMPDIR, same everything — only the payload's session_id differs.
    expect(guardIn(quietCwd(), '541afe58', h).decision).toBe('deny')
    const r = spawnSync('bun', [HOOK], {
      input: JSON.stringify({
        hook_event_name: 'PreToolUse', tool_name: 'CronDelete', cwd: quietCwd(), tool_input: { id: '541afe58' },
      }),
      encoding: 'utf8',
      env: { ...hermeticEnv(h.dir), CLAUDE_CODE_SESSION_ID: h.sid },
    })
    expect(r.stdout.trim()).toBe('') // allow: the hold gate never ran
  })

  test('a settled hold still does not strand an in-flight run — the two rules are independent', () => {
    const busy = newCwd()
    mkRun(busy, 'run-b', { crons: ['ab12cd34'] })
    const r = guardIn(busy, 'ab12cd34', holdLedger([['passed-goal-met', 'false']]))
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('still in flight')
  })
})
