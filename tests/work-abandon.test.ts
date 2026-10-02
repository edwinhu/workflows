/**
 * work-abandon.sh — the sanctioned way to retire a run the USER abandoned.
 *
 * A run walked away from leaves two things behind that outlive it: a run dir with no result.json,
 * which cron-delete-guard.ts reads as in-flight forever, and (if one was armed) a hold nothing
 * will ever release. The escape used to be WORK_ALLOW_CRON_DELETE, an env var the SESSION sets for
 * itself — which is not a user decision at all.
 *
 * Run: bun test tests/work-abandon.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()

const ABANDON = join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'work-abandon.sh')
const RESULT = join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'work-result.sh')
const GUARD = join(import.meta.dir, '..', 'hooks', 'cron-delete-guard.ts')

/** A run dir with args.json, optionally a result.json, inside a private TMPDIR. */
function fixture(opts: { result?: string; armed?: boolean } = {}) {
  const tmp = mkTmp('abandon-')
  const cwd = mkTmp('abandon-cwd-')
  const run = join(cwd, '.work', 'r1')
  mkdirSync(run, { recursive: true })
  writeFileSync(join(run, 'args.json'),
    JSON.stringify({ projectDir: cwd, mechanicalChecks: [], heartbeatCrons: ['541afe58'] }))
  if (opts.result !== undefined) writeFileSync(join(run, 'result.json'), opts.result)
  const sid = 'abandon-session'
  if (opts.armed) {
    writeFileSync(join(tmp, `work-hold-${sid}.json`), JSON.stringify({
      check: 'false', goal: 'the thing', startedAt: 1, ceilingMinutes: 720, maxRounds: 4, rounds: 0,
    }))
    writeFileSync(join(tmp, `work-hold-${sid}.releases.log`),
      `2026-09-27T00:00:00\tarmed\t{"check":"false"}\n`)
  }
  return { tmp, cwd, run, sid }
}

const abandon = (f: ReturnType<typeof fixture>, args: string[], session = f.sid) =>
  spawnSync('bash', [ABANDON, f.run, ...args], { timeout: 120_000,
    encoding: 'utf8',
    env: { ...HERMETIC_ENV, TMPDIR: f.tmp, CLAUDE_CODE_SESSION_ID: session, WORK_HOLD_COMPACT_WINDOW: '0' },
  })

describe('the verdict it writes', () => {
  test('writes result.json when there is none', () => {
    const f = fixture()
    const r = abandon(f, ['--why', 'the user changed direction'])
    expect(r.status).toBe(0)
    const v = JSON.parse(readFileSync(join(f.run, 'result.json'), 'utf8'))
    expect(v.overallPass).toBe(false)
    expect(v.abandoned).toBe(true)
    expect(v.why).toBe('the user changed direction')
    expect(typeof v.at).toBe('string')
  })

  test('writes it over an EMPTY result.json, which is the in-flight shape too', () => {
    const f = fixture({ result: '' })
    expect(abandon(f, ['--why', 'x']).status).toBe(0)
    expect(JSON.parse(readFileSync(join(f.run, 'result.json'), 'utf8')).abandoned).toBe(true)
  })

  test('REFUSES to overwrite a real verdict — a run that returned was adjudicated', () => {
    const real = JSON.stringify({ overallPass: true, verdict: 'PASS' })
    const f = fixture({ result: real })
    const r = abandon(f, ['--why', 'too late'])
    expect(r.status).toBe(0)
    expect(readFileSync(join(f.run, 'result.json'), 'utf8')).toBe(real)
    expect(r.stdout).toContain('already holds a verdict')
  })
})

describe('usage — it refuses rather than guessing', () => {
  test('no --why exits 2 and writes nothing', () => {
    const f = fixture()
    const r = abandon(f, [])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('--why')
    expect(existsSync(join(f.run, 'result.json'))).toBe(false)
  })

  test('a run dir with no args.json exits 2', () => {
    const f = fixture()
    const bare = mkTmp('abandon-bare-')
    const r = spawnSync('bash', [ABANDON, bare, '--why', 'x'], { timeout: 120_000,
      encoding: 'utf8', env: { ...HERMETIC_ENV, TMPDIR: f.tmp },
    })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('not a work run directory')
  })

  test('no arguments at all exits 2', () => {
    const r = spawnSync('bash', [ABANDON], { timeout: 120_000, encoding: 'utf8', env: HERMETIC_ENV })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('usage')
  })
})

describe('the hold it releases', () => {
  test('an ARMED hold is released: state removed, ledger says abandoned by user', () => {
    const f = fixture({ armed: true })
    const r = abandon(f, ['--why', 'the user walked away'])
    expect(r.status).toBe(0)
    expect(existsSync(join(f.tmp, `work-hold-${f.sid}.json`))).toBe(false)
    const log = readFileSync(join(f.tmp, `work-hold-${f.sid}.releases.log`), 'utf8').trim().split('\n')
    expect(log.at(-1)).toContain('abandoned by user')
    expect(log.at(-1)).toContain('the user walked away')
  })

  test('no hold armed is not an error', () => {
    const f = fixture()
    const r = abandon(f, ['--why', 'x'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('no hold armed')
  })

  test('it says CronDelete is now allowed', () => {
    expect(abandon(fixture({ armed: true }), ['--why', 'x']).stdout)
      .toContain('CronDelete on this run')
  })
})

describe('the gates downstream agree', () => {
  /** cron-delete-guard.ts on this run's heartbeat id, in the fixture's own TMPDIR and cwd. */
  const guard = (f: ReturnType<typeof fixture>) => {
    const r = spawnSync('bun', [GUARD], { timeout: 120_000,
      input: JSON.stringify({
        hook_event_name: 'PreToolUse', tool_name: 'CronDelete', cwd: f.cwd,
        session_id: f.sid, tool_input: { id: '541afe58' },
      }),
      encoding: 'utf8',
      env: { ...HERMETIC_ENV, TMPDIR: f.tmp, CLAUDE_CODE_SESSION_ID: '' },
    })
    const p = r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null
    return p?.permissionDecision ?? 'allow'
  }

  test('denied before, ALLOWED after — both the armed hold and the in-flight run are settled', () => {
    const f = fixture({ armed: true })
    expect(guard(f)).toBe('deny')
    expect(abandon(f, ['--why', 'the user walked away']).status).toBe(0)
    expect(guard(f)).toBe('allow')
  })
})

describe('work-result.sh reads an abandoned run as a FAIL, not a refusal', () => {
  test('exit 1 with a line saying abandoned — never exit 2', () => {
    const f = fixture()
    expect(abandon(f, ['--why', 'the user changed direction']).status).toBe(0)
    const r = spawnSync('bash', [RESULT, join(f.run, 'result.json')], { timeout: 120_000,
      encoding: 'utf8', env: HERMETIC_ENV,
    })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('ABANDONED')
    expect(r.stdout).toContain('the user changed direction')
  })
})
