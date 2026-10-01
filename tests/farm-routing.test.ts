import { test, expect } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'

/**
 * farm.sh routes each row through route.ts when no --provider is given, and appends one outcome
 * line per row (plus `--verdict` lines) to $FARM_OUTCOMES.
 *
 * The three wrappers are stubs that log their argv and print a canned result, so nothing reaches a
 * provider. Jev is the dead port unless a case says otherwise.
 */

const FARM = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm.sh')
const FIXTURE = join(import.meta.dir, 'fixtures', 'routing', 'table.json')
const DEAD = 'http://127.0.0.1:1/'
const KINDS = ['script', 'judgement', 'review', 'bulk']

type Rig = { root: string; agentCwd: string; argvLog: string; outcomes: string; env: Record<string, string> }

function rig(): Rig {
  const root = mkdtempSync(join(tmpdir(), 'farm-routing-'))
  const agentCwd = join(root, 'agentcwd')
  const bin = join(root, 'bin')
  mkdirSync(agentCwd); mkdirSync(bin)
  const argvLog = join(root, 'argv.log')
  for (const w of ['claude-code', 'gemini-code', 'codex-code']) {
    writeFileSync(join(bin, w),
      `#!/usr/bin/env bash\nprintf '%s\\n<<END>>\\n' "$(basename "$0") $*" >> "${argvLog}"\nprintf '{"type":"result","result":"done"}\\n'\n`)
    chmodSync(join(bin, w), 0o755)
  }
  const outcomes = join(root, 'outcomes.jsonl')
  const { ROUTING_TABLE: _t, WORK_HOLD_DECISIONS_MODEL: _m, ...base } = HERMETIC_ENV as Record<string, string>
  const env = {
    ...base,
    PATH: `${bin}:${process.env.PATH}`,
    TMPDIR: root,
    FARM_OUT_CHILD: '1',
    ROUTING_TABLE: FIXTURE,
    FARM_OUTCOMES: outcomes,
    WORK_HOLD_DECISIONS_URL: DEAD,
    WORK_HOLD_JUDGE_TOKEN: 'test-token',
    FARM_TASK_BUDGET: '4000000', FARM_SESSION_BUDGET: '20000000',
    FARM_TASK_ESTIMATE: '750000', FARM_BUDGET_OVERRIDE: '0',
  }
  return { root, agentCwd, argvLog, outcomes, env }
}

async function farm(r: Rig, args: string[], env: Record<string, string> = {}) {
  const p = Bun.spawn(['bash', FARM, ...args], {
    cwd: r.root, env: { ...r.env, ...env }, stdout: 'pipe', stderr: 'pipe',
  })
  const killer = setTimeout(() => p.kill(), 25_000)
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  const code = await p.exited
  clearTimeout(killer)
  return { code, stdout, stderr }
}

async function runRows(r: Rig, rows: Record<string, unknown>[], extra: string[] = [], env: Record<string, string> = {}) {
  const tasks = join(r.root, `tasks-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(tasks, JSON.stringify(rows))
  return farm(r, [...extra, '--tasks', tasks, '--cwd', r.agentCwd], env)
}

/** One entry per wrapper invocation: `<wrapper> <argv...>`. */
function invocations(r: Rig): string[] {
  if (!existsSync(r.argvLog)) return []
  return readFileSync(r.argvLog, 'utf8').split('<<END>>\n').map(s => s.trim()).filter(Boolean)
}

function lines(r: Rig): any[] {
  if (!existsSync(r.outcomes)) return []
  return readFileSync(r.outcomes, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}
const rowLines = (r: Rig) => lines(r).filter(l => l.type === 'row')

function modelOf(inv: string): string | null {
  const m = inv.match(/--model (\S+)/)
  return m ? m[1] : null
}

test('1. a script row runs on claude-code --model claude-sonnet-5-5 and writes one full row line', async () => {
  const r = rig()
  const res = await runRows(r, [{ label: 'scr', prompt: 'do the thing', kind: 'script' }])
  expect(res.code).toBe(0)
  const inv = invocations(r)
  expect(inv).toHaveLength(1)
  expect(inv[0].startsWith('claude-code ')).toBe(true)
  expect(modelOf(inv[0])).toBe('claude-sonnet-5-5')

  const rows = rowLines(r)
  expect(rows).toHaveLength(1)
  const o = rows[0]
  expect(typeof o.rowId).toBe('string')
  expect(o.rowId.length).toBeGreaterThan(0)
  expect(o.label).toBe('scr')
  expect(o.kind).toBe('script')
  expect(o.route.source).toBe('table')
  expect(o.route.provider).toBe('claude')
  expect(o.route.model).toBe('claude-sonnet-5-5')
  expect(o.promptSha256).toMatch(/^[0-9a-f]{64}$/)
  expect(o.promptLength).toBe('do the thing'.length)
  for (const k of ['exit', 'ok', 'missing', 'toolCalls', 'models', 'shadow', 'ts']) expect(o).toHaveProperty(k)
  expect(o.exit).toBe(0)
  expect(o.ok).toBe(true)
}, 30_000)

test('2. a bulk row runs on gemini-code --model gemini-3.7-flash-high', async () => {
  const r = rig()
  const res = await runRows(r, [{ label: 'blk', prompt: 'p', kind: 'bulk' }])
  expect(res.code).toBe(0)
  const inv = invocations(r)
  expect(inv).toHaveLength(1)
  expect(inv[0].startsWith('gemini-code ')).toBe(true)
  expect(modelOf(inv[0])).toBe('gemini-3.7-flash-high')
  expect(rowLines(r)[0]?.route?.provider).toBe('gemini')
}, 30_000)

test('3. a row with no kind, provider or model exits 2, names the kinds, runs nothing, logs nothing', async () => {
  const r = rig()
  const res = await runRows(r, [{ label: 'bare', prompt: 'p' }])
  for (const k of KINDS) expect(res.stderr).toContain(k)
  expect(res.code).toBe(2)
  expect(invocations(r)).toEqual([])
  expect(rowLines(r)).toEqual([])
}, 30_000)

test('4. an explicit codex provider and model run on codex-code with that model, source explicit', async () => {
  const r = rig()
  const res = await runRows(r, [{ label: 'exp', prompt: 'p', provider: 'codex', model: 'gpt-5.6-luna' }])
  expect(res.code).toBe(0)
  const inv = invocations(r)
  expect(inv).toHaveLength(1)
  expect(inv[0].startsWith('codex-code ')).toBe(true)
  expect(modelOf(inv[0])).toBe('gpt-5.6-luna')
  const o = rowLines(r)[0]
  expect(o?.route?.source).toBe('explicit')
  expect(o?.route?.provider).toBe('codex')
}, 30_000)

test('5. legacy --provider gemini with no kind runs gemini-code with no --model, source flag', async () => {
  const r = rig()
  const res = await runRows(r, [{ label: 'leg', prompt: 'p' }], ['--provider', 'gemini'])
  expect(res.code).toBe(0)
  const inv = invocations(r)
  expect(inv).toHaveLength(1)
  expect(inv[0].startsWith('gemini-code ')).toBe(true)
  expect(modelOf(inv[0])).toBeNull()
  const o = rowLines(r)[0]
  expect(o?.route?.source).toBe('flag')
  expect(o?.route?.provider).toBe('gemini')
}, 30_000)

test('6. two rows of different kinds each run on their own wrapper, two row lines, distinct rowIds', async () => {
  const r = rig()
  const res = await runRows(r, [
    { label: 'a-script', prompt: 'p1', kind: 'script' },
    { label: 'b-bulk', prompt: 'p2', kind: 'bulk' },
  ])
  expect(res.code).toBe(0)
  const wrappers = invocations(r).map(i => i.split(' ')[0]).sort()
  expect(wrappers).toEqual(['claude-code', 'gemini-code'])
  const rows = rowLines(r)
  expect(rows).toHaveLength(2)
  expect(new Set(rows.map(o => o.rowId)).size).toBe(2)
  const byLabel = Object.fromEntries(rows.map(o => [o.label, o]))
  expect(byLabel['a-script'].route.provider).toBe('claude')
  expect(byLabel['b-bulk'].route.provider).toBe('gemini')
}, 30_000)

test('7. stderr announces each row as `farm: ROW <label> <rowId>` with the outcome rowId', async () => {
  const r = rig()
  const res = await runRows(r, [{ label: 'announced', prompt: 'p', kind: 'review' }])
  expect(res.code).toBe(0)
  const o = rowLines(r)[0]
  expect(o).toBeDefined()
  expect(res.stderr).toContain(`farm: ROW announced ${o.rowId}`)
}, 30_000)

test('8. with Jev dead the row still runs on the table pick and records shadow.unavailable', async () => {
  const r = rig()
  const res = await runRows(r, [{ label: 'nojev', prompt: 'p', kind: 'judgement' }], [], { WORK_HOLD_DECISIONS_URL: DEAD })
  expect(res.code).toBe(0)
  const inv = invocations(r)
  expect(inv).toHaveLength(1)
  expect(modelOf(inv[0])).toBe('claude-opus-5-5')
  const o = rowLines(r)[0]
  expect(o?.route?.source).toBe('table')
  expect(o?.shadow?.unavailable).toBeTruthy()
}, 30_000)

test('9. the prompt text never appears in outcomes.jsonl', async () => {
  const r = rig()
  const secret = 'PELICAN-ORBIT-4417 rewrite the ledger reconciler'
  const res = await runRows(r, [{ label: 'secret', prompt: secret, kind: 'script' }])
  expect(res.code).toBe(0)
  expect(rowLines(r)).toHaveLength(1)        // a row line must exist for its absence of the prompt to mean anything
  const text = readFileSync(r.outcomes, 'utf8')
  expect(text).not.toContain('PELICAN-ORBIT-4417')
  expect(text).not.toContain('ledger reconciler')
}, 30_000)

test('10a. --verdict <rowId> correct appends a verdict line and runs no wrapper', async () => {
  const r = rig()
  await runRows(r, [{ label: 'judged', prompt: 'p', kind: 'script' }])
  const o = rowLines(r)[0]
  expect(o).toBeDefined()
  const before = invocations(r).length
  const res = await farm(r, ['--verdict', o.rowId, 'correct', 'looked right'])
  expect(res.code).toBe(0)
  const v = lines(r).filter(l => l.type === 'verdict')
  expect(v).toHaveLength(1)
  expect(v[0].rowId).toBe(o.rowId)
  expect(v[0].verdict).toBe('correct')
  expect(v[0].why).toBe('looked right')
  expect(typeof v[0].ts).toBe('string')
  expect(invocations(r).length).toBe(before)
}, 30_000)

test('10b. --verdict with a verdict other than correct|wrong exits 2 and appends nothing', async () => {
  const r = rig()
  await runRows(r, [{ label: 'judged', prompt: 'p', kind: 'script' }])
  const o = rowLines(r)[0]
  expect(o).toBeDefined()                     // the refusal must be about `maybe`, not a missing row
  const before = readFileSync(r.outcomes, 'utf8')
  const res = await farm(r, ['--verdict', o.rowId, 'maybe', 'unsure'])
  expect(res.code).toBe(2)
  expect(readFileSync(r.outcomes, 'utf8')).toBe(before)
}, 30_000)

test('10c. --verdict on an unknown rowId exits 2, appends nothing, runs no wrapper', async () => {
  const r = rig()
  await runRows(r, [{ label: 'judged', prompt: 'p', kind: 'script' }])
  expect(rowLines(r)).toHaveLength(1)        // a known row exists, so the refusal is about the id
  const before = readFileSync(r.outcomes, 'utf8')
  const nInv = invocations(r).length
  const res = await farm(r, ['--verdict', 'no-such-row-id', 'wrong', 'bad output'])
  expect(res.code).toBe(2)
  expect(readFileSync(r.outcomes, 'utf8')).toBe(before)
  expect(invocations(r).length).toBe(nInv)
}, 30_000)
