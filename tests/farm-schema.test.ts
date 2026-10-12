import { test, expect, setDefaultTimeout } from 'bun:test'
import { writeFileSync, readFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()
setDefaultTimeout(60_000)

const FARM = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm.sh')

const SCHEMA = {
  type: 'object', required: ['findings'],
  properties: { findings: { type: 'array', items: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } } } },
}
const VALUE = { findings: [{ title: 'off by one' }] }

/**
 * A stub claude-code that records its argv (one arg per line) and stdin, then streams a result event
 * carrying `structured_output` (STUB_SO, raw JSON; absent means null) and a prose `result`. With
 * STUB_SELF set it first writes that text to the path, as an agent that writes its own deliverable.
 * Measured 2026-10-04 on claude 2.1.287: the validated value arrives as `.structured_output` on the
 * `result` event of the stream-json output, null when the child never called StructuredOutput.
 */
function rig() {
  const root = mkTmp('farm-schema-')
  const bin = join(root, 'bin'); mkdirSync(bin, { recursive: true })
  const cwd = join(root, 'cwd'); mkdirSync(cwd, { recursive: true })
  writeFileSync(join(bin, 'claude-code'), `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${root}/argv"
cat > "${root}/stdin"
[ -n "\${STUB_SELF:-}" ] && printf '%s' "$STUB_SELF_TEXT" > "$STUB_SELF"
printf '%s\\n' '{"type":"assistant","message":{"id":"m1","model":"claude-sonnet-5-5","content":[{"type":"tool_use","id":"t","name":"Read","input":{}}]}}'
jq -cn --argjson so "\${STUB_SO:-null}" '{type:"result",subtype:"success",result:"Here is my review, in prose.",structured_output:$so}'
`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root, FARM_OUT_CHILD: '1',
                FARM_OUTCOMES: join(root, 'farm-outcomes.jsonl'), CLAUDE_CODE_SESSION_ID: '' }
  const run = (rows: any[], extra: Record<string, string> = {}) => {
    const tasks = join(root, 'tasks.json')
    writeFileSync(tasks, JSON.stringify(rows))
    const res = spawnSync('bash', [FARM, '--provider', 'claude', '--tasks', tasks, '--cwd', cwd],
      { encoding: 'utf8', env: { ...env, ...extra }, timeout: 120_000 })
    let out: any = null
    try { out = JSON.parse(res.stdout) } catch {}
    return { res, out, row: out?.[0] }
  }
  const argv = () => existsSync(join(root, 'argv')) ? readFileSync(join(root, 'argv'), 'utf8').split('\n') : []
  const schemaArg = () => { const a = argv(); const i = a.indexOf('--json-schema'); return i < 0 ? null : a[i + 1] }
  return { root, cwd, run, argv, schemaArg, stdin: () => readFileSync(join(root, 'stdin'), 'utf8') }
}

test('a row "schema" object reaches the CLI as --json-schema, and its structured value becomes the expect file', () => {
  const r = rig()
  const out = join(r.root, 'run', 'lens.json')
  const { res, row } = r.run([{ label: 'lens', prompt: 'review', schema: SCHEMA, expect: out }], { STUB_SO: JSON.stringify(VALUE) })
  expect(JSON.parse(r.schemaArg()!)).toEqual(SCHEMA)
  expect(r.argv()).toContain('stream-json')
  expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(VALUE)
  // only the structured value, never the prose reply
  expect(readFileSync(out, 'utf8')).not.toContain('prose')
  expect(row.ok, res.stderr).toBe(true)
  expect(row.missing).toEqual([])
  // the child is told to return through StructuredOutput, not to Write the file
  expect(r.stdin()).toContain('StructuredOutput')
  expect(r.stdin()).not.toContain('Write your deliverable')
})

test('a row "schema" given as a file path passes that file\'s schema', () => {
  const r = rig()
  const sp = join(r.root, 'lens.schema.json'); writeFileSync(sp, JSON.stringify(SCHEMA))
  const out = join(r.root, 'lens.json')
  const { row } = r.run([{ label: 'lens', prompt: 'review', schema: sp, expect: out }], { STUB_SO: JSON.stringify(VALUE) })
  expect(JSON.parse(r.schemaArg()!)).toEqual(SCHEMA)
  expect(row.ok).toBe(true)
})

test('no structured value (the child never returned one) -> nothing written, the expect is missing, the row fails', () => {
  const r = rig()
  const out = join(r.root, 'lens.json')
  const { row } = r.run([{ label: 'lens', prompt: 'review', schema: SCHEMA, expect: out }])
  expect(existsSync(out)).toBe(false)
  expect(row.ok).toBe(false)
  expect(row.missing).toEqual([out])
})

test('a child that wrote the expect file itself keeps its file; the structured value does not overwrite it', () => {
  const r = rig()
  const out = join(r.root, 'lens.json')
  const own = JSON.stringify({ findings: [{ title: 'written by the agent' }] })
  const { row } = r.run([{ label: 'lens', prompt: 'review', schema: SCHEMA, expect: out }],
    { STUB_SO: JSON.stringify(VALUE), STUB_SELF: out, STUB_SELF_TEXT: own })
  expect(readFileSync(out, 'utf8')).toBe(own)
  expect(row.ok).toBe(true)
})

test('a row without "schema" passes no --json-schema and keeps the Write instruction', () => {
  const r = rig()
  const out = join(r.root, 'out.md')
  r.run([{ label: 'plain', prompt: 'p', expect: out }], { STUB_SELF: out, STUB_SELF_TEXT: 'x' })
  expect(r.argv()).not.toContain('--json-schema')
  expect(r.stdin()).toContain('Write your deliverable')
})

test('an unusable "schema" is refused before any row runs', () => {
  for (const schema of [42, '[1,2]', '/no/such/schema.json', '{not json']) {
    const r = rig()
    const { res } = r.run([{ label: 'lens', prompt: 'review', schema, expect: join(r.root, 'l.json') }])
    expect(res.status, `${JSON.stringify(schema)}: ${res.stderr}`).not.toBe(0)
    expect(res.stderr).toMatch(/schema/)
    expect(existsSync(join(r.root, 'argv'))).toBe(false)
  }
})

test('a schema row with two expect paths is refused: the structured value has one destination', () => {
  const r = rig()
  const { res } = r.run([{ label: 'lens', prompt: 'review', schema: SCHEMA, expect: [join(r.root, 'a.json'), join(r.root, 'b.json')] }])
  expect(res.status).not.toBe(0)
  expect(res.stderr).toMatch(/schema/)
  expect(existsSync(join(r.root, 'argv'))).toBe(false)
})
