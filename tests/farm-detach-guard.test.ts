/**
 * hooks/farm-detach-guard.ts: a farm.sh --tasks call made with run_in_background and no --detach is
 * denied, because Claude Code would report the command's end AND the watcher mod would wake on the
 * run's DONE: two wakes for one event. Foreground calls, --detach, --workflow and mere mentions pass.
 * Each case spawns the settings-hook script, as tests/bun-parallel-guard.test.ts does.
 */
import { expect, test, setDefaultTimeout } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'

setDefaultTimeout(60_000)

const HOOK = join(dirname(import.meta.dir), 'hooks', 'farm-detach-guard.ts')
const FARM = '~/.claude/skills/workflows/skills/farm-out/scripts/farm.sh'

function decide(command: string, background: boolean | undefined, tool = 'Bash'): string | null {
  const tool_input: Record<string, unknown> = { command }
  if (background !== undefined) tool_input.run_in_background = background
  const r = spawnSync('bun', [HOOK], {
    timeout: 60_000,
    encoding: 'utf8',
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: tool, cwd: '/home/eh/projects/workflows',
      session_id: 'test-session', tool_input,
    }),
  })
  // A gate that exits non-zero is NON-BLOCKING to Claude Code: a silent allow.
  expect(r.status).toBe(0)
  const out = (r.stdout ?? '').trim()
  if (!out) return null
  const o = JSON.parse(out).hookSpecificOutput
  expect(o.permissionDecision).toBe('deny')
  return o.permissionDecisionReason as string
}

const DENY: string[] = [
  `bash ${FARM} --tasks /tmp/t.json --cwd /repo`,
  `bash ${FARM} --provider claude --tasks=/tmp/t.json --cwd /repo`,
  `${FARM} --tasks /tmp/t.json`,
  `cd /repo && bash ${FARM} --tasks /tmp/t.json --cwd /repo`,
  `S=~/.claude/skills/workflows/skills/farm-out/scripts; bash $S/farm.sh --tasks /tmp/t.json`,
]

const ALLOW_BACKGROUND: string[] = [
  `bash ${FARM} --tasks /tmp/t.json --cwd /repo --detach`,
  `bash ${FARM} --detach --tasks /tmp/t.json`,
  `bash ${FARM} --workflow /abs/wf.js --args /abs/a.json --out /abs/r.json --cwd /repo --provider claude`,
  `bash ~/.claude/skills/workflows/skills/work/scripts/work-dispatch.sh plan.md`,
  `echo "bash ${FARM} --tasks /tmp/t.json"`,
  `until test -s /repo/out.md; do sleep 20; done; cat /repo/out.md`,
]

for (const cmd of DENY) {
  test(`backgrounded without --detach is denied: ${cmd}`, () => {
    const why = decide(cmd, true)
    expect(why).not.toBeNull()
    expect(why!).toContain('--detach')
    expect(why!).toMatch(/foreground/i)
  })
}

for (const cmd of DENY) {
  test(`the same call in the foreground runs: ${cmd}`, () => {
    expect(decide(cmd, false)).toBeNull()
    expect(decide(cmd, undefined)).toBeNull()
  })
}

for (const cmd of ALLOW_BACKGROUND) {
  test(`backgrounded but not a blocking farm.sh --tasks runs: ${cmd}`, () => {
    expect(decide(cmd, true)).toBeNull()
  })
}

test('a heredoc that only writes the command as text runs', () => {
  expect(decide(`cat > /tmp/run.sh <<'EOF'\nbash ${FARM} --tasks /tmp/t.json\nEOF`, true)).toBeNull()
})
