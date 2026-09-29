import { test, expect, describe, setDefaultTimeout } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Same reason as farm-workflow-mode.test.ts: these drive farm.sh as a real bash subprocess, and
// bun's 5s default is a latency budget rather than a hang detector.
setDefaultTimeout(60_000)

const FARM = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm.sh')

/**
 * A --workflow run against a stub wrapper. The stub writes the --out artifact so the run reaches
 * its DONE path, which is where a printout that came too late would still be visible.
 */
function run(args: string[], env: Record<string, string> = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'farmcron-'))
  const bin = join(tmp, 'bin'); mkdirSync(bin, { recursive: true })
  const out = join(tmp, 'runs', 'run-7f3a'); mkdirSync(out, { recursive: true })
  const outFile = join(out, 'result.json')
  writeFileSync(join(bin, 'claude-code'),
    `#!/usr/bin/env bash\nprintf '{}\\n' > "${outFile}"\nprintf '{"type":"result","result":"ok"}\\n'\n`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  const wf = join(tmp, 'wf.js'); writeFileSync(wf, 'export const meta = { name: "x", description: "x" }\n')
  const tasks = join(tmp, 'tasks.json')
  writeFileSync(tasks, JSON.stringify([{ label: 'r', prompt: 'p' }]))
  const res = spawnSync('bash', [FARM, ...args.map((a) =>
    a === '@wf' ? wf : a === '@out' ? outFile : a === '@tasks' ? tasks : a === '@cwd' ? tmp : a)], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp, FARM_OUT_CHILD: '1', CLAUDE_CODE_SESSION_ID: '', ...env },
  })
  rmSync(tmp, { recursive: true, force: true })
  return res
}

describe('a --workflow run prints the hourly heartbeat instruction', () => {
  test('the default is the CronCreate block, with the hourly expr and the farm nudge', () => {
    const r = run(['--workflow', '@wf', '--out', '@out', '--cwd', '@cwd'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('CronCreate')
    expect(r.stdout).toContain('7 * * * *')
    expect(r.stdout).toContain('and? (farm run-7f3a)')
    expect(r.stdout).toContain('recurring: true')
    expect(r.stdout).toContain('durable:   false')
  })

  test('the instruction precedes the run, so a caller sees it before the 20-60 minute wait', () => {
    const r = run(['--workflow', '@wf', '--out', '@out', '--cwd', '@cwd'])
    // The run's own JSON verdict is printed last; the instruction must come before it.
    expect(r.stdout.indexOf('CronCreate')).toBeLessThan(r.stdout.indexOf('"toolCalls"'))
  })

  test('--no-cron prints no CronCreate block, and says the monitor is the only wake', () => {
    const r = run(['--workflow', '@wf', '--out', '@out', '--cwd', '@cwd', '--no-cron'])
    expect(r.status).toBe(0)
    expect(r.stdout).not.toContain('CronCreate')
    expect(r.stdout).not.toContain('and? (farm')
    expect(r.stdout).toContain('--no-cron')
  })

  test('WORK_LOOP_INTERVAL_MINUTES moves the interval', () => {
    const sub = run(['--workflow', '@wf', '--out', '@out', '--cwd', '@cwd'], { WORK_LOOP_INTERVAL_MINUTES: '30' })
    expect(sub.stdout).toContain('7-59/30 * * * *')
    const multi = run(['--workflow', '@wf', '--out', '@out', '--cwd', '@cwd'], { WORK_LOOP_INTERVAL_MINUTES: '240' })
    expect(multi.stdout).toContain('7 */4 * * *')
    // Junk falls back to hourly rather than handing cron an unparseable field.
    const junk = run(['--workflow', '@wf', '--out', '@out', '--cwd', '@cwd'], { WORK_LOOP_INTERVAL_MINUTES: 'soon' })
    expect(junk.stdout).toContain('7 * * * *')
  })
})

describe('a --tasks run prints nothing — the session monitor covers a row', () => {
  test('no CronCreate block, and stdout stays parseable as the fan-out JSON', () => {
    const r = run(['--tasks', '@tasks', '--cwd', '@cwd'])
    expect(r.stdout).not.toContain('CronCreate')
    expect(() => JSON.parse(r.stdout)).not.toThrow()
  })

  test('--no-cron on a --tasks run is accepted and still silent', () => {
    const r = run(['--tasks', '@tasks', '--cwd', '@cwd', '--no-cron'])
    expect(r.status).toBe(0)
    expect(r.stdout).not.toContain('CronCreate')
    expect(() => JSON.parse(r.stdout)).not.toThrow()
  })
})
