// writing-prose-check unit surface: deck detection, domain→category mapping, edited-line scoping.
//
// SPLIT OUT OF tests/test_prose_lint_hook.py, WHICH HAD BEEN QUARANTINED for loading
// `hooks/writing-prose-check.py` after the hook became `.ts`. That file did three unrelated jobs; the
// port follows the code rather than the file:
//
//   - `.typ` prose extraction moved to scripts/prose_extract.py and the scored-tic table is now
//     loaded by scripts/prose-audit.py. Both are still Python, both are still tested there, and
//     neither needed porting — the Python suite keeps them.
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
import { auditStyle, isTypDeck, editRanges, inRanges, runProseAudit, runCheckAll } from '../hooks/writing-prose-check.ts'

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

// ── domain → prose-audit --style mapping ─────────────────────────────────────
// The hook used to assemble a prose-lint `--only` CATEGORY LIST; the single audit takes one
// `--style` and decides for itself which tables that admits. Unknown values degrade to `general`
// rather than erroring, because an unrecognised domain must still get the always-on tables.
{
  ok('no style is general', auditStyle(null) === 'general')
  ok('"general" is general', auditStyle('general') === 'general')
  ok('"legal" selects the Volokh tables', auditStyle('legal') === 'legal')
  ok('"econ" selects the McCloskey tables', auditStyle('econ') === 'econ')
  ok('case is folded', auditStyle('Legal') === 'legal')
  ok('an unknown domain degrades to general, it does not blank the lint', auditStyle('poetry') === 'general')
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

// ── emphasis reaches the model, and reaches it ONCE ──────────────────────────
// THE THREE STACKED FAILURES, pinned at the hook layer. A `.typ` edit runs prose-audit only
// (check-all is off on that path), so if emphasis were not a prose-audit system it would reach
// nobody — which is exactly how a 66-`#strong[]` comment letter passed a clean review.
{
  const d = tmp()
  const letter = write(d, 'comment.typ',
    '#set page(margin: 1in)\n' +
    '\n' +
    'The market saw #strong[546,088] trades under the proposed rule this year.\n')
  const spans = runProseAudit(letter, 'legal', [[1, 10]])
  ok('a .typ edit touching a #strong[] line surfaces the emphasis span',
    spans.some((s) => s.includes('emphasis') && s.includes('bold-bare-number')), JSON.stringify(spans))
}
{
  // `constraints/writing-no-bold-lead` delegates to prose-audit now, so check-all would report the
  // SAME span the audit already reported. The prefix list is what keeps it to one line.
  const d = tmp()
  mkdirSync(join(d, 'drafts'), { recursive: true })
  const draft = write(join(d, 'drafts'), 'part2.md',
    '**The objection.** A five percent stake could leverage mirror voting to control votes.\n')
  const audit = runProseAudit(draft, 'legal', [[1, 10]])
  const check = runCheckAll(d, draft, [[1, 10]])
  const boldLead = [...audit, ...check].filter((v) => v.toLowerCase().includes('bold-lead'))
  ok('a drafts/*.md bold-lead is reported once, not twice', boldLead.length === 1, JSON.stringify(boldLead))
  ok('and it is the audit engine that reports it',
    audit.some((v) => v.includes('bold-lead')) && !check.some((v) => v.includes('bold-lead')),
    JSON.stringify({ audit, check }))
}

// ── deck detection exists TWICE, in two languages — pin that they agree ──────
// The hook needs the predicate BEFORE it spawns anything (it also skips check-all and the plan
// lookup), so it cannot ask prose-audit.py; and prose-audit.py needs it independently, to drop
// `formatting·emoji` to soft when someone audits a deck on purpose from the CLI. A duplicated
// predicate that nothing compares is a predicate that drifts.
{
  const d = tmp()
  mkdirSync(join(d, 'slides'), { recursive: true })
  const cases = [
    write(d, 'touying.typ', '#import "@preview/touying:0.5.0": *\n= Slide\n'),
    write(d, 'polylux.typ', '#import "@preview/polylux:0.3.1": *\n'),
    write(d, 'call.typ', '#slide(title: "x")[ content ]\n'),
    write(join(d, 'slides'), 'bare.typ', 'Dear Professor,\n'),
    write(d, 'letter.typ', '#set page(margin: 1in)\nDear Professor,\nSincerely.\n'),
    write(d, 'notes.md', '#slide(\n'),
  ]
  const py = Bun.spawnSync(['uv', 'run', '--with', 'lxml', '--with', 'pyyaml', 'python3', '-c',
    'import importlib.util,sys,json\n' +
    'spec=importlib.util.spec_from_file_location("pa",sys.argv[1])\n' +
    'm=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n' +
    'from pathlib import Path\n' +
    'print(json.dumps([m.is_deck(Path(p)) for p in sys.argv[2:]]))',
    join(import.meta.dir, '..', 'scripts', 'prose-audit.py'), ...cases])
  const pyOut = JSON.parse(new TextDecoder().decode(py.stdout).trim())
  const tsOut = cases.map((p) => isTypDeck(p))
  ok('Python is_deck and TypeScript isTypDeck agree on every case',
    JSON.stringify(pyOut) === JSON.stringify(tsOut), JSON.stringify({ pyOut, tsOut, cases }))
  ok('and they agree on the answers, not just with each other',
    JSON.stringify(tsOut) === JSON.stringify([true, true, true, true, false, false]), JSON.stringify(tsOut))
}

console.log(`\n${PASS}/${PASS + FAIL} passed`)
if (FAIL) process.exit(1)
