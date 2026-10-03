// The Typst convention guard must actually REPORT, not merely stay silent.
//
// WHY THIS EXISTS
//   The guard was registered nowhere — no hooks.json entry, no skill frontmatter — so it never ran.
//   It was found by scripts/wc/compliance-probe.ts, the checker built after the same defect shipped in
//   `work-implement-observation.ts`, and it is the same shape a third time.
//
//   Its 17-case golden passed throughout, and could not have caught it: `tests/golden/` is a PARITY
//   harness pinning stdout hashes for the Python-to-TypeScript port, and every one of those 17 cases
//   asserts SILENCE. Not one exercises a violation, so deleting every check in the guard would have
//   left the golden green. Parity proves the port is faithful; it says nothing about whether the thing
//   ported is worth running.
//
//   So this file holds the property the golden cannot: on a real violation the guard emits a real
//   finding, and on clean input it stays quiet. Both halves are needed — a guard that reports
//   everything is as useless as one that reports nothing, and only the pair pins the boundary.
//
// Run: bun tests/typst-convention-guard.test.mjs
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const HOOK = new URL('../hooks/typst-convention-guard.ts', import.meta.url).pathname
let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

const dir = mkdtempSync(join(tmpdir(), 'typst-guard-'))

function check(content, name = 'deck.typ') {
  const path = join(dir, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  const result = Bun.spawnSync(['bun', HOOK], { timeout: 120_000,
    stdin: Buffer.from(JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path } })),
    stdout: 'pipe', stderr: 'pipe',
  })
  const stdout = result.stdout.toString()
  let context = ''
  try { context = JSON.parse(stdout).hookSpecificOutput?.additionalContext ?? '' } catch { context = '' }
  return { code: result.exitCode, stdout, context }
}

console.log('a real violation is reported')
for (const [name, content, expected] of [
  ['uncentered image', '#slide[\n#image("fig.png")\n]\n', /not wrapped in #align\(center\)/],
  ['cetz-plot import', '#import "@preview/cetz-plot:0.1.0": *\n', /cetz-plot import detected/],
  ['unescaped dollar', '#slide[\nCost is $5 per unit\n]\n', /Unescaped dollar sign/],
]) {
  const run = check(content)
  ok(`${name} is reported`, expected.test(run.context), JSON.stringify(run.stdout).slice(0, 160))
  ok(`${name} names the convention header`, /TYPST CONVENTION VIOLATIONS/.test(run.context))
  // PostToolUse: a non-zero exit is NOT a silent allow here, but this guard is advisory and must not
  // halt anything — it reports so the agent can fix immediately.
  ok(`${name} exits 0 and does not block`, run.code === 0 && !/"decision"\s*:\s*"block"/.test(run.stdout), `exit ${run.code}`)
}

console.log('check 4 (qr: none) applies to a deck by PATH, not by filename')
// The gate was `pathStem(filepath).includes("slides")` — the FILENAME with its extension stripped —
// so it fired only on a file literally named `slides.typ`. Every deck stored as `slides/<name>.typ`
// (the teaching convention) skipped the check silently. Same defect as overflow-check.ts:108.
{
  const DECK_NO_QR = '#import "@preview/touying:0.5.0": *\n#show: config-info(title: "x")\n#slide[\n=== y\n]\n'
  const run = check(DECK_NO_QR, 'slides/01-intro.typ')
  ok('a deck under slides/ gets the qr: none check', /qr: none/.test(run.context),
     JSON.stringify(run.stdout).slice(0, 200))
  const stem = check(DECK_NO_QR, 'slides.typ')
  ok('a file named slides.typ still gets it', /qr: none/.test(stem.context))
  const notDeck = check('#set page(margin: 1in)\nDear Professor,\n', 'notes/09.typ')
  ok('prose notes do not get it', !/qr: none/.test(notDeck.context))
}

console.log('clean input stays silent — otherwise the report means nothing')
for (const [name, content] of [
  ['a conventional slide', '#slide[\n#align(center)[#image("fig.png")]\n]\n'],
  ['plain prose', '#slide[\nJust a sentence.\n]\n'],
]) {
  const run = check(content)
  ok(`${name} produces no finding`, run.context === '', run.stdout.slice(0, 160))
}

console.log('an Edit is judged on the lines it changed, not on the whole file')
// The guard read the whole file on every Edit, so an edit at line 79 came back with
// "Line 8/11/18/21/24" — standing violations the edit never touched (secreg lecture-18 session,
// 2026-10-02). An Edit is scoped to its new_string span; a Write is the whole file by definition.
function edit(content, newString, { name = 'scoped.typ', session, extra = {} } = {}) {
  const path = join(dir, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  const payload = { tool_name: 'Edit', tool_input: { file_path: path, old_string: 'x', new_string: newString, ...extra } }
  if (session) payload.session_id = session
  const result = Bun.spawnSync(['bun', HOOK], { timeout: 120_000,
    stdin: Buffer.from(JSON.stringify(payload)), stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, TMPDIR: dir },
  })
  const stdout = result.stdout.toString()
  let context = ''
  try { context = JSON.parse(stdout).hookSpecificOutput?.additionalContext ?? '' } catch { context = '' }
  return { code: result.exitCode, stdout, context }
}
{
  // Violations on lines 8, 11, 18, 21, 24 (the evidence's numbers); clean filler to line 79.
  const lines = Array.from({ length: 80 }, (_, i) => `Line ${i + 1} of plain prose.`)
  for (const n of [8, 11, 18, 21, 24]) lines[n - 1] = `Cost is $${n} per unit`
  lines[78] = 'A sentence the edit rewrote.'
  const standing = lines.join('\n') + '\n'
  const far = edit(standing, 'A sentence the edit rewrote.')
  ok('an edit far from standing violations gets no context', far.context === '', far.context.slice(0, 200))

  const introduced = lines.slice()
  introduced[78] = 'The fee is $79 now'
  const near = edit(introduced.join('\n') + '\n', 'The fee is $79 now')
  ok('an edit introducing a violation reports that line', /Line 79: Unescaped dollar sign/.test(near.context), near.context.slice(0, 300))
  ok('and only that line', !/Line (8|11|18|21|24):/.test(near.context), near.context.slice(0, 300))

  const multi = edit('= H\n\nintro\n- one\n- two\nafter\n', '- one\n- two')
  ok('a multi-line new_string covers every line it spans', /Line 4: Missing blank line between top-level bullets/.test(multi.context), multi.context)

  const all = edit('- a\n\n- a\n\n$1 and $1\n', '- a', { extra: { replace_all: true } })
  ok('a replace_all edit with no violation in its spans stays silent', all.context === '', all.context)

  const gone = edit(standing, 'text that is not in the file')
  ok('a new_string absent from the file attributes nothing', gone.context === '', gone.context.slice(0, 200))

  const w = check(standing, 'scoped-write.typ')
  ok('a Write still reports the whole file', /Line 8: Unescaped dollar sign/.test(w.context), w.context.slice(0, 200))
}

console.log('each finding is reported once per session')
{
  const content = '= H\n\nThe fee is $5 now\n'
  const first = edit(content, 'The fee is $5 now', { name: 'once.typ', session: 'sess-once' })
  ok('the first call reports the finding', /Line 3: Unescaped dollar sign/.test(first.context), first.context)
  const again = edit(content, 'The fee is $5 now', { name: 'once.typ', session: 'sess-once' })
  ok('a repeat call in the same session does not', again.context === '', again.context)
  const moved = edit('= H\n\nnew line above\nThe fee is $5 now\n', 'new line above\nThe fee is $5 now', { name: 'once.typ', session: 'sess-once' })
  ok('nor does the same line moved to a new number', moved.context === '', moved.context)
  const changed = edit('= H\n\nThe fee is $6 now\n', 'The fee is $6 now', { name: 'once.typ', session: 'sess-once' })
  ok('a changed line is a new finding under the same label', /Line 3: Unescaped dollar sign/.test(changed.context), changed.context)
  const other = edit(content, 'The fee is $5 now', { name: 'once.typ', session: 'sess-other' })
  ok('another session sees it', /Line 3: Unescaped dollar sign/.test(other.context), other.context)
  const noSession = [0, 1].map(() => edit(content, 'The fee is $5 now', { name: 'once.typ' }))
  ok('with no session id nothing is deduplicated', noSession.every(r => /Line 3:/.test(r.context)), noSession.map(r => r.context).join(' | '))
}

console.log('non-Typst writes are ignored entirely')
{
  const run = check('- a bullet\n', 'notes.md')
  ok('a .md write is untouched', run.stdout.trim() === '' && run.code === 0, run.stdout)
}

rmSync(dir, { recursive: true, force: true })
console.log(`\n${PASS}/${PASS + FAIL} passed`)
if (FAIL) throw new Error(`${FAIL} typst-convention-guard check(s) failed`)
