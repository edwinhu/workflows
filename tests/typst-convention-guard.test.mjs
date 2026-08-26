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
  const result = Bun.spawnSync(['bun', HOOK], {
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

console.log('non-Typst writes are ignored entirely')
{
  const run = check('- a bullet\n', 'notes.md')
  ok('a .md write is untouched', run.stdout.trim() === '' && run.code === 0, run.stdout)
}

rmSync(dir, { recursive: true, force: true })
console.log(`\n${PASS}/${PASS + FAIL} passed`)
if (FAIL) throw new Error(`${FAIL} typst-convention-guard check(s) failed`)
