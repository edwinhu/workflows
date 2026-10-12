/**
 * farm.sh `sandbox: true` rows: the child keeps its own network (it must reach the model), but every
 * shell command it spawns -- Bash tool calls, hooks -- goes through CLAUDE_CODE_SHELL_PREFIX into ONE
 * bubblewrap sandbox per row: the project dir, the external targets of its symlinks (data/ -> external
 * storage) and $HOME as overlays over a throwaway tmpfs, no network. A write succeeds there and is gone
 * when the row ends; the real file is byte-unchanged. lens.json is still written by farm.sh, outside.
 *
 * The stub claude-code calls the prefix exactly as claude 2.1.287 was measured to (2026-10-04): one
 * argument, the whole invocation, ending `pwd -P >| $TMPDIR/claude-<pid>-cwd`.
 */
import { test, expect, setDefaultTimeout } from 'bun:test'
import { writeFileSync, readFileSync, mkdirSync, chmodSync, existsSync, symlinkSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()
setDefaultTimeout(60_000)

const FARM = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm.sh')
const SANDBOX = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'sandbox.sh')
const HAVE_BWRAP = spawnSync('bash', ['-c', 'command -v bwrap && command -v nsenter'], { timeout: 10_000 }).status === 0

const SCHEMA = { type: 'object', required: ['findings'], properties: { findings: { type: 'array' } } }
const VALUE = { findings: [{ title: 'ran the build; it rewrites the panel' }] }
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')

function rig() {
  const root = mkTmp('farm-sandbox-')
  const bin = join(root, 'bin'); mkdirSync(bin, { recursive: true })
  const proj = join(root, 'proj'); mkdirSync(join(proj, 'scripts'), { recursive: true })
  // Same path length as proj, on purpose: an overlay set deduped on length alone dropped it (measured).
  const ext = join(root, 'data'); mkdirSync(join(ext, 'output'), { recursive: true })
  writeFileSync(join(ext, 'output', 'panel.csv'), 'firm,val\na,1\n')
  symlinkSync(ext, join(proj, 'data'))
  writeFileSync(join(proj, 'UNCOMMITTED.md'), 'an edit no commit holds\n')
  writeFileSync(join(proj, 'scripts', 'build.sh'), 'printf "firm,val\\nREWRITTEN,999\\n" > data/output/panel.csv && echo built\n')
  mkdirSync(join(proj, '.claude', 'agents'), { recursive: true })
  writeFileSync(join(proj, '.claude', 'agents', 'rev.md'),
    '---\nname: rev\ndescription: a reviewer\nmodel: sonnet\ntools: Read, Grep, Glob, Edit, StructuredOutput\n---\n\nYOU DO NOT EDIT. Judge it.\n')
  const expectPath = join(root, 'run', 'lens.json')
  const probe = `.farm-sandbox-probe-${root.split('-').pop()}`
  // Each Bash call, as Claude Code makes it: the prefix with ONE argument, stdout captured outside.
  writeFileSync(join(bin, 'claude-code'), `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${root}/argv"
cat > "${root}/stdin"
for i in "$@"; do [ "$prev" = --agents ] && cp -- "$i" "${root}/agents.json"; prev=$i; done
printf 'prefix=%s\\npid=%s\\ntmpdir=%s\\n' "\${CLAUDE_CODE_SHELL_PREFIX:-}" "\${FARM_SANDBOX_PID:-}" "$TMPDIR" > "${root}/env"
# Without a prefix these commands would hit the real tree: an unsandboxed row runs none of them.
call() { "$CLAUDE_CODE_SHELL_PREFIX" "eval '$1' < /dev/null && pwd -P >| $TMPDIR/claude-$$-cwd"; }
[ -n "\${CLAUDE_CODE_SHELL_PREFIX:-}" ] && {
  echo "== build";  call 'cat UNCOMMITTED.md; bash scripts/build.sh; tail -1 data/output/panel.csv'
  echo "== second"; call 'tail -1 data/output/panel.csv'
  echo "== ssh";    call 'ssh -F /dev/null -o BatchMode=yes -o ConnectTimeout=3 example.com true; echo ssh=$?'
  echo "== home";   call 'touch "$HOME/${probe}" && echo home-write-ok'
  echo "== lens";   call 'mkdir -p "${join(root, 'run')}" && echo forged > "${expectPath}" && echo forged-inside'
} > "${root}/bash.log" 2>&1
[ -s "$TMPDIR/claude-$$-cwd" ] && cp "$TMPDIR/claude-$$-cwd" "${root}/cwd-file"
printf '%s\\n' '{"type":"assistant","message":{"id":"m1","model":"claude-sonnet-5-5","content":[{"type":"tool_use","id":"t","name":"Bash","input":{}}]}}'
jq -cn --argjson so '${JSON.stringify(VALUE)}' '{type:"result",subtype:"success",result:"prose",structured_output:$so}'
`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  for (const w of ['codex-code', 'gemini-code']) { writeFileSync(join(bin, w), readFileSync(join(bin, 'claude-code'))); chmodSync(join(bin, w), 0o755) }
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root, FARM_OUT_CHILD: '1',
                FARM_OUTCOMES: join(root, 'farm-outcomes.jsonl'), CLAUDE_CODE_SESSION_ID: '' }
  const run = (rows: any[], provider = 'claude') => {
    const tasks = join(root, 'tasks.json')
    writeFileSync(tasks, JSON.stringify(rows.map(r => ({ workflow: 'none', ...r }))))
    const res = spawnSync('bash', [FARM, '--provider', provider, '--tasks', tasks, '--cwd', proj],
      { encoding: 'utf8', env, timeout: 120_000 })
    let out: any = null
    try { out = JSON.parse(res.stdout) } catch {}
    return { res, row: out?.[0] }
  }
  const read = (f: string) => existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : ''
  return { root, proj, ext, expectPath, probe, run, read, argv: () => read('argv').split('\n') }
}

test.skipIf(!HAVE_BWRAP)('a sandbox row: the child\'s commands write into data/ there, the real file is byte-unchanged, the network is gone, and farm.sh still writes lens.json outside', () => {
  const r = rig()
  const panel = join(r.ext, 'output', 'panel.csv')
  const before = sha(panel)
  const projBefore = readdirSync(r.proj).sort()
  const { res, row } = r.run([{ label: 'lens', prompt: 'review', agent: 'rev', sandbox: true, schema: SCHEMA, expect: r.expectPath }])
  const log = r.read('bash.log')
  expect(row?.ok, `${res.stderr}\n${log}`).toBe(true)
  // the uncommitted tree is what the sandbox sees, and the write into external data/ succeeds there
  expect(log).toContain('an edit no commit holds')
  expect(log).toMatch(/== build[\s\S]*built\nREWRITTEN,999/)
  // ONE sandbox per row: a second command sees the first one's write
  expect(log).toMatch(/== second\nREWRITTEN,999/)
  // ... and none of it reached the real tree or the real data
  expect(sha(panel)).toBe(before)
  expect(readFileSync(panel, 'utf8')).toBe('firm,val\na,1\n')
  expect(readdirSync(r.proj).sort()).toEqual(projBefore)
  // no network: ssh cannot resolve, let alone connect
  expect(log).toMatch(/== ssh\n.*(Could not resolve|Network is unreachable)[\s\S]*ssh=255/)
  // $HOME is an overlay too: a write succeeds and vanishes
  expect(log).toContain('home-write-ok')
  expect(existsSync(join(homedir(), r.probe))).toBe(false)
  // lens.json is farm.sh's write from the structured value, not the child's forged in-sandbox write
  expect(log).toContain('forged-inside')
  expect(JSON.parse(readFileSync(r.expectPath, 'utf8'))).toEqual(VALUE)
  // Claude Code's cwd tracking file lands in the child's TMPDIR, which is bound through
  expect(r.read('cwd-file').trim()).toBe(r.proj)
  // the sandbox is torn down with the row: holder gone, its TMPDIR removed
  const env = Object.fromEntries(r.read('env').trim().split('\n').map(l => l.split(/=(.*)/s).slice(0, 2)))
  expect(env.prefix).toBe(SANDBOX)
  expect(spawnSync('kill', ['-0', env.pid], { timeout: 10_000 }).status).not.toBe(0)
  expect(env.tmpdir).not.toBe(r.root)
  expect(existsSync(env.tmpdir)).toBe(false)
})

test.skipIf(!HAVE_BWRAP)('a sandbox row runs a derived agent: same prompt, writers removed, Bash added; no MCP; Edit/Write denied session-wide', () => {
  const r = rig()
  const { res, row } = r.run([{ label: 'lens', prompt: 'review', agent: 'rev', sandbox: true, schema: SCHEMA, expect: r.expectPath }])
  expect(row?.ok, res.stderr).toBe(true)
  const a = r.argv()
  expect(a[a.indexOf('--agent') + 1]).toBe('rev-sandboxed')
  expect(a).toContain('--strict-mcp-config')
  const deny = a[a.indexOf('--disallowedTools') + 1].split(',')
  for (const w of ['Edit', 'Write', 'NotebookEdit']) expect(deny).toContain(w)
  const def = JSON.parse(r.read('agents.json'))['rev-sandboxed']
  expect(def.tools).toEqual(['Read', 'Grep', 'Glob', 'StructuredOutput', 'Bash'])
  expect(def.prompt).toBe('YOU DO NOT EDIT. Judge it.\n')
  expect(def.model).toBe('sonnet')
  // the child is told what its Bash is
  expect(r.read('stdin')).toMatch(/sandbox/i)
})

test.skipIf(!HAVE_BWRAP)('a sandbox row whose agent has no file (a built-in) keeps --agent and still denies the writers', () => {
  const r = rig()
  const { row } = r.run([{ label: 'lens', prompt: 'review', agent: 'Explore', sandbox: true, schema: SCHEMA, expect: r.expectPath }])
  expect(row?.ok).toBe(true)
  const a = r.argv()
  expect(a[a.indexOf('--agent') + 1]).toBe('Explore')
  expect(a).not.toContain('--agents')
  expect(a[a.indexOf('--disallowedTools') + 1].split(',')).toContain('Write')
})

test('a row without "sandbox" runs exactly as before: no prefix, no sandbox flags', () => {
  const r = rig()
  r.run([{ label: 'lens', prompt: 'review', agent: 'rev', schema: SCHEMA, expect: r.expectPath }])
  expect(r.read('env')).toContain('prefix=\n')
  expect(r.argv()).not.toContain('--strict-mcp-config')
  expect(r.argv()).not.toContain('--disallowedTools')
  expect(r.argv()[r.argv().indexOf('--agent') + 1]).toBe('rev')
})

test('a non-boolean "sandbox" is refused before any row runs', () => {
  const r = rig()
  const { res } = r.run([{ label: 'lens', prompt: 'review', sandbox: 'yes', expect: r.expectPath }])
  expect(res.status).not.toBe(0)
  expect(res.stderr).toMatch(/sandbox/)
  expect(existsSync(join(r.root, 'argv'))).toBe(false)
})

test('the prefix fails closed: no live sandbox means the command never runs', () => {
  const marker = join(mkTmp('farm-sandbox-closed-'), 'ran')
  for (const pid of ['', String(process.pid), '999999999']) {
    const res = spawnSync(SANDBOX, [`touch ${marker}`], { encoding: 'utf8', env: { ...process.env, FARM_SANDBOX_PID: pid }, timeout: 10_000 })
    expect(res.status, `pid=${pid}`).not.toBe(0)
    expect(res.stderr).toMatch(/sandbox/)
    expect(existsSync(marker)).toBe(false)
  }
})

test('a sandbox row on a non-claude provider is refused: only Claude Code honours CLAUDE_CODE_SHELL_PREFIX', () => {
  for (const provider of ['codex', 'gemini']) {
    const r = rig()
    const { res } = r.run([{ label: 'lens', prompt: 'review', sandbox: true, expect: r.expectPath }], provider)
    expect(res.status, provider).not.toBe(0)
    expect(res.stderr).toMatch(/sandbox/)
    expect(existsSync(join(r.root, 'argv'))).toBe(false)
  }
})
