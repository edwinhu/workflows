// overflow-check trigger/target-extraction regression tests.
//
// PORTED FROM tests/overflow_check_test.py, WHICH HAD BEEN QUARANTINED. That file did
// `importlib.util.spec_from_file_location(... "hooks" / "overflow-check.py")` against a hook that
// is now TypeScript, so it could not even load — it was quarantined as "opens overflow-check.py;
// the hook is now .ts" and left there. Quarantining a suite because its SUBJECT moved retires the
// coverage silently: the hook kept shipping, and nothing checked it for as long as the entry stood.
//
// Run: bun tests/overflow-check.test.mjs
import { resolveTypTarget } from '../hooks/overflow-check.ts'

let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

// (a) both compilers trigger; (b) flags BEFORE the target must not break extraction — the whole
// reason this suite exists is that a naive "last token" parse gets `--input handout=true` wrong.
ok('bare typst compile', resolveTypTarget('typst compile slides.typ') === 'slides.typ')
ok('typst compile with --input first', resolveTypTarget('typst compile --input handout=true slides.typ') === 'slides.typ')
ok('tinymist compile', resolveTypTarget('tinymist compile slides.typ') === 'slides.typ')
ok('tinymist compile nested path', resolveTypTarget('tinymist compile presentation/slides.typ') === 'presentation/slides.typ')
ok('typst compile --root form', resolveTypTarget('typst compile --root . slides/lecture1.typ') === 'slides/lecture1.typ')
ok('cd prefix + typst compile', resolveTypTarget('cd foo && typst compile slides.typ') === 'slides.typ')
ok('non-compile command: no trigger', resolveTypTarget('typst watch slides.typ') === null)
ok('unrelated command: no trigger', resolveTypTarget('ls -la') === null)

// Fail-open on malformed / non-Bash / non-triggering stdin. A PreToolUse hook that dies on junk
// input is a hook that blocks real work, so every one of these must exit 0.
const runHook = async stdin => {
  const proc = Bun.spawn(['bun', 'hooks/overflow-check.ts'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  proc.stdin.write(stdin); proc.stdin.end()
  return await proc.exited
}

ok('malformed JSON -> exit 0', await runHook('not json') === 0)
ok('empty object -> exit 0', await runHook('{}') === 0)
ok('non-Bash tool -> exit 0', await runHook(JSON.stringify({ tool_name: 'Read', tool_input: {} })) === 0)
ok('tinymist compile via Bash tool -> exit 0 (no crash even if plugin root unresolved)',
   await runHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'tinymist compile slides.typ' } })) === 0)

console.log(`\n${PASS}/${PASS + FAIL} passed`)
if (FAIL) process.exit(1)
