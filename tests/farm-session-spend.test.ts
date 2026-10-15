import { test, expect, setDefaultTimeout } from 'bun:test'
import { writeFileSync, readFileSync, readdirSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()
setDefaultTimeout(120_000)

const FARM = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm.sh')
const SID = 'spend-sid'

/** Run farm.sh --workflow under a stub child in a session whose event dir holds `seed` files. */
function run(seed: Record<string, string>, env: Record<string, string> = {}, child = '') {
  const root = mkTmp('farm-spend-')
  const bin = join(root, 'bin'); mkdirSync(bin, { recursive: true })
  const tmp = join(root, 'tmp'); const ev = join(tmp, 'farm-events', SID); mkdirSync(ev, { recursive: true })
  for (const [n, t] of Object.entries(seed)) writeFileSync(join(ev, n), t)
  const out = join(root, 'result.json')
  writeFileSync(join(bin, 'claude-code'), `#!/usr/bin/env bash\ncat >/dev/null\n${child}\nprintf '{}\\n' > "${out}"\n`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  const wf = join(root, 'wf.js'); writeFileSync(wf, 'export const meta = { name: "x", description: "x" }\n')
  const args = join(root, 'args.json'); writeFileSync(args, '{}')
  const res = spawnSync('bash', [FARM, '--provider', 'claude', '--no-cron', '--workflow', wf, '--args', args,
    '--out', out, '--cwd', root], { encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp, FARM_OUT_CHILD: '1',
           FARM_OUTCOMES: join(root, 'farm-outcomes.jsonl'), CLAUDE_CODE_SESSION_ID: SID, ...env } })
  return { res, ev }
}

test('one malformed line costs only itself: the valid lines still sum', () => {
  const { res } = run({
    '111.ndjson': 'farm: {"type":"result","tokensW":4000000.5,"budgetExceeded":true}\n{"type":"result","tokensW":1000}\nbroken "tokensW": {\n',
    '222.ndjson': '{"type":"result","tokensW":2000.5,"budgetExceeded":true}\n',
  }, { FARM_SESSION_BUDGET: '1' })
  expect(res.stderr).toContain('Session spend so far: 4003001 tokensW')
  expect(res.stderr).toMatch(/1 unparseable/)
})

test('an event set that yields nothing is warned about, not silently zero', () => {
  const { res } = run({ '333.ndjson': 'bad "tokensW": 1\nnot json "tokensW":\n' },
    { FARM_SESSION_BUDGET: '1' })
  expect(res.stderr).toMatch(/2 unparseable/)
  expect(res.stderr).toContain('Session spend so far: 0 tokensW')
})

test('a clean event dir prints no warning', () => {
  const { res } = run({ '444.ndjson': '{"type":"result","tokensW":10}\n' }, { FARM_SESSION_BUDGET: '1' })
  expect(res.stderr).toContain('Session spend so far: 10 tokensW')
  expect(res.stderr).not.toMatch(/unparseable/)
})

test('the budget-exceeded path writes a result line jq parses', () => {
  // The child emits one assistant message heavy enough to blow the row budget.
  const child = `printf '%s\\n' '{"type":"assistant","message":{"id":"m1","usage":{"output_tokens":900000}}}'; sleep 3`
  const { res, ev } = run({}, { FARM_TASK_BUDGET: '1000', BUDGET: '1000', FARM_SESSION_BUDGET: '1000000000' }, child)
  const files = readdirSync(ev).filter(f => /^\d+\.ndjson$/.test(f))
  expect(files.length).toBe(1)
  const lines = readFileSync(join(ev, files[0]), 'utf8').split('\n').filter(l => l.includes('"tokensW"'))
  expect(lines.length).toBe(1)
  const j = JSON.parse(lines[0])
  expect(j.budgetExceeded).toBe(true)
  expect(j.tokensW).toBeGreaterThan(1000)
  void res
})
