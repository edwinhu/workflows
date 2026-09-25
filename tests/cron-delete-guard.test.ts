import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const HOOK = join(import.meta.dir, '..', 'hooks', 'cron-delete-guard.ts')

/** A run directory: args.json always, result.json only when the run has a verdict. */
function mkRun(
  cwd: string,
  name: string,
  opts: { crons?: string[]; finished?: boolean; indent?: string } = {},
) {
  const dir = join(cwd, '.craft', name)
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

function guard(cwd: string, id: string, env: Record<string, string> = {}) {
  const r = spawnSync('bun', [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'CronDelete', cwd, tool_input: { id } }),
    encoding: 'utf8',
    env: { ...process.env, ...env },
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
    encoding: 'utf8', env: { ...process.env },
  })
}

const crons = (cwd: string, name: string) =>
  JSON.parse(readFileSync(join(cwd, '.craft', name, 'args.json'), 'utf8')).heartbeatCrons

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
    expect(r.reason).toContain('.craft/run-b/args.json')
    expect(r.reason).toContain('heartbeatCrons')
  })

  test('an UNCLAIMED id keeps the old rule: any run in flight refuses it', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-b')
    const r = guard(cwd, 'deadbeef')
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('no run')
    expect(r.reason).toContain('.craft/run-b/args.json')
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
    expect(guard(cwd, 'ab12cd34', { CRAFT_ALLOW_CRON_DELETE: '1' }).decision).toBe('allow')
  })
})

describe('record mode', () => {
  test('writes the id into the run the prompt names, and into no other', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-a')
    mkRun(cwd, 'run-b')
    const r = record(cwd, 'bash work-loop.sh .craft/run-a', { id: '541afe58' })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('') // never prints a decision
    expect(crons(cwd, 'run-a')).toEqual(['541afe58'])
    expect(crons(cwd, 'run-b')).toBeUndefined()
  })

  test('is idempotent, and preserves the other fields and the file’s formatting', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-a')
    const before = readFileSync(join(cwd, '.craft', 'run-a', 'args.json'), 'utf8')
    record(cwd, 'loop for .craft/run-a', { id: '541afe58' })
    record(cwd, 'loop for .craft/run-a', { id: '541afe58' })
    const after = readFileSync(join(cwd, '.craft', 'run-a', 'args.json'), 'utf8')
    expect(JSON.parse(after).heartbeatCrons).toEqual(['541afe58'])
    expect(JSON.parse(after).planPath).toBe('/plans/run-a.md')
    expect(after.split('\n')[1]).toMatch(/^ {2}"/) // same 2-space indent
    expect(after.endsWith('\n')).toBe(true)
    expect(before).not.toBe(after)
  })

  test('a second cron for the same run appends rather than replaces', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-a')
    record(cwd, '.craft/run-a', { id: '541afe58' })
    record(cwd, '.craft/run-a', { id: 'ab12cd34' })
    expect(crons(cwd, 'run-a')).toEqual(['541afe58', 'ab12cd34'])
    expect(guard(cwd, 'ab12cd34').decision).toBe('deny')
  })

  test('reads the id out of a STRING tool_response too', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-a')
    record(cwd, '.craft/run-a', 'Scheduled job 541afe58 (*/7 * * * *)')
    expect(crons(cwd, 'run-a')).toEqual(['541afe58'])
  })

  test('a response with no id, and a prompt naming no run, change nothing and exit 0', () => {
    const cwd = newCwd()
    mkRun(cwd, 'run-a')
    expect(record(cwd, '.craft/run-a', { status: 'ok' }).status).toBe(0)
    expect(record(cwd, 'nothing to do with any run', { id: '541afe58' }).status).toBe(0)
    expect(crons(cwd, 'run-a')).toBeUndefined()
  })
})
