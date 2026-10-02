/**
 * hooks/bun-parallel-guard.ts: a multi-file `bun test` without `--parallel` is denied; a single file,
 * `--help`, `--parallel`, scripts/test.sh and harnesses that run bun internally pass. Each case
 * spawns the settings-hook script, so tests/mod-guards-parity.test.ts records these inputs and holds
 * the mod's handler to the same answers.
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { FIX } from '../hooks/guards/bun-test.ts'

const HOOK = join(dirname(import.meta.dir), 'hooks', 'bun-parallel-guard.ts')

function decide(command: string, tool = 'Bash'): string | null {
  const r = spawnSync('bun', [HOOK], {
    timeout: 60_000,
    encoding: 'utf8',
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: tool, cwd: '/home/eh/projects/workflows',
      session_id: 'test-session', tool_input: { command },
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

const DENY: [string, string][] = [
  ['bun test', 'the whole repo'],
  ['bun test ./tests', './tests, a directory'],
  ['bun test tests/', 'tests/, a directory'],
  ['bun test ./tests/a.test.ts ./tests/b.test.ts', '2 paths'],
  ['bun test tests/*.test.ts', 'the glob tests/*.test.ts'],
  ['bun test guard', 'guard, a directory or name filter'],
  ['bun test -t "self match"', 'the whole repo'],
  ['bun test --timeout 60000 ./skills', './skills, a directory'],
  ['bun test --isolate --bail ./tests', './tests, a directory'],
  ['cd /home/eh/projects/workflows && bun test', 'the whole repo'],
  ['git status; bun test ./tests 2>&1 | tail -40', './tests, a directory'],
  ['TMPDIR=/tmp bun test ./hooks', './hooks, a directory'],
  ['FOO=1 BAR="x y" bun test', 'the whole repo'],
  ['timeout 600 bun test ./tests', './tests, a directory'],
  ['timeout -k 10 600 nice -n 5 bun test', 'the whole repo'],
  ['/nix/store/abc-bun-1.4.0/bin/bun test ./tests', './tests, a directory'],
  ["bun test './tests/a b.test.ts' \"tests/c d.test.ts\"", '2 paths'],
  ['(cd skills/work && bun test)', 'the whole repo'],
  ['if bun test ./tests; then echo ok; fi', './tests, a directory'],
  ['bun test ./tests --reporter=dots > /tmp/out.txt', './tests, a directory'],
  ['scripts/test.sh ./tests && bun test ./hooks', './hooks, a directory'],
  ['n=$(bun test ./tests 2>&1 | wc -l)', './tests, a directory'],
]

const ALLOW: string[] = [
  'bun test ./tests/bun-parallel-guard.test.ts',
  'bun test tests/pgrep-self-match.test.ts 2>&1 | tail -20',
  "bun test './tests/a b.test.ts'",
  'TMPDIR=/tmp timeout 120 bun test ./hooks/read-guard.test.ts -t deny',
  'bun test --help',
  'bun test -h',
  'bun test --parallel',
  'bun test --parallel ./tests ./skills',
  'bun test --parallel=8 ./tests',
  'cd x && TMPDIR=/tmp bun test --parallel --timeout 60000',
  'scripts/test.sh',
  'scripts/test.sh ./tests ./skills',
  'TEST_JOBS=8 ./scripts/test.sh ./tests',
  'bun scripts/hook-golden.ts --quiet',
  'bun tests/typst-convention-guard.test.mjs',
  'bun run test',
  'bun install',
  'echo "bun test"',
  "rg -n 'bun test' docs/",
  'git commit -m "guard: multi-file bun test must run in parallel"',
  'bun test "$TEST_FILES"',
  'bun test $FILES',
  'bun test $(git diff --name-only | grep test)',
  'bun test `git ls-files tests`',
  "bun test 'tests/*.test.ts'",
  'git ls-files "*.test.ts" | xargs bun test',
  'bash -c "bun test ./tests"',
  "cat > run.sh <<'EOF'\nbun test ./tests\nEOF\nchmod +x run.sh",
  'bun --cwd x test',
]

describe('denies a serial multi-file bun test', () => {
  for (const [command, why] of DENY) {
    test(command, () => {
      const reason = decide(command)
      expect(reason).toContain(why)
      expect(reason).toContain(FIX)
    })
  }
})

describe('allows', () => {
  for (const command of ALLOW) test(command, () => expect(decide(command)).toBeNull())
})

test('the message is the exact remedy', () => {
  expect(FIX).toBe(
    'Run multi-file bun suites in parallel: bun test --parallel ... (or scripts/test.sh where the repo has one), with TMPDIR outside ~/.tmp.',
  )
})

test('only Bash is gated', () => {
  expect(decide('bun test', 'Monitor')).toBeNull()
})
