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
import { auditStyle, isTypDeck, editRanges, inRanges, runProseAudit, runCheckAll, profileFor } from '../hooks/writing-prose-check.ts'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()

let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}
const tmp = () => mkTmp('prose-check-')
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
    join(import.meta.dir, '..', 'scripts', 'prose-audit.py'), ...cases], { timeout: 120_000 })
  const pyOut = JSON.parse(new TextDecoder().decode(py.stdout).trim())
  const tsOut = cases.map((p) => isTypDeck(p))
  ok('Python is_deck and TypeScript isTypDeck agree on every case',
    JSON.stringify(pyOut) === JSON.stringify(tsOut), JSON.stringify({ pyOut, tsOut, cases }))
  ok('and they agree on the answers, not just with each other',
    JSON.stringify(tsOut) === JSON.stringify([true, true, true, true, false, false]), JSON.stringify(tsOut))
}

// ── A deck is AUDITED under a restricted profile, not skipped ────────────────
// The old contract was "a slide deck is not prose, and must not be linted as prose", implemented
// as an outright `process.exit(0)`. That exempted decks from the corpus-gated tic table too, and a
// real sev3 tic shipped in a lecture deck because of it. The predicate now selects a PROFILE.
{
  const d = tmp()
  const deck = write(d, 'slides-talk.typ', '#import "@preview/touying:0.5.0": *\n= Slide\n')
  const prose = write(d, 'memo.typ', 'The board met on Tuesday and resolved the matter.\n')

  ok('a deck still detects as a deck', isTypDeck(deck) === true)
  ok('profileFor names the deck profile for a deck', profileFor(deck) === 'deck')
  ok('profileFor leaves non-deck .typ on the full profile', profileFor(prose) === 'full')
}

// ── END TO END, through the hook the way a tool call reaches it ──────────────
// profileFor() agreeing with itself proves nothing about what the hook DOES. These drive the hook
// as a subprocess over a real JSON payload — the production entry point — and read the
// additionalContext a model would actually receive.
const HOOK = join(import.meta.dir, '..', 'hooks', 'writing-prose-check.ts')
function runHook(payload, cwd) {
  const p = Bun.spawnSync(['bun', HOOK], { timeout: 120_000,
    cwd,
    // the per-session seen-set lands in TMPDIR: keep it in the fixture, not the run's TMPDIR
    env: { ...process.env, TMPDIR: cwd },
    stdin: new TextEncoder().encode(JSON.stringify(payload)),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = new TextDecoder().decode(p.stdout).trim()
  if (!out) return ''
  try { return JSON.parse(out).hookSpecificOutput.additionalContext } catch { return out }
}

// One body, two registers. `organisation` is a US-register SPELLING error and "The selection is
// the argument." a corpus-gated tic — claims about correctness and provenance, which hold on a
// slide. The `---` em dashes and the passive "were reviewed" are claims about PROSE RHYTHM, which
// a bulleted deck legitimately breaks; the deck profile must not report them.
const DECK_BODY =
  '#import "@preview/touying:0.5.0": *\n' +
  '\n' +
  '= A slide title\n' +
  '\n' +
  '- The selection is the argument.\n' +
  '\n' +
  '- The organisation of the statute --- its structure, its defaults --- is what the court reads.\n' +
  '\n' +
  '- Records were reviewed by the committee before the vote was taken.\n'

{
  const d = tmp()
  const deck = write(d, 'lecture.typ', DECK_BODY)
  const ctx = runHook({ tool_name: 'Write', tool_input: { file_path: deck } }, d)
  ok('the hook AUDITS a deck instead of exiting silently', ctx !== '', JSON.stringify(ctx))
  ok('and the deck keeps the provenance/correctness systems',
    ctx.includes('spelling') || ctx.includes('scored-tic'), JSON.stringify(ctx))
  ok('and the deck drops the em-dash system', !ctx.includes('em_dash') && !ctx.includes('em-dash'),
    JSON.stringify(ctx))
  ok('and the deck drops the writing-* systems', !ctx.includes('writing-'), JSON.stringify(ctx))
}

{
  // THE LEAK. A deck reached the audit through the Bash branch and was scored under the FULL
  // ruleset — `style·em_dash` and `writing-general` on a slide. bashTouchedProseFile() used the
  // deck predicate to decide CANDIDACY (`!isTypDeck(abs)`) rather than to select a profile, so a
  // deck it did recognise was dropped and one it did not was handed to `full`.
  const d = tmp()
  const p = Bun.spawnSync(['git', 'init', '-q', '.'], { timeout: 120_000, cwd: d, stdout: 'pipe', stderr: 'pipe' })
  ok('git init for the Bash-branch fixture succeeded', p.exitCode === 0)
  mkdirSync(join(d, 'slides'), { recursive: true })
  write(join(d, 'slides'), 'lecture.typ', DECK_BODY)
  // The command names the deck it rewrote: a Bash call that names no file is never its writer.
  const ctx = runHook({ tool_name: 'Bash', cwd: d, tool_input: { command: "sed -i 's/vote/ballot/' slides/lecture.typ" } }, d)
  ok('a deck dirtied by Bash reaches the audit at all', ctx !== '', JSON.stringify(ctx))
  ok('and it is scored under the deck profile, not the full ruleset',
    ctx !== '' && !ctx.includes('em_dash') && !ctx.includes('writing-'), JSON.stringify(ctx))
}

{
  // THE DEFAULT IS FROZEN. The same body in a non-deck .typ must still be scored under `full`,
  // or the profile was not added — the ruleset was narrowed for everyone.
  const d = tmp()
  const letter = write(d, 'memo.typ',
    '#set page(margin: 1in)\n' +
    '\n' +
    'The organisation of the statute --- its structure, its defaults --- is what the court reads.\n' +
    '\n' +
    // The writing-* trigger, and the only reason the deck assertions below are not vacuous. It was
    // a passive construction until the Strunk passive pattern was deleted as refuted by the corpus
    // (7.91% law vs 8.55% finance — not a register marker); `the fact that` is S&W Rule 13 and
    // still ships.
    'The committee noted the fact that records were kept before the vote.\n')
  const ctx = runHook({ tool_name: 'Write', tool_input: { file_path: letter } }, d)
  ok('a non-deck .typ still reports the em-dash system', ctx.includes('em_dash'), JSON.stringify(ctx))
  ok('a non-deck .typ still reports the writing-* systems', ctx.includes('writing-'), JSON.stringify(ctx))
}

// ── secreg lecture 18 (2026-10-02): the same findings on EVERY Bash result ───
// A background implementer kept notes/18-insider.typ dirty and freshly written, so the Bash branch
// picked it up after every command the orchestrating session ran (grep, cat, a review gate) and
// attached the same 11-14 findings each time, nominalization of `misappropriation` among them.
function gitRepo() {
  const d = tmp()
  const p = Bun.spawnSync(['git', 'init', '-q', '.'], { timeout: 120_000, cwd: d, stdout: 'pipe', stderr: 'pipe' })
  ok('git init for the attribution fixture succeeded', p.exitCode === 0)
  return d
}
const MEMO_BODY = '#set page(margin: 1in)\n\nThis article delves into the rich tapestry of the law.\n'
{
  const d = gitRepo()
  write(d, 'memo.typ', MEMO_BODY)
  const unrelated = runHook({ tool_name: 'Bash', cwd: d, tool_input: { command: 'grep -n Kendall /tmp/x/findings.md | tail -20' } }, d)
  ok('a Bash command that never names the dirty prose file attaches nothing', unrelated === '', JSON.stringify(unrelated))
  const named = runHook({ tool_name: 'Bash', cwd: d, tool_input: { command: "sed -i 's/law/statute/' memo.typ" } }, d)
  ok('a Bash command that names the file it rewrote is still audited', named.includes('memo.typ:3'), JSON.stringify(named))
}
{
  // ONE SESSION, NO CHANGE, NO REPEAT. The second call sees the same lines with the same findings.
  const d = gitRepo()
  write(d, 'memo.typ', MEMO_BODY)
  const session = `fix18-${process.pid}-${Date.now()}`
  const cmd = { command: 'typst compile memo.typ' }
  const first = runHook({ tool_name: 'Bash', cwd: d, session_id: session, tool_input: cmd }, d)
  const second = runHook({ tool_name: 'Bash', cwd: d, session_id: session, tool_input: cmd }, d)
  ok('the first call reports the standing finding', first.includes('memo.typ:3'), JSON.stringify(first))
  ok('a later call on the unchanged file does not re-attach it', second === '', JSON.stringify(second))
  const other = runHook({ tool_name: 'Bash', cwd: d, session_id: `${session}-other`, tool_input: cmd }, d)
  ok('another session still gets it once', other.includes('memo.typ:3'), JSON.stringify(other))
  // A changed line is a new finding, even with the same label.
  write(d, 'memo.typ', MEMO_BODY + '\nThat brief delves into the rich tapestry of the record.\n')
  const third = runHook({ tool_name: 'Bash', cwd: d, session_id: session, tool_input: cmd }, d)
  ok('a newly written line with the same label is reported', third.includes('memo.typ:5'), JSON.stringify(third))
  ok('and the line already reported is not', !third.includes('memo.typ:3'), JSON.stringify(third))
  const edit = runHook({ tool_name: 'Edit', session_id: session, tool_input: { file_path: join(d, 'memo.typ'), new_string: 'That brief delves into the rich tapestry of the record.' } }, d)
  ok('an Edit whose lines carry only already-reported findings attaches nothing', edit === '', JSON.stringify(edit))
}
{
  // TEACHING COURSE MATERIAL IS NOT THE WRITING WORKFLOW'S. The exact secreg paths: lecture notes
  // notes/NN-*.typ and a lecture deck slides/<chapter>/NN.typ, as hooks/jev/rules.ts classifies them.
  const d = gitRepo()
  mkdirSync(join(d, 'notes'), { recursive: true })
  mkdirSync(join(d, 'slides', '06-insider'), { recursive: true })
  const body = '= Insider Trading\n\n- The misappropriation theory turns on a breach of confidentiality --- not on materiality alone.\n\n- This article delves into the rich tapestry of the law.\n'
  const notes = write(join(d, 'notes'), '18-insider.typ', body)
  const deck = write(join(d, 'slides', '06-insider'), '18.typ', '#import "@preview/touying:0.5.0": *\n' + body)
  for (const f of [notes, deck]) {
    const w = runHook({ tool_name: 'Write', tool_input: { file_path: f } }, d)
    ok(`${f.slice(d.length + 1)}: no general-prose audit on lecture material`, w === '', JSON.stringify(w))
    const b = runHook({ tool_name: 'Bash', cwd: d, tool_input: { command: `typst compile ${f}` } }, d)
    ok(`${f.slice(d.length + 1)}: nor through the Bash branch`, b === '', JSON.stringify(b))
  }
  // The default is frozen: the same words in a memo still get the nominalization rule.
  const memo = write(d, 'memo.typ', body)
  const m = runHook({ tool_name: 'Write', tool_input: { file_path: memo } }, d)
  ok('a non-lecture .typ still gets the nominalization rule', m.includes('nominalization'), JSON.stringify(m))
}

console.log(`${PASS} passed, ${FAIL} failed`)
if (FAIL > 0) process.exit(1)
