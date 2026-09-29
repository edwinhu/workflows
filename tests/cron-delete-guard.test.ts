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

// ------------------------------------------------------------------ A GRIND HEARTBEAT IS NOT A RUN
//
// grind runs OUTSIDE every session, so its hourly backstop is claimed by no `.work` run. Under the
// fallback rule ("no run claims this id, and some run is in flight → deny") a project that has ever
// dispatched work refuses to let that heartbeat go. `--record` marks such an id instead.

/** record + guard sharing one TMPDIR and one session, which is how a real session uses them. */
function grindPair(cwd: string, id: string, prompt: string) {
  const dir = mkdtempSync(join(tmpdir(), 'grindcron-'))
  const sid = 'grind-session'
  const rec = spawnSync('bun', [HOOK, '--record'], {
    input: JSON.stringify({
      hook_event_name: 'PostToolUse', tool_name: 'CronCreate', cwd, session_id: sid,
      tool_input: { prompt, cron: '7 * * * *' }, tool_response: { id },
    }),
    encoding: 'utf8', env: hermeticEnv(dir),
  })
  const g = spawnSync('bun', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'CronDelete', cwd, session_id: sid, tool_input: { id },
    }),
    encoding: 'utf8', env: hermeticEnv(dir),
  })
  const parsed = g.stdout.trim() ? JSON.parse(g.stdout).hookSpecificOutput : null
  return { rec, dir, sid, decision: parsed?.permissionDecision ?? 'allow', reason: parsed?.permissionDecisionReason ?? '' }
}

describe('a grind heartbeat is claimed by no run, and deletes anyway', () => {
  test('the hourly backstop deletes while an unrelated work run is in flight', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-b') // in flight, claims nothing
    const r = grindPair(cwd, '9f0c1a22', 'and? (grind npx-residue.jsonl)')
    expect(r.rec.status).toBe(0)
    expect(r.rec.stdout.trim()).toBe('') // record mode never prints a decision
    expect(r.decision).toBe('allow')
  })

  test('a prompt naming grind.sh status marks it too', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-b')
    expect(grindPair(cwd, 'aa11bb22', 'check grind.sh status --journal /abs/run.jsonl').decision).toBe('allow')
  })

  test('an unmarked unclaimed id is still refused — the fallback rule is unchanged', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-b')
    const r = grindPair(cwd, 'deadbeef', 'and? (the tasklist)')
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('no run')
  })

  test('marking does not reach a run that claims the id — that deny is unchanged', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-b', { crons: ['ab12cd34'] })
    const r = grindPair(cwd, 'ab12cd34', 'and? (grind run.jsonl) for .work/run-b')
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('.work/run-b/args.json')
  })

  // A farm.sh --workflow heartbeat is the same shape of misfire: the run it names is a farm run
  // dir, not a `.work` run, so no run claims the id and the fallback rule refuses it forever.
  test('a farm heartbeat deletes while an unrelated work run is in flight', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-b')
    const r = grindPair(cwd, '7a0b1c2d', 'and? (farm run-7f3a)')
    expect(r.rec.status).toBe(0)
    expect(r.decision).toBe('allow')
  })

  test('a farm heartbeat naming a .work run in flight is still refused', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-b')
    const r = grindPair(cwd, '7a0b1c2e', 'and? (farm run-b)')
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('.work/run-b/args.json')
  })

  test('a bare mention of farming is NOT the heartbeat shape', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-b')
    const r = grindPair(cwd, '7a0b1c2f', 'and? farm out the review')
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('no run')
  })

  test('marking does not reach the ARMED-hold deny', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-a', { finished: true })
    const dir = mkdtempSync(join(tmpdir(), 'grindcron-'))
    const sid = 'gate-session'
    writeFileSync(join(dir, `work-hold-${sid}.json`), JSON.stringify({
      check: 'false', goal: 'g', startedAt: 1, ceilingMinutes: 720, maxRounds: 8, rounds: 0,
    }))
    spawnSync('bun', [HOOK, '--record'], {
      input: JSON.stringify({
        hook_event_name: 'PostToolUse', tool_name: 'CronCreate', cwd, session_id: sid,
        tool_input: { prompt: 'and? (grind run.jsonl)' }, tool_response: { id: '9f0c1a22' },
      }),
      encoding: 'utf8', env: hermeticEnv(dir),
    })
    const g = spawnSync('bun', [HOOK], {
      input: JSON.stringify({
        hook_event_name: 'PreToolUse', tool_name: 'CronDelete', cwd, session_id: sid, tool_input: { id: '9f0c1a22' },
      }),
      encoding: 'utf8', env: hermeticEnv(dir),
    })
    expect(JSON.parse(g.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
    expect(JSON.parse(g.stdout).hookSpecificOutput.permissionDecisionReason).toContain('ARMED')
  })
})

// ------------------------------------------------------ DONE MEANS THE GOAL IS MET, NOT CHECK GREEN
//
// The bug this closes: a work run armed with no `--goal` released the hold on
// `work-result.sh` exiting 0, the heartbeat's teardown clause read a green check as the goal
// closing, and the loop was deleted with the user's actual objective untouched. This guard now
// reads the hold's OWN release verb out of the same per-session ledger hooks/work-hold.ts writes.

/**
 * A hold ledger for `session` under a TMPDIR the hook will look in.
 *
 * `unevaluated` omits `lastEvaluatedAt`, which is the version-skew shape: a hold armed long ago that
 * no Stop hook has ever processed. Every other fixture carries the stamp, so the skew note fires only
 * where a test asks for it.
 */
function holdLedger(entries: [string, string][], opts: { armed?: boolean; unevaluated?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'holdgate-'))
  const sid = 'gate-session'
  if (entries.length)
    writeFileSync(join(dir, `work-hold-${sid}.releases.log`),
      entries.map(([verb, payload], i) => `2026-09-26T00:00:0${i}\t${verb}\t${payload}`).join('\n') + '\n')
  if (opts.armed)
    writeFileSync(join(dir, `work-hold-${sid}.json`), JSON.stringify({
      check: 'false', goal: 'the estimate lands inside the published interval',
      startedAt: 1, ceilingMinutes: 720, maxRounds: 8, rounds: 0,
      ...(opts.unevaluated ? {} : { lastEvaluatedAt: 1 }),
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

  // VERSION SKEW. A session whose Stop registration predates a rename of hooks/work-hold.ts arms a
  // hold nothing evaluates, while THIS hook — whose path never changed — goes on enforcing it. The
  // deadlock is total: the hold cannot release itself and the heartbeats cannot be deleted. The deny
  // stands (weakening it hands the session an argument for stranding a live run), but it now names
  // the cause and the one-command remedy.
  test('an unevaluated hold still DENIES, and the reason names the skew and /reload-plugins', () => {
    const r = guardIn(quietCwd(), '541afe58',
      holdLedger([['armed', '{"check":"false"}']], { armed: true, unevaluated: true }))
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('never evaluated since arm')
    expect(r.reason).toContain('not running work-hold.ts')
    expect(r.reason).toContain('/reload-plugins')
    // The original refusal is still the body of the message, not replaced by the diagnosis.
    expect(r.reason).toContain('ARMED')
    expect(r.reason).toContain('work-abandon.sh')
  })

  test('a hold the hook HAS evaluated says nothing about skew', () => {
    const r = guardIn(quietCwd(), '541afe58', holdLedger([['armed', '{"check":"false"}']], { armed: true }))
    expect(r.decision).toBe('deny')
    expect(r.reason).not.toContain('/reload-plugins')
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
