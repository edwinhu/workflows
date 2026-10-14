/**
 * The guards' clock is injectable (GUARD_NOW_MS), so the script/mod parity comparison reads one
 * instant on both sides. Cause of the flake it fixes: cron-delete's deny embeds "never evaluated
 * since arm N m ago", and a minute ticking between the script run and the handler run changed N.
 */
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { modIO } from '../hooks/guards/mod.ts'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()
const HOOK = join(import.meta.dir, '..', 'hooks', 'cron-delete-guard.ts')
const ARMED_AT = 1_700_000_000 // seconds

function deny(tmp: string, nowMs?: number): string {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: tmp }
  if (nowMs !== undefined) env.GUARD_NOW_MS = String(nowMs)
  const r = spawnSync('bun', [HOOK], {
    cwd: tmp, env, encoding: 'utf8', timeout: 30_000,
    input: JSON.stringify({ tool_name: 'CronDelete', session_id: 'clk', cwd: tmp, tool_input: { id: 'x' } }),
  })
  return JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason
}

test('a clock one minute apart changes the deny text; the same clock does not', () => {
  const tmp = mkTmp('clock-seam-')
  writeFileSync(join(tmp, 'work-hold-clk.json'), JSON.stringify({ startedAt: ARMED_AT }))
  const at = (min: number) => (ARMED_AT + min * 60) * 1000
  const a = deny(tmp, at(20)), b = deny(tmp, at(21))
  expect(a).toContain('never evaluated since arm 20m ago')
  expect(b).toContain('never evaluated since arm 21m ago')
  expect(a).not.toEqual(b)
  expect(deny(tmp, at(20))).toEqual(a)
}, 120_000)

test('the mod and the script read the same injected now', () => {
  const env = { GUARD_NOW_MS: '1700001234567' } as never
  const io = modIO({ plugin: { root: '/' }, fs: {} } as never, env, '/', 'sid')
  expect(io.nowMs()).toBe(1700001234567)
  const wall = modIO({ plugin: { root: '/' }, fs: {} } as never, {} as never, '/', 'sid').nowMs()
  expect(Math.abs(wall - Date.now())).toBeLessThan(5000)
})
