// writing-prose-check unit surface: deck detection, domain→category mapping, edited-line scoping.
//
// SPLIT OUT OF tests/test_prose_lint_hook.py, WHICH HAD BEEN QUARANTINED for loading
// `hooks/writing-prose-check.py` after the hook became `.ts`. That file did three unrelated jobs; the
// port follows the code rather than the file:
//
//   - `.typ` prose extraction moved to scripts/prose_extract.py and the scored-tic table lives in
//     skills/ai-anti-patterns/scripts/screen.py. Both are still Python, both are still tested there,
//     and neither needed porting — the Python suite keeps them.
//   - The hook's own helpers are TypeScript now, so they are tested here.
//   - `_detect_style` is NOT ported. It read `.planning/ACTIVE_WORKFLOW.md`, a ledger this repo
//     deliberately retired (tests/work-skill-contract.test.mjs actively forbids reintroducing it).
//     Style now arrives from the writing plan. Porting that test would have re-asserted a removed
//     behaviour and pinned the retired file back into the design.
//
// Run: bun tests/writing-prose-check.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { proseLintCategories, isTypDeck, editRanges, inRanges } from '../hooks/writing-prose-check.ts'

let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}
const tmp = () => mkdtempSync(join(tmpdir(), 'prose-check-'))
const write = (dir, name, body) => { const p = join(dir, name); writeFileSync(p, body); return p }

// ── A slide deck is not prose, and must not be linted as prose ───────────────
{
  const d = tmp()
  ok('touying import marks a deck', isTypDeck(write(d, 'talk.typ', '#import "@preview/touying:0.5.0": *\n= Slide\n')) === true)
  ok('a #slide( call marks a deck', isTypDeck(write(d, 'talk2.typ', '#slide(title: "x")[ content ]\n')) === true)
  ok('polylux import marks a deck', isTypDeck(write(d, 'talk3.typ', '#import "@preview/polylux:0.3.1": *\n')) === true)
  // Location alone is enough: a .typ under a slides directory is a deck whatever its content.
  for (const dirname of ['slides', 'presentation', 'presentations']) {
    const sub = join(d, dirname)
    mkdirSync(sub, { recursive: true })
    ok(`a .typ under ${dirname}/ is a deck by directory`, isTypDeck(write(sub, 'x.typ', 'Dear Professor,\n')) === true, dirname)
  }
  // The converse matters as much: an ordinary letter must stay in scope for prose linting.
  ok('a letter is not a deck', isTypDeck(write(d, 'letter.typ', '#set page(margin: 1in)\nDear Professor,\nSincerely.\n')) === false)
}

// ── domain → prose-lint --only mapping ───────────────────────────────────────
{
  ok('no style maps to the general categories', proseLintCategories(null) === 'ai-anti-patterns,writing-general')
  ok('"general" maps to the general categories', proseLintCategories('general') === 'ai-anti-patterns,writing-general')
  ok('"legal" adds writing-legal', proseLintCategories('legal') === 'ai-anti-patterns,writing-general,writing-legal')
  ok('"econ" adds writing-econ', proseLintCategories('econ') === 'ai-anti-patterns,writing-general,writing-econ')
}

// ── edited-line scoping: review what changed, not the whole document ─────────
{
  const d = tmp()
  const whole = write(d, 'x.md', 'a\nb\n')
  const wr = editRanges('Write', {}, whole)
  ok('a Write covers the whole file', wr.length === 1 && wr[0][0] === 1 && wr[0][1] >= 10 ** 9, JSON.stringify(wr))

  const edited = write(d, 'y.md', 'line1\nline2\nNEW HERE\nline4\n')
  const er = editRanges('Edit', { new_string: 'NEW HERE' }, edited)
  // NEW HERE is line 3; the ±2 padding gives (1, 5) so surrounding context is still reviewed.
  ok('an Edit spans the new string plus padding', JSON.stringify(er) === JSON.stringify([[1, 5]]), JSON.stringify(er))
  ok('inRanges accepts a line inside the edit', inRanges(3, er) === true)
  ok('inRanges rejects a line far outside it', inRanges(100, er) === false)
}

console.log(`\n${PASS}/${PASS + FAIL} passed`)
if (FAIL) process.exit(1)
