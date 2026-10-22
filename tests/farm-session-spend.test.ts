import { test, expect, setDefaultTimeout } from 'bun:test'
import { writeFileSync, readFileSync, readdirSync, mkdirSync, chmodSync, utimesSync } from 'node:fs'
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
  }, { FARM_RUN_BUDGET: '1' })
  expect(res.stderr).toContain('Session spend so far: 4003001 tokensW')
  expect(res.stderr).toMatch(/1 unparseable/)
})

test('an event set that yields nothing is warned about, not silently zero', () => {
  const { res } = run({ '333.ndjson': 'bad "tokensW": 1\nnot json "tokensW":\n' },
    { FARM_RUN_BUDGET: '1' })
  expect(res.stderr).toMatch(/2 unparseable/)
  expect(res.stderr).toContain('Session spend so far: 0 tokensW')
})

test('a clean event dir prints no warning', () => {
  const { res } = run({ '444.ndjson': '{"type":"result","tokensW":10}\n' }, { FARM_RUN_BUDGET: '1' })
  expect(res.stderr).toContain('Session spend so far: 10 tokensW')
  expect(res.stderr).not.toMatch(/unparseable/)
})

test('a session already past the old 20M cap still launches a small run', () => {
  const { res } = run({ '777.ndjson': 'farm: DONE a ok toolCalls=3 W=25000000\n' })
  expect(res.stderr).toContain('Session spend so far: 25000000 tokensW')
  expect(res.status).toBe(0)
})

test('the budget-exceeded path writes a result line jq parses', () => {
  // The child emits one assistant message heavy enough to blow the row budget.
  const child = `printf '%s\\n' '{"type":"assistant","message":{"id":"m1","usage":{"output_tokens":900000}}}'; sleep 3`
  const { res, ev } = run({}, { FARM_TASK_BUDGET: '1000', BUDGET: '1000', FARM_RUN_BUDGET: '1000000000' }, child)
  const files = readdirSync(ev).filter(f => /^\d+\.ndjson$/.test(f))
  expect(files.length).toBe(1)
  const lines = readFileSync(join(ev, files[0]), 'utf8').split('\n').filter(l => l.includes('"tokensW"'))
  expect(lines.length).toBe(1)
  const j = JSON.parse(lines[0])
  expect(j.budgetExceeded).toBe(true)
  expect(j.tokensW).toBeGreaterThan(1000)
  void res
})

test('DONE W= lines are spend: ok, fail and budget rows all sum', () => {
  const { res } = run({
    '555.ndjson': 'farm: START a cwd=/x\nfarm: DONE a ok toolCalls=3 W=1000.5\nfarm: DONE b fail rc=1 missing=0 orphaned=0 toolCalls=2 W=200\nfarm: DONE c ok toolCalls=0\n',
  }, { FARM_RUN_BUDGET: '1' })
  expect(res.stderr).toContain('Session spend so far: 1200 tokensW')
})

test('a budget row with both a DONE W= and a tokensW record counts once', () => {
  const { res } = run({
    '666.ndjson': 'farm: DONE s fail budget W=4014988.1/4000000 toolCalls=206\nfarm: {"type":"result","tokensW":4014988.1,"budgetExceeded":true}\nfarm: DONE t ok toolCalls=1 W=10\n',
  }, { FARM_RUN_BUDGET: '1' })
  expect(res.stderr).toContain('Session spend so far: 4014998 tokensW')
})

test('eviction folds a stale file down to its spend, so pruning never lowers the total', () => {
  const root = mkTmp('farm-spend-evict-')
  const tmp = join(root, 'tmp'); const ev = join(tmp, 'farm-events', SID); mkdirSync(ev, { recursive: true })
  const f = join(ev, '991000.ndjson')   // pid that does not exist
  writeFileSync(f, 'farm: START a cwd=/x\nfarm: DONE a ok toolCalls=3 W=1000\nfarm: DONE b fail budget W=500/400\nfarm: {"type":"result","tokensW":500,"budgetExceeded":true}\n')
  const old = new Date(Date.now() - 3 * 3600 * 1000); utimesSync(f, old, old)
  const first = run0(tmp)
  expect(first).toContain('Session spend so far: 1500 tokensW')
  const kept = readFileSync(f, 'utf8')
  expect(kept).not.toContain('START')
  expect(kept.split('\n').filter(Boolean).length).toBe(1)
  expect(run0(tmp)).toContain('Session spend so far: 1500 tokensW')   // idempotent across a second prune
}, 240_000)

function run0(tmp: string): string {
  const root = join(tmp, '..')
  const bin = join(root, 'bin'); mkdirSync(bin, { recursive: true })
  const out = join(root, 'result.json')
  writeFileSync(join(bin, 'claude-code'), `#!/usr/bin/env bash\ncat >/dev/null\nprintf '{}\\n' > "${out}"\n`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  const wf = join(root, 'wf.js'); writeFileSync(wf, 'export const meta = { name: "x", description: "x" }\n')
  const args = join(root, 'args.json'); writeFileSync(args, '{}')
  return spawnSync('bash', [FARM, '--provider', 'claude', '--no-cron', '--workflow', wf, '--args', args, '--out', out, '--cwd', root],
    { encoding: 'utf8', timeout: 120_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp, FARM_OUT_CHILD: '1',
      FARM_OUTCOMES: join(root, 'farm-outcomes.jsonl'), CLAUDE_CODE_SESSION_ID: SID, FARM_RUN_BUDGET: '1000000000' } }).stderr
}
