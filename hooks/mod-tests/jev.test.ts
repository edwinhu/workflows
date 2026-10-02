// The per-edit Jev mod (hooks/jev/mod.ts, entered through hooks/register.ts) under the mod kit:
// `scripts/mod-test.sh`. No network and no real process: $.process.run is answered by a fake
// rule-check that records its argv and stdin, so "one Jev call per edit" is one batched rule-check
// run per edit, and the fake decides what Jev said.
import { expect, mock, test } from 'claude-code/testing'

type Tree = Record<string, string>
type Run = { argv: readonly string[]; stdin?: string }

const NOW = 1_800_000_000_000
const HEDGE = 'The prose hedges more than its evidence warrants'

function world(
  on: any,
  opts: { tree?: Tree; env?: Record<string, string>; surfaces?: string[]; verdicts?: { rule: string; p: number; statement?: string }[]; fail?: 'throw' | 'exit' } = {},
) {
  const tree: Tree = { ...(opts.tree ?? {}) }
  const runs: Run[] = []
  const logs: string[] = []
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/u', TMPDIR: '/tmpx', ...(opts.env ?? {}) })
  on('session.id', () => ({ value: 'S1' }))
  on('session.cwd', () => ({ value: '/home/u/p' }))
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['terminal'] }))
  on('fs.read', (_$: any, e: any) => (e.path in tree ? { value: tree[e.path] } : { deny: 'ENOENT' }))
  on('fs.stat', (_$: any, e: any) =>
    e.path in tree ? { value: { kind: 'file', size: tree[e.path]!.length, mtimeMs: 1, isLink: false } } : { deny: 'ENOENT' })
  on('fs.list', () => ({ deny: 'ENOENT' }))
  on('fs.write', (_$: any, e: any) => { tree[e.path] = e.text; return { value: undefined } })
  on('ui.log', (_$: any, e: any) => { logs.push(e.text); return { value: undefined } })
  on('process.run', (_$: any, e: any) => {
    const argv = e.argv as readonly string[]
    if (argv[0] === 'git') return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    runs.push({ argv, stdin: e.init?.stdin })
    if (opts.fail === 'throw') return { deny: 'spawn bun ENOENT' }
    if (opts.fail === 'exit') return { value: { exitCode: 1, stdout: '', stderr: 'evidence.py failed', isStdoutTruncated: false, isStderrTruncated: false } }
    const verdicts = opts.verdicts ?? []
    const stdout = JSON.stringify({ verdicts, unavailable: [] })
    return { value: { exitCode: verdicts.some(v => v.p >= 0.85) ? 2 : 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // The tool itself: the edit lands in the tree, then answers.
  on('tool.call', (_$: any, e: any) => {
    if (e.tool === 'Write') tree[e.file_path.startsWith('/') ? e.file_path : `/home/u/p/${e.file_path}`] = e.content
    if (e.new_string === 'BOOM') return { isError: true, result: 'String to replace not found', text: 'String to replace not found' }
    return { result: 'ran' }
  })
  return { tree, runs, logs, clock }
}

const hedgy = { rule: 'W-HEDGE', p: 0.93, statement: HEDGE }
const write = (file_path: string, content = 'It may perhaps possibly be the case.\n') => ({ tool: 'Write', file_path, content }) as const
const jevLines = (r: any) => (r.context ?? []).filter((c: string) => c.includes('Jev '))

test('a prose Write with a rule at p >= 0.85 gets one Jev line after the result, from ONE batched rule-check run', async ($, on) => {
  const w = world(on, { verdicts: [hedgy, { rule: 'W-ATTRIB', p: 0.4, statement: 'x' }, { rule: 'W-SIGNPOST', p: 0.84, statement: 'y' }] })
  const r = await $.tool.call(write('notes/a.md'))
  expect(r.result).toBe('ran')
  expect(r.deny).toBeUndefined()
  expect(jevLines(r)).toEqual([`Jev W-HEDGE: notes/a.md:1 — ${HEDGE} (p=0.93)`])
  expect(w.runs.length).toBe(1)
  const argv = w.runs[0]!.argv
  expect(argv).toContain('--batch')
  expect(argv[argv.indexOf('--rules') + 1]!.endsWith('/constraints/jev/writing')).toBe(true)
  expect(argv.some(a => a.includes('uncalibrated'))).toBe(false)
  expect(argv[argv.indexOf('--files') + 1]).toBe('/home/u/p/notes/a.md')
  expect(JSON.parse(w.runs[0]!.stdin!)).toEqual({ '/home/u/p/notes/a.md': [[1, 1]] })
})

test('nothing reaches the bar: the result comes back with no Jev line', async ($, on) => {
  world(on, { verdicts: [{ ...hedgy, p: 0.2 }] })
  const r = await $.tool.call(write('/home/u/p/clean.md', 'The rate rose by two points.\n'))
  expect(r.result).toBe('ran')
  expect(jevLines(r)).toEqual([])
})

test('an Edit reports the lines its new string occupies; a .py under a ds workflow uses the ds rules', async ($, on) => {
  const w = world(on, {
    tree: {
      '/home/u/p/.planning/ACTIVE_WORKFLOW.md': '---\nworkflow: ds\n---\n',
      '/home/u/p/src/build.py': 'import polars as pl\n\nx = raw.filter(a)\ny = x.join(b)\n',
    },
    verdicts: [{ rule: 'DQ4', p: 0.9, statement: 'The row-count chain is BROKEN' }],
  })
  const r = await $.tool.call({ tool: 'Edit', file_path: 'src/build.py', old_string: 'q', new_string: 'x = raw.filter(a)\ny = x.join(b)' })
  expect(jevLines(r)).toEqual(['Jev DQ4: src/build.py:3-4 — The row-count chain is BROKEN (p=0.90)'])
  const argv = w.runs[0]!.argv
  expect(argv[argv.indexOf('--rules') + 1]!.endsWith('/constraints/jev')).toBe(true)
})

test('a file no rule set covers is left alone: no run, no context', async ($, on) => {
  const w = world(on, { tree: { '/home/u/p/src/build.py': 'x = 1\n' }, verdicts: [hedgy] })
  await $.tool.call(write('/home/u/p/data.json', '{}'))
  await $.tool.call({ tool: 'Edit', file_path: '/home/u/p/src/build.py', old_string: 'y', new_string: 'x = 1' })
  expect(w.runs.length).toBe(0)
})

test('a rule-check that cannot start adds nothing and goes to the debug log', async ($, on) => {
  const w = world(on, { verdicts: [hedgy], fail: 'throw' })
  const r = await $.tool.call(write('/home/u/p/throw.md'))
  expect(r.result).toBe('ran')
  expect(r.deny).toBeUndefined()
  expect(jevLines(r)).toEqual([])
  expect(w.logs.some(l => l.startsWith('jev-edit:'))).toBe(true)
})

test('a rule-check that exits with no JSON adds nothing and goes to the debug log', async ($, on) => {
  const w = world(on, { verdicts: [hedgy], fail: 'exit' })
  const r = await $.tool.call(write('/home/u/p/exit.md'))
  expect(r.result).toBe('ran')
  expect(r.deny).toBeUndefined()
  expect(jevLines(r)).toEqual([])
  expect(w.logs.some(l => l.startsWith('jev-edit:'))).toBe(true)
})

test('an errored edit is not scored', async ($, on) => {
  const w = world(on, { verdicts: [hedgy] })
  const r = await $.tool.call({ tool: 'Edit', file_path: '/home/u/p/a.md', old_string: 'x', new_string: 'BOOM' })
  expect(r.isError).toBe(true)
  expect(w.runs.length).toBe(0)
})

test('debounce: one evaluation per file per 10 s; later edits in the window collapse into one deferred evaluation', async ($, on) => {
  const w = world(on, { verdicts: [hedgy] })
  const first = await $.tool.call(write('/home/u/p/a.md'))
  expect(jevLines(first).length).toBe(1)
  await w.clock.advance(2_000)
  const second = await $.tool.call(write('/home/u/p/a.md', 'one\nIt may possibly be.\n'))
  await w.clock.advance(1_000)
  const third = await $.tool.call(write('/home/u/p/a.md', 'one\ntwo\nIt may possibly be.\n'))
  expect(jevLines(second)).toEqual([])
  expect(jevLines(third)).toEqual([])
  expect(w.runs.length).toBe(1)
  // another file has its own window
  await $.tool.call(write('/home/u/p/b.md'))
  expect(w.runs.length).toBe(2)
  await w.clock.advance(7_000)
  await w.clock.settle()
  // the third edit superseded the second: ONE deferred run over both edits' lines
  expect(w.runs.length).toBe(3)
  expect(JSON.parse(w.runs[2]!.stdin!)).toEqual({ '/home/u/p/a.md': [[1, 3]] })
  expect(w.logs.filter(l => l.includes('failed'))).toEqual([])
  // its line rides the next tool result, whatever the tool, once
  const next = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(jevLines(next)).toEqual([`Jev W-HEDGE: a.md:1-3 — ${HEDGE} (p=0.93)`])
  expect(jevLines(await $.tool.call({ tool: 'Bash', command: 'ls' }))).toEqual([])
})

test('headless with no JEV_EDIT_MOD: off', async ($, on) => {
  const w = world(on, { surfaces: [], env: {}, verdicts: [hedgy] })
  await $.tool.call(write('/home/u/p/h.md'))
  expect(w.runs.length).toBe(0)
})

test('headless with JEV_EDIT_MOD=1: on', async ($, on) => {
  const w = world(on, { surfaces: [], env: { JEV_EDIT_MOD: '1' }, verdicts: [hedgy] })
  await $.tool.call(write('/home/u/p/h.md'))
  expect(w.runs.length).toBe(1)
})

test('interactive with JEV_EDIT_MOD=0: off', async ($, on) => {
  const w = world(on, { surfaces: ['terminal'], env: { JEV_EDIT_MOD: '0' }, verdicts: [hedgy] })
  await $.tool.call(write('/home/u/p/h.md'))
  expect(w.runs.length).toBe(0)
})

test('never a decision: the result is what the tool settled to, plus context at most', async ($, on) => {
  world(on, { verdicts: [hedgy] })
  for (const call of [write('/home/u/p/x.md'), { tool: 'Edit', file_path: '/home/u/p/y.sh', old_string: 'a', new_string: 'b' }] as const) {
    const r: any = await $.tool.call(call)
    expect(r.deny).toBeUndefined()
    expect(r.result).toBe('ran')
    for (const k of Object.keys(r)) expect(['result', 'context', 'ref', 'text', 'isReadOnly']).toContain(k)
  }
})
