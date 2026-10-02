// The plugin guards (hooks/guards/mod.ts) under the mod kit, through the engine's own host: the
// module loads with no Node, the tool.call matcher routes, and a deny or a context reaches the
// result. Files come from a fake tree behind $.fs; the full input-by-input parity with the
// settings-hook scripts is tests/mod-guards-parity.test.ts.
import { expect, mock, test } from 'claude-code/testing'

type Tree = Record<string, string>

/** Stub the nouns the guards read: session, env, and $.fs over `tree` (a dir is any prefix). */
function world(on: Parameters<Parameters<typeof test>[1]>[1], tree: Tree, env: Record<string, string> = {}) {
  on('session.id', () => ({ value: 'S1' }))
  on('session.cwd', () => ({ value: '/w' }))
  mock.env(on, { TMPDIR: '/tmpx', ...env })
  const isDir = (p: string) => Object.keys(tree).some(k => k.startsWith(p.replace(/\/$/, '') + '/'))
  on('fs.read', (_$, e: { path: string }) => (e.path in tree ? { value: tree[e.path]! } : { deny: 'ENOENT' }))
  on('fs.stat', (_$, e: { path: string }) =>
    e.path in tree
      ? { value: { kind: 'file', size: tree[e.path]!.length, mtimeMs: 1, isLink: false } }
      : isDir(e.path)
        ? { value: { kind: 'dir', size: 0, mtimeMs: 1, isLink: false } }
        : { deny: 'ENOENT' },
  )
  on('fs.list', (_$, e: { path: string }) => {
    if (!isDir(e.path)) return { deny: 'ENOENT' }
    const base = e.path.replace(/\/$/, '') + '/'
    const names = [...new Set(Object.keys(tree).filter(k => k.startsWith(base)).map(k => k.slice(base.length).split('/')[0]!))]
    return { value: names.map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 1, isLink: false })) }
  })
  on('fs.write', (_$, e: { path: string; text: string }) => {
    tree[e.path] = e.text
    return { value: undefined }
  })
  on('tool.call', () => ({ result: 'ran' }))
}

test('an image Read is denied with the original-case path and the look-at script', async ($, on) => {
  world(on, {})
  const r = await $.tool.call({ tool: 'Read', file_path: '/w/Shot.PNG' })
  expect(r.deny).toContain('--file "/w/Shot.PNG"')
  expect(r.deny).toContain('/skills/look-at/scripts/look_at.sh')
})

test('a self-matching pkill is denied; a bracketed one runs', async ($, on) => {
  world(on, {})
  expect((await $.tool.call({ tool: 'Bash', command: 'pkill -f myjob' })).deny).toContain('kill it')
  expect(await $.tool.call({ tool: 'Bash', command: "pkill -f '[m]yjob'" })).toEqual({ result: 'ran' })
})

test('a serial multi-file bun test is denied; a parallel one and a single file run', async ($, on) => {
  world(on, {})
  expect((await $.tool.call({ tool: 'Bash', command: 'cd /w && bun test ./tests' })).deny).toContain('bun test --parallel')
  expect(await $.tool.call({ tool: 'Bash', command: 'bun test --parallel ./tests' })).toEqual({ result: 'ran' })
  expect(await $.tool.call({ tool: 'Bash', command: 'bun test ./tests/a.test.ts' })).toEqual({ result: 'ran' })
})

test('a headless farm child is guarded too (FARM_OUT_CHILD=1)', async ($, on) => {
  world(on, {}, { FARM_OUT_CHILD: '1' })
  expect((await $.tool.call({ tool: 'Monitor', command: 'rg foo' })).deny).toContain('has no path argument')
})

test('an Edit that leaves a Typst violation gets the convention context after the result', async ($, on) => {
  world(on, { '/w/deck.typ': '- a\n- b\n' })
  const r = await $.tool.call({ tool: 'Edit', file_path: 'deck.typ', old_string: 'x', new_string: 'y' })
  expect(r.result).toBe('ran')
  expect(r.context?.join('\n')).toContain('Line 1: Missing blank line between top-level bullets')
})

test('deleting the heartbeat of an in-flight work run is denied', async ($, on) => {
  world(on, { '/w/.work/run-a/args.json': '{"heartbeatCrons":["541afe58"]}\n' })
  const r = await $.tool.call({ tool: 'CronDelete', id: '541afe58' })
  expect(r.deny).toContain('.work/run-a/args.json records this cron in heartbeatCrons')
})

test('a gate that throws denies, naming itself', async ($, on) => {
  world(on, {})
  const r = await $.tool.call({ tool: 'Read', file_path: 7 as unknown as string })
  expect(r.deny).toContain('IMAGE READ GUARD: this gate crashed (throw: TypeError')
})

test('a guard answers deny or passes the result through, never anything that approves', async ($, on) => {
  world(on, {})
  for (const call of [
    { tool: 'Bash', command: 'ls' },
    { tool: 'Read', file_path: '/w/a.txt' },
    { tool: 'Write', file_path: '/w/a.txt', content: 'x' },
    { tool: 'CronCreate', cron: '* * * * *', prompt: 'p' },
  ] as const) {
    const r = await $.tool.call(call as never)
    expect(Object.keys(r).sort()).toEqual(['result'])
  }
})
