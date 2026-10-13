import { test, expect, setDefaultTimeout } from 'bun:test'
import { writeFileSync, readFileSync, mkdirSync, chmodSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from './helpers/tmp.ts'

setDefaultTimeout(240_000)

const mkTmp = useTmp()

const SCRIPTS = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts')
const FARM = join(SCRIPTS, 'farm.sh')
const TEAM = join(SCRIPTS, 'farm-team.sh')
const SPAWN_MS = 120_000

const SCHEMA = { type: 'object', required: ['n'], properties: { n: { type: 'number' } } }

/** An expect file that existed before the row started: written an hour ago, as a previous row would have. */
function stale(path: string, text = 'from the previous row\n') {
  writeFileSync(path, text)
  const past = Date.now() / 1000 - 3600
  utimesSync(path, past, past)
}

/** A stub claude-code: with STUB_SELF it writes STUB_SELF_TEXT there; it streams one result event carrying STUB_SO. */
function rig() {
  const root = mkTmp('farm-expect-fresh-')
  const bin = join(root, 'bin'); mkdirSync(bin, { recursive: true })
  const cwd = join(root, 'cwd'); mkdirSync(cwd, { recursive: true })
  writeFileSync(join(bin, 'claude-code'), `#!/usr/bin/env bash
cat > /dev/null
[ -n "\${STUB_SELF:-}" ] && printf '%s' "$STUB_SELF_TEXT" > "$STUB_SELF"
printf '%s\\n' '{"type":"assistant","message":{"id":"m1","model":"claude-sonnet-5-5","content":[{"type":"tool_use","id":"t","name":"Read","input":{}}]}}'
jq -cn --argjson so "\${STUB_SO:-null}" '{type:"result",subtype:"success",result:"done",structured_output:$so}'
`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  const outcomes = join(root, 'farm-outcomes.jsonl')
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root, FARM_OUT_CHILD: '1',
                FARM_OUTCOMES: outcomes, CLAUDE_CODE_SESSION_ID: '' }
  const run = (rows: any[], extra: Record<string, string> = {}) => {
    const tasks = join(root, 'tasks.json')
    writeFileSync(tasks, JSON.stringify(rows.map(r => ({ workflow: 'none', ...r }))))
    const res = spawnSync('bash', [FARM, '--provider', 'claude', '--tasks', tasks, '--cwd', cwd],
      { encoding: 'utf8', env: { ...env, ...extra }, timeout: SPAWN_MS })
    let out: any = null
    try { out = JSON.parse(res.stdout) } catch {}
    return { res, row: out?.[0] }
  }
  const team = (expects: string[], extra: Record<string, string> = {}) => {
    const pf = join(root, 'team-prompt.txt'); writeFileSync(pf, 'lead the team')
    return spawnSync('bash', [TEAM, '--provider', 'claude', '--prompt-file', pf, '--cwd', cwd,
                              ...expects.flatMap(e => ['--expect', e])],
      { encoding: 'utf8', env: { ...env, ...extra }, timeout: SPAWN_MS })
  }
  const verdicts = () => readFileSync(outcomes, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(l => l.type === 'verdict')
  return { root, cwd, run, team, verdicts }
}

test('an expect file that existed before the row and was left untouched fails the row, named as not written this run', () => {
  const r = rig()
  const out = join(r.cwd, 'report.md'); stale(out)
  const { res, row } = r.run([{ label: 'repair', prompt: 'repair it', expect: out }])
  expect(row?.ok, res.stderr).toBe(false)
  expect(row.missing).toEqual([`not written this run: ${out}`])
  expect(res.stderr).toContain(`not written this run: ${out}`)
  const v = r.verdicts()
  expect(v).toHaveLength(1)
  expect(v[0].verdict).toBe('wrong')
  expect(v[0].why).toContain(`not written this run: ${out}`)
}, 240_000)

test('a relative expect path that existed before the row is resolved against --cwd and fails the same way', () => {
  const r = rig()
  mkdirSync(join(r.cwd, 'scratch'), { recursive: true })
  stale(join(r.cwd, 'scratch', 'report.md'))
  const { res, row } = r.run([{ label: 'repair', prompt: 'repair it', expect: 'scratch/report.md' }])
  expect(row?.ok, res.stderr).toBe(false)
  expect(row.missing).toEqual(['not written this run: scratch/report.md'])
}, 240_000)

test('the same pre-existing file rewritten by the child counts as delivered', () => {
  const r = rig()
  const out = join(r.cwd, 'report.md'); stale(out)
  const { res, row } = r.run([{ label: 'repair', prompt: 'repair it', expect: out }],
    { STUB_SELF: out, STUB_SELF_TEXT: 'repaired\n' })
  expect(row?.ok, res.stderr).toBe(true)
  expect(row.missing).toEqual([])
  expect(readFileSync(out, 'utf8')).toBe('repaired\n')
}, 240_000)

test('a missing expect is still reported as the bare path', () => {
  const r = rig()
  const out = join(r.cwd, 'never.md')
  const { res, row } = r.run([{ label: 'repair', prompt: 'p', expect: out }])
  expect(row?.ok, res.stderr).toBe(false)
  expect(row.missing).toEqual([out])
}, 240_000)

test('a schema row whose value the runner writes counts as written this run', () => {
  const r = rig()
  const out = join(r.cwd, 'lens.json')
  const { res, row } = r.run([{ label: 'lens', prompt: 'review', schema: SCHEMA, expect: out }], { STUB_SO: '{"n":1}' })
  expect(row?.ok, res.stderr).toBe(true)
  expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({ n: 1 })
}, 240_000)

test('a schema row over a stale expect file: the runner replaces it with this run\'s value and the row is ok', () => {
  const r = rig()
  const out = join(r.cwd, 'lens.json'); stale(out, '{"n":0}\n')
  const { res, row } = r.run([{ label: 'lens', prompt: 'review', schema: SCHEMA, expect: out }], { STUB_SO: '{"n":2}' })
  expect(row?.ok, res.stderr).toBe(true)
  expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({ n: 2 })
}, 240_000)

test('a schema row over a stale expect file with no structured value fails as not written this run', () => {
  const r = rig()
  const out = join(r.cwd, 'lens.json'); stale(out, '{"n":0}\n')
  const { res, row } = r.run([{ label: 'lens', prompt: 'review', schema: SCHEMA, expect: out }])
  expect(row?.ok, res.stderr).toBe(false)
  expect(row.missing).toEqual([`not written this run: ${out}`])
  expect(readFileSync(out, 'utf8')).toBe('{"n":0}\n')
}, 240_000)

test('farm-team.sh: a pre-existing untouched expect is UNVERIFIED as not written this run; a rewritten one verifies', () => {
  const r = rig()
  const out = join(r.root, 'team.md'); stale(out)
  const bad = r.team([out])
  expect(bad.status, bad.stderr).toBe(1)
  expect(bad.stderr).toContain(`not written this run: ${out}`)
  stale(out)
  const good = r.team([out], { STUB_SELF: out, STUB_SELF_TEXT: 'team wrote this\n' })
  expect(good.status, good.stderr).toBe(0)
  expect(good.stdout).toContain(`verified: ${out}`)
}, 240_000)

test('a row with no expect is not failed by its --cwd directory being older than the row', () => {
  const r = rig()
  const past = Date.now() / 1000 - 3600
  utimesSync(r.cwd, past, past)
  const { res, row } = r.run([{ label: 'free', prompt: 'p' }])
  expect(row?.ok, res.stderr).toBe(true)
  expect(row.missing).toEqual([])
}, 240_000)
