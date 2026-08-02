// writing-mechanical-gate: scope (what it gates), the never-deny rule for drafting, and the
// freshness cache.
//
// PORTED FROM tests/test_writing_mechanical_gate.py, WHICH HAD BEEN QUARANTINED for opening
// `hooks/writing-mechanical-gate.py` after the hook became `.ts`.
//
// The cache half is tested DIFFERENTLY on purpose. The Python suite monkeypatched the module's
// `_run_check_all` and counted calls; ESM bindings are not writable that way, so the cache is
// exercised through its real observable — the `fromCache` flag and the cache file on disk — with the
// genuine checker underneath. That is a stronger test than the original: it can no longer pass while
// the real runner is wired up wrongly, because the real runner is what runs.
//
// Run: bun tests/writing-mechanical-gate.test.mjs
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCheckAllCached } from '../hooks/writing-mechanical-gate.ts'

const ROOT = join(import.meta.dir, '..')
const HOOK = join(ROOT, 'hooks', 'writing-mechanical-gate.ts')

let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

async function run(payload) {
  const proc = Bun.spawn(['bun', HOOK], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  proc.stdin.write(JSON.stringify(payload)); proc.stdin.end()
  const code = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  let out = null
  if (stdout.trim()) { try { out = JSON.parse(stdout) } catch { out = { _raw: stdout } } }
  return { code, out }
}
const decision = out => out?.hookSpecificOutput?.permissionDecision
const reason = out => out?.hookSpecificOutput?.permissionDecisionReason ?? ''

// ── Scope: this gate concerns itself with writing Workflows and nothing else ──
{
  const { code, out } = await run({ tool_name: 'Write', tool_input: { file_path: 'x' } })
  ok('non-Workflow tool is a no-op', code === 0 && out === null, `code=${code} out=${JSON.stringify(out)}`)
}
{
  const { code, out } = await run({ tool_name: 'Workflow', tool_input: { name: 'ds-run' } })
  ok('unrelated Workflow is a no-op (does not drag in other workflows)', code === 0 && out === null, `out=${JSON.stringify(out)}`)
}

// ── writing-draft: warn about a missing sectionIndex, but NEVER deny ─────────
// Drafting is what FIXES the issues this floor checks, so denying it would deadlock the workflow.
{
  const { out } = await run({ tool_name: 'Workflow', tool_input: { scriptPath: 'writing-draft.js', args: { projectDir: '/nonexistent' } } })
  ok('writing-draft without sectionIndex → allow', decision(out) === 'allow', `out=${JSON.stringify(out)}`)
  ok('writing-draft without sectionIndex warns about sectionIndex', reason(out).includes('sectionIndex'))
  ok('writing-draft never denies', decision(out) !== 'deny')
}
{
  const { code, out } = await run({ tool_name: 'Workflow', tool_input: { scriptPath: 'writing-draft.js', args: { projectDir: '/nonexistent', sectionIndex: { sections: [1] } } } })
  ok('writing-draft with sectionIndex → silent allow (no nag)', code === 0 && out === null, `out=${JSON.stringify(out)}`)
}

// ── Source invariants, re-expressed for TypeScript ───────────────────────────
const src = Bun.file(HOOK)
const text = await src.text()
ok('hook invokes check-all with --with lxml', text.includes('"--with", "lxml"') && /CHECK_ALL|check-all\.py/.test(text))
ok('only failures block; tooling errors do not', text.includes('failed.length === 0') || text.includes('NOT blocking'))

// ── Freshness cache, against the real runner ─────────────────────────────────
{
  const project = mkdtempSync(join(tmpdir(), 'wmg-cache-'))
  mkdirSync(join(project, 'drafts'), { recursive: true })
  const draft = join(project, 'drafts', 'intro.md')
  writeFileSync(draft, 'Hello world.')

  const first = runCheckAllCached(project)
  ok('cache miss: the first call actually runs the checker', first.fromCache === false, JSON.stringify(first.summary))
  ok('cache miss: writes .planning/.checkall-cache.json', existsSync(join(project, '.planning', '.checkall-cache.json')))

  const second = runCheckAllCached(project)
  ok('cache hit: an unchanged project reuses the cached verdict', second.fromCache === true, `fromCache=${second.fromCache}`)
  ok('cache hit: the reused verdict matches the cached run', second.ok === first.ok && second.summary === first.summary)

  // mtime resolution is coarser than the loop, so move the clock before editing — otherwise an edit
  // inside the same tick hashes identically and the test would "prove" invalidation that never ran.
  const until = Date.now() + 1100
  while (Date.now() < until) { /* wait past mtime granularity */ }
  writeFileSync(draft, 'Hello world, edited.')
  const third = runCheckAllCached(project)
  ok('a draft edit invalidates the cache and re-runs', third.fromCache === false, `fromCache=${third.fromCache}`)

  rmSync(project, { recursive: true, force: true })
}

// A corrupt cache must not crash the gate — it re-runs and still returns a verdict.
{
  const project = mkdtempSync(join(tmpdir(), 'wmg-corrupt-'))
  mkdirSync(join(project, 'drafts'), { recursive: true })
  writeFileSync(join(project, 'drafts', 'a.md'), 'x')
  mkdirSync(join(project, '.planning'), { recursive: true })
  writeFileSync(join(project, '.planning', '.checkall-cache.json'), '{not valid json')
  const result = runCheckAllCached(project)
  ok('a corrupt cache file fails open (still returns a verdict)', result.fromCache === false && typeof result.ok === 'boolean', JSON.stringify(result))
  rmSync(project, { recursive: true, force: true })
}

console.log(`\n${PASS}/${PASS + FAIL} passed`)
if (FAIL) process.exit(1)
