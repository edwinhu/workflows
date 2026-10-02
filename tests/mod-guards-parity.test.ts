/**
 * PARITY: every guard the mod took over from hooks.json gives the same answer as the settings-hook
 * script it replaced, on the same recorded inputs.
 *
 * WHERE THE INPUTS COME FROM. The existing suites, run here with GUARD_PARITY_RECORD set: the golden
 * cases of the five guards that have them, plus the spawn-based tests of pgrep-self-match,
 * cron-delete-guard (both halves), read-guard, work-abandon and typst-convention-guard. Each script invocation records its
 * stdin, cwd, environment and every file it observed (hooks/guards/cli.ts). Nothing here restates a
 * fixture.
 *
 * WHAT IS COMPARED. Each record's world is rebuilt in a fresh sandbox (temp paths rebased into it),
 * then fed to (1) the script, spawned as hooks.json spawned it, and (2) the mod's tool.call handler
 * from registerGuards, narrowed to that one guard, over a node-backed `$`. The deny text, the
 * context text, and the files left behind must be identical. When git can produce the pre-port tree
 * (PARITY_BASE, default the commit before the port), (3) the ORIGINAL script runs too and must agree.
 *
 * WHAT CANNOT REACH A MOD. A payload that is not a JSON object, or whose tool_input is not an object:
 * the engine hands a tool.call hook the tool's parsed arguments, never raw stdin. Those records are
 * counted and named, not compared.
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { GUARDS, registerGuards, TOOLS, type GuardSpec } from '../hooks/guards/mod.ts'

const REPO = join(import.meta.dir, '..')
const BASE = process.env.PARITY_BASE ?? '3f97c10f'
const P = tmpdir()

interface Observed { stat?: { kind: string; size: number; mtimeMs: number } | null; text?: string | null; list?: string[] | null }
interface Rec {
  script: string; args: string[]; cwd: string; env: Record<string, string>
  stdin: string; observed: Record<string, Observed>; stdout: string; exit: number
}

// ── record ─────────────────────────────────────────────────────────────────────────────────────
const tape = join(mkdtempSync(join(P, 'parity-tape-')), 'tape.jsonl')
const recEnv = { ...process.env, GUARD_PARITY_RECORD: tape }
const sources: [string, string[]][] = [
  ['bun', ['scripts/hook-golden.ts', 'image-read-guard', 'suggest-compact', 'atomic-constraint-guard', 'typst-convention-guard', 'validate-skill-paths', '--quiet']],
  ['bun', ['test', 'tests/pgrep-self-match.test.ts', 'tests/cron-delete-guard.test.ts', 'hooks/read-guard.test.ts', 'tests/work-abandon.test.ts']],
  // The typst goldens all assert silence; this harness holds the cases that report.
  ['bun', ['tests/typst-convention-guard.test.mjs']],
]
for (const [cmd, argv] of sources) {
  const r = spawnSync(cmd, argv, { cwd: REPO, env: recEnv, encoding: 'utf8', timeout: 300_000 })
  if (r.status !== 0) throw new Error(`recording source failed: ${cmd} ${argv.join(' ')}\n${r.stdout}\n${r.stderr}`)
}
const SCRIPTS = new Set(GUARDS.map(g => g.script.split(' ')[0]))
const records: Rec[] = readFileSync(tape, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  .filter((r: Rec) => SCRIPTS.has(r.script))

/** The guard a record exercised. */
function specOf(r: Rec): GuardSpec {
  const name = r.args.includes('--record') ? `${r.script} --record` : r.script
  return GUARDS.find(g => g.script === name)!
}

/** Why a record cannot reach a tool.call hook, or null when it can. */
function unreachable(r: Rec): string | null {
  let p: unknown
  try {
    p = JSON.parse(r.stdin)
  } catch {
    return 'stdin is not JSON'
  }
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return 'payload is not an object'
  const ti = (p as Record<string, unknown>).tool_input
  if (ti !== undefined && (ti === null || typeof ti !== 'object' || Array.isArray(ti))) return 'tool_input is not an object'
  if (typeof (p as Record<string, unknown>).tool_name !== 'string') return 'tool_name is not a string'
  return null
}

// ── replay ─────────────────────────────────────────────────────────────────────────────────────
const SANDBOX = mkdtempSync(join(P, 'parity-sb-'))
const rebase = (s: string): string => s.replaceAll(P + '/', SANDBOX + '/')
const unbase = (s: string): string => s.replaceAll(SANDBOX + '/', '<P>/')

/** Files created outside the temp tree for one run, removed before the next. */
const placed: string[] = []
function unplace(): void {
  for (const p of placed.splice(0)) rmSync(p, { force: true })
}

/**
 * A path outside the temp tree (a test fixture written into the repo, a real repo file) is not
 * rebased. One the record saw that is gone now is put back for the run; one that exists but no
 * longer matches what the record saw fails the case, rather than comparing two runs over a world
 * neither of them was recorded in.
 */
function placeOutside(p: string, o: Observed): void {
  const now = existsSync(p) ? statSync(p) : null
  const sawFile = typeof o.text === 'string' || o.stat?.kind === 'file'
  if (!sawFile) {
    if (now && (o.stat === null || o.text === null) && !o.list) throw new Error(`world drift: ${p} was absent when recorded`)
    return
  }
  if (now) {
    const same = typeof o.text === 'string' ? readFileSync(p, 'utf8') === o.text : now.size === o.stat!.size
    if (!same) throw new Error(`world drift: ${p} changed since it was recorded`)
    return
  }
  writeFileSync(p, typeof o.text === 'string' ? o.text : '')
  if (typeof o.text !== 'string') truncateSync(p, o.stat!.size)
  placed.push(p)
}

/** Rebuild the record's observed world under SANDBOX: files, sizes, listed names, mtimes. */
function materialize(r: Rec): void {
  unplace()
  rmSync(SANDBOX, { recursive: true, force: true })
  mkdirSync(SANDBOX, { recursive: true })
  const files: [string, Observed][] = []
  for (const [raw, o] of Object.entries(r.observed)) {
    const abs = raw.startsWith('/') ? raw : join(r.cwd, raw)
    if (!abs.startsWith(P + '/')) {
      placeOutside(abs, o)
      continue
    }
    const p = rebase(abs)
    // Its directory existed when the guard looked, whatever the guard found there.
    mkdirSync(dirname(p), { recursive: true })
    if (o.list) for (const n of o.list) mkdirSync(join(p, n), { recursive: true })
    if (o.stat?.kind === 'dir') mkdirSync(p, { recursive: true })
    if (typeof o.text === 'string' || o.stat?.kind === 'file') files.push([p, o])
  }
  for (const [p, o] of files) {
    if (existsSync(p) && statSync(p).isDirectory()) rmSync(p, { recursive: true })
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, typeof o.text === 'string' ? o.text : '')
    if (typeof o.text !== 'string' && o.stat) truncateSync(p, o.stat.size)
  }
  for (const [p, o] of files) if (o.stat) utimesSync(p, o.stat.mtimeMs / 1000, o.stat.mtimeMs / 1000)
  mkdirSync(rebase(r.cwd), { recursive: true })
}

/** Every file under SANDBOX with its text: the filesystem effect of a run. */
function snapshot(): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) out[relative(SANDBOX, p)] = statSync(p).size > 1 << 20 ? `<${statSync(p).size} bytes>` : readFileSync(p, 'utf8')
    }
  }
  walk(SANDBOX)
  return out
}

interface Outcome { deny?: string; context?: string; files: Record<string, string> }

function childEnv(r: Rec): Record<string, string> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }
  for (const [k, v] of Object.entries(r.env)) env[k] = rebase(v)
  return env
}

/** The settings-hook script, spawned the way hooks.json spawns it. */
function runScript(r: Rec, root: string): Outcome {
  materialize(r)
  const res = spawnSync('bun', [join(root, 'hooks', r.script), ...r.args], {
    cwd: rebase(r.cwd), input: rebase(r.stdin), env: childEnv(r), encoding: 'utf8', timeout: 30_000,
  })
  const out: Outcome = { files: snapshot() }
  const text = (res.stdout ?? '').trim()
  if (text) {
    const o = JSON.parse(text).hookSpecificOutput
    if (o.permissionDecision === 'deny') out.deny = unbase(o.permissionDecisionReason.replaceAll(root, REPO))
    if (o.additionalContext !== undefined) out.context = unbase(o.additionalContext)
  }
  return out
}

/** A `$` over node fs with the real nouns' contract: read and stat reject a missing path. */
function fakeEngine(r: Rec, payload: Record<string, unknown>) {
  const env = childEnv(r)
  return {
    plugin: { name: 'workflows', root: REPO },
    session: {
      id: async () => (typeof payload.session_id === 'string' ? payload.session_id : ''),
      cwd: async () => (typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : rebase(r.cwd)),
    },
    env: { get: async (n: string) => env[n] },
    fs: {
      read: async (p: string) => readFileSync(p, 'utf8'),
      stat: async (p: string) => {
        const s = statSync(p)
        return { kind: s.isFile() ? 'file' : s.isDirectory() ? 'dir' : 'other', size: s.size, mtimeMs: s.mtimeMs, isLink: false }
      },
      list: async (p: string) =>
        readdirSync(p, { withFileTypes: true }).map(d => ({
          name: d.name, kind: d.isFile() ? 'file' : d.isDirectory() ? 'dir' : 'other', size: 0, mtimeMs: 0, isLink: d.isSymbolicLink(),
        })),
      write: async (p: string, t: string) => {
        mkdirSync(dirname(p), { recursive: true }) // $.fs.write creates directories as needed
        writeFileSync(p, t)
      },
    },
  }
}

/** The mod's tool.call handler, narrowed to the record's guard, over the same payload. */
async function runHandler(r: Rec): Promise<Outcome & { keys: string[] }> {
  materialize(r)
  const payload = JSON.parse(rebase(r.stdin)) as Record<string, unknown>
  let hook: ((...a: unknown[]) => Promise<Record<string, unknown>>) | undefined
  const on = ((_event: string, _matcher: unknown, h: typeof hook) => {
    hook = h
    return { catch: () => undefined }
  }) as never
  registerGuards(on, [specOf(r)])
  const e = { tool: payload.tool_name, ...((payload.tool_input as object) ?? {}), tool_use_id: 'toolu_parity' }
  const next = async () => ({ result: payload.tool_response ?? 'ran' })
  const res = await hook!(fakeEngine(r, payload), e, next)
  const out: Outcome & { keys: string[] } = { files: snapshot(), keys: Object.keys(res).sort() }
  if (typeof res.deny === 'string') out.deny = unbase(res.deny)
  const ctx = res.context as string[] | undefined
  if (ctx?.length) out.context = unbase(ctx.join('\n'))
  return out
}

// The pre-port scripts, from git, when this checkout has the commit.
let baseRoot: string | null = null
{
  const dir = mkdtempSync(join(P, 'parity-base-'))
  const tar = spawnSync('bash', ['-c', `git -C "${REPO}" archive ${BASE} hooks | tar -x -C "${dir}"`], { timeout: 300_000, encoding: 'utf8' })
  if (tar.status === 0 && existsSync(join(dir, 'hooks', 'read-guard.ts'))) baseRoot = dir
}

// ── tests ──────────────────────────────────────────────────────────────────────────────────────
const reachable = records.filter(r => unreachable(r) === null)
const skipped = records.filter(r => unreachable(r) !== null)

test('the recorded inputs cover every ported guard', () => {
  const seen = new Set(reachable.map(r => specOf(r).script))
  expect([...seen].sort()).toEqual(GUARDS.map(g => g.script).sort())
  console.log(
    `parity: ${records.length} recorded invocations, ${reachable.length} compared, ${skipped.length} unreachable by a mod: ` +
      [...new Set(skipped.map(r => `${r.script} (${unreachable(r)})`))].join('; ') +
      (baseRoot ? `; three-way with ${BASE}` : `; git could not produce ${BASE}:hooks, so script vs handler only`),
  )
})

test("the handler's literal matcher names exactly the guards' tools", () => {
  const src = readFileSync(join(REPO, 'hooks', 'guards', 'mod.ts'), 'utf8')
  const literal = src.match(/on\('tool\.call', \{ tool: \/\^\(([^)]+)\)\$\/ \}/)?.[1]?.split('|').sort()
  expect(literal).toEqual([...TOOLS].sort())
})

describe('script and mod handler agree on every recorded input', () => {
  reachable.forEach((r, i) => {
    const label = `${i} ${r.script}${r.args.length ? ' ' + r.args.join(' ') : ''}: ${r.stdin.slice(0, 90)}`
    test(label, async () => {
      try {
        const script = runScript(r, REPO)
        const handler = await runHandler(r)
        expect({ deny: handler.deny, context: handler.context }).toEqual({ deny: script.deny, context: script.context })
        expect(handler.files).toEqual(script.files)
        // Never an approval: a deny, or the result next(e) gave with context added — nothing else.
        expect(handler.keys.every(k => ['deny', 'result', 'context'].includes(k))).toBe(true)
        if (baseRoot) {
          const original = runScript(r, baseRoot)
          expect({ deny: original.deny, context: original.context }).toEqual({ deny: script.deny, context: script.context })
          expect(original.files).toEqual(script.files)
        }
      } finally {
        unplace()
      }
    }, 60_000)
  })
})
