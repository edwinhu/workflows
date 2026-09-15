# Widows and notes — two changes to elide-case

Both landed in one pass. Part 1 adds a page-level widow/orphan leg to the one mechanical
entry point; Part 2 reverses the editors'-note default and moves the mechanical conventions
into the addendum preamble.

---

## Part 1 — the widow/orphan leg

### Reuse vs. new: a NEW script, and why

`/home/eh/projects/teaching/scripts/check-widows.py` was read first. It is **not extended**.
A new script ships at `skills/elide-case/scripts/check-page-breaks.py`.

The two share about twenty lines — pymupdf's `get_text("dict")` line extraction, which the
new script reproduces (with a comment naming the origin) rather than importing. Everything
else in the slide checker is inapplicable to the page-level defect:

| check-widows.py | check-page-breaks.py |
|---|---|
| a widow is a short fragment wrapping to its own line **inside a bullet** | a widow is a paragraph's last line alone **at the top of a page** |
| never looks at a page boundary; dedups across animation steps | looks at nothing except page boundaries |
| Touying chrome: slide-number footers, `1.2.` section headings, list markers, parenthetical refs, column gaps, narrow-container filters | none of that exists in a 1-inch-margin justified prose document |
| decides on word counts and character lengths | decides on justification geometry: a line flush to the right margin continues its paragraph; a ragged line ends it |
| compiles via `checks/typst_pdf.py`, which carries a Touying preamble | consumes a compiled PDF; the addendum's compile is already the `compile` leg's job |

Bending the slide checker into a page checker would mean adding a second mode that shares
the extraction and disagrees with the first on every threshold, filter and definition — and
it would put an elide-case gate leg in the course-tooling repo, outside the skill's
hermetically tested `scripts/`. The instruction's own escape clause applies: the two share
little beyond extraction.

**No new dependency.** pymupdf is already a course dependency (secreg's `pixi.toml`, and
what `check-widows.py` uses). The ambient `python3` on this machine does not have it, so the
script re-execs into an interpreter that does — `$ELIDE_PYTHON`, then `.pixi/envs/*/bin/python`
walking up from the PDF, then the same glob under `$HOME`. If none is found it exits **2**,
which `check.sh` reads as FAIL. Never a skip: a page-break check that did not run must not
read as clean.

### What it decides

- **orphan** — a paragraph's first line alone at the foot of a page, the rest overleaf
- **widow** — a paragraph's last line alone at the top of a page
- **stranded-heading** — a caption block, section heading or judge line at the foot of a
  page with its text beginning on the next

The signal is justification, not sentence guessing: in justified body text every line but a
paragraph's last is flush to the right margin, so "this paragraph continues" is a
measurement. The right margin is the **modal** line end, not the maximum — a table rule or
glyph overhang past the margin would otherwise make "continues" false everywhere, which is a
vacuous pass.

### Gate wiring: the flag convention

Added as a fifth leg of `scripts/check.sh` (`--- leg widows`), non-short-circuiting like the
others. **No second `mechanicalChecks` entry** — P10 refuses one.

The convention is **a documented default, ON**, not a flag pair:

| form | behavior |
|---|---|
| no widow flag | the leg **runs**. This is the fail-closed property: absence cannot read as a pass because absence checks. |
| `--no-widows` | loud waiver — `LEG widows: NOT CHECKED … NOBODY IS CHECKING PAGE BREAKS`, and the PASS summary says `EXCEPT … page breaks, which --no-widows waived` |
| `--widows` | states the default on the record |
| both | FAIL, contradictory |
| compile failed | FAIL — `no compiled PDF to inspect`, never a pass |

Why not a required pair like `--plan/--no-plan` and `--target/--no-target`: those two guard
checks whose *input* is optional (a plan file, a page range), so their absence is genuinely
ambiguous and must be refused. The widow check needs no input beyond the PDF the `compile`
leg already produces, so ON is available as the default, and a default that runs is strictly
stronger than a pair that can be answered `--no-`. The prompt permitted either; this is the
one where the leg's absence can never read as a pass. **The summary line never claims the
check ran when it did not** — `LEG widows: NOT CHECKED` and the `widows=NOT-CHECKED` field on
the FAIL line are both distinct from PASS.

### The fix vocabulary is layout-only

Stated in `references/editing-marks.md` (new section *Widows and orphans are fixed by
LAYOUT, never by the court's words*), in the `check.sh` header, in the script docstring, and
printed on every failure:

> FIX BY LAYOUT ONLY — spacing, or where the page breaks. Never by adding, cutting or
> rewording the court's text: that would defeat the verbatim gate.

**If the two conflict, fidelity wins and the widow stands.**

---

## Part 2 — editors' notes become the exception

### The rewritten rule

`references/editing-marks.md` — the section is now *"## The editors' note — THE EXCEPTION,
NOT THE RULE"*. The old rule is quoted in place, with its reversal dated, not deleted:

- **Default: NO editors' note.** Reversed by the instructor on **2026-09-10**, quoted
  verbatim in the reference. The prior rule (*"Every reading carries an editors' note"*) is
  recorded there as what was replaced, so the reversal is legible — matching how the
  2026-09-09 disclosure narrowing was recorded.
- **A note exists only for BACKGROUND** the student cannot read the case without: prior
  history of the same litigation, an earlier related decision, or real-world context (the
  instructor's example: Boeing's safety issues in the news).
- **The Must-be-disclosed list** (dropped substantive footnote, dropped qualifier, omitted
  alternative holding, omitted dissent) and the **May-go-silently list** (record citations,
  party-brief cites, string cites, internal cross-references) are **unchanged**, with the
  2026-09-09 ruling and the Ripple false-finding history intact. What changed is where and
  whether a per-reading note exists, not what must be surfaced.

### Where the conventions prose now lives

Your proposed resolution, implemented as proposed — I found nothing better.

The mechanical conventions are stated **once in the addendum's preamble**, the page that
already carries the header block and the summary table (`addenda/02-addendum.typ` lines
1–50, read only), covering every reading in the document:

- omissions of text are marked with the addendum's one elision mark;
- the original opinions' footnotes are omitted except as indicated, and any retained
  footnote is renumbered;
- record citations to the parties' papers are omitted without notation.

The `compile-table` task owns that sentence, because it owns the preamble. So a student
meeting `[. . .]` or a renumbered footnote has an explanation, and it appears once instead of
four times.

### The reading-specific disclosure — where it goes

*Ripple retains footnote 16, renumbered as 1* is specific to one reading, so the preamble's
document-wide sentence does not cover it. **It goes in that reading's own note**, and a
reading whose only content would be such a disclosure still gets a note — a dropped dissent
has to be disclosed and there is nowhere else for it. Stated explicitly in the reference,
along with what is not a reason for a note: anything the preamble already covers.

### What was updated in SKILL.md

- refs table row for `editing-marks.md` — the note rule, the preamble location, the
  layout-only widow rule
- `mechanicalChecks` comment — four legs → five, plus the widows leg's default-ON convention
- the `cut-<slug>` task `work` — was "Caption block, editors' note and judge line follow
  01-addendum.typ"; now states the NO-note default, the background trigger, and that the
  conventions live in the preamble
- the `compile-table` task `work` — now owns the preamble conventions sentence
- four new Red-flag rows: note on every reading; repeating conventions per reading; rewording
  to close a widow; `--no-widows` on a real run
- `references/verification.md` — four legs → five, the new leg's row, and why it is the one
  leg that is on by default

**The craft phases were not restructured.** No change to CLARIFY's three questions, PLAN's
sections, the wave graph, `scoredChecks`, or the FAIL loop.

---

## Tests

### Before

Wiring the leg with the existing test file, unchanged:

```
 46 pass
 3 fail
 215 expect() calls
Ran 49 tests across 2 files. [26.49s]
```

All three failures were **exhaustive leg-set assertions** — `toEqual({compile, quotes,
addendum})` and `["addendum","compile","plan","quotes"]` — which now also see `widows`. In
every one the widows leg reported **PASS**: the shipped fixtures have no page-break defects,
so no fixture needed `--no-widows` and no existing invocation changed. Those three
assertions were widened; nothing else in the pre-existing tests was touched.

### After

```
bun test v1.4.0 (34cbb9a40)

 58 pass
 0 fail
 250 expect() calls
Ran 58 tests across 2 files. [27.47s]
```

Nine new tests, in `describe("the widows leg decides page-level breaks")`. **All nine are
fail-first, none is a regression guard** — the leg did not exist before, so every one of them
failed by construction.

1. a PDF with a known orphan FAILS and names the page
2. a PDF with a known widow FAILS and names the page
3. a heading stranded at the foot of a page FAILS
4. a clean PDF passes — so 1–3 are not the checker crying wolf
5. a failure states the fix is layout, never the court's words
6. **naming no widow flag still runs the leg** — the fail-closed assertion
7. `--no-widows` waives loudly and never claims page breaks hold
8. `--widows` + `--no-widows` is contradictory and FAILS
9. a failed compile FAILS the widows leg rather than passing it

**The fixture PDFs are drawn, not compiled**, by
`fixtures/make-pagebreak-fixture.py` (pymupdf, exact line geometry). This was forced, and it
matters: **Typst 0.15 suppressed every attempt to provoke a widow from prose.** A 40-point
`#v()` spacer sweep and a 35-point page-height sweep both came back clean at every step, and
`#set par(costs: (widow:, orphan:))` is not accepted by this Typst (`error: unexpected
argument: costs`). A Typst-compiled fixture would therefore have asserted nothing about the
checker. Drawing the lines makes the defect **stated** rather than hoped for; each fixture
carries exactly one defect of one kind, verified:

```
=== clean
PASS page-breaks: no widow, orphan or stranded heading in clean.pdf
exit=0
=== orphan
FAIL page-breaks: 1 defect(s) in orphan.pdf
  orphan at the foot of page 1: "ORPHANED first line and the court further observed that the record so reflected in ever"
exit=1
=== widow
FAIL page-breaks: 1 defect(s) in widow.pdf
  widow at the top of page 2: "WIDOWED last line."
exit=1
=== stranded-heading
FAIL page-breaks: 1 defect(s) in stranded-heading.pdf
  stranded-heading at the foot of page 1: "II. THE EFFORTS-OF-OTHERS PRONG"
exit=1
```

**Hermeticity preserved.** Nothing under `scripts/` or `fixtures/` reads
`/home/eh/areas/secreg`; the guard comment at `check.test.ts:6` remains the only occurrence.
The interpreter is resolved at runtime by the checker's own `--which-python`, so no
environment path is checked in. If no pymupdf interpreter is present, tests 1–5 print
`SKIPPED: no interpreter with pymupdf; set ELIDE_PYTHON` and return — never a silent pass —
while 6–9, which exercise the fail-closed wiring, run regardless. On this machine an
interpreter was found and all nine ran.

---

## The live gate

The invocation that passes is **the one you gave, unchanged** — no new flag is needed,
because the widows leg is on by default:

```bash
cd /home/eh/areas/secreg && bash /home/eh/projects/workflows/skills/elide-case/scripts/check.sh \
  --addendum addenda/02-addendum.typ --docs docs --plan .claude/plans/addendum-02.md
```

```
EXIT=0
LEG plan: PASS — both interview answers recorded in addendum-02.md; 4 reading(s) with a page target; 1 non-court reading(s) declared
LEG compile: PASS — 02-addendum.typ builds to 02-addendum.pdf
LEG quotes: PASS — 3 of 4 reading(s) verified verbatim, 1 declared unchecked
LEG addendum: PASS — arity, table page ranges and per-reading length (targets from the plan) all hold
LEG widows: PASS — no orphan, widow or stranded heading at any page boundary
PASS: every leg passed
```

Read-only: no `--pdf` was passed, so the compile went to a temp dir. `git status` under
`addenda/`, `output/` and `docs/` shows only files that were already untracked before this
run — nothing modified, nothing created by me under `~/areas/secreg`.

---

## Widow findings for the current Addendum II

**Clean.** Both shipped addenda PDFs, scanned read-only:

```
--- /home/eh/areas/secreg/output/addenda/20260216 Addendum I.pdf
PASS page-breaks: no widow, orphan or stranded heading in 20260216 Addendum I.pdf
exit=0
--- /home/eh/areas/secreg/output/addenda/20260909 Addendum II.pdf
PASS page-breaks: no widow, orphan or stranded heading in 20260909 Addendum II.pdf
exit=0
```

Zero orphans, zero widows, zero stranded headings — and the same for the PDF compiled fresh
from `addenda/02-addendum.typ` during the gate run. Nothing was fixed, because there was
nothing to fix.

**Read the clean result with its caveat.** Typst 0.15's layout appears to avoid these
defects on its own — that is the most likely reason both PDFs are clean and the reason no
prose fixture could be made to fail. The leg is worth having anyway: it costs one command,
it is the only thing in the gate that can see a page break at all, and Typst's avoidance is
not guaranteed once block quotes, `#v()` spacers, tables or figures land in an excerpt. What
the clean result does **not** license is the conclusion that the checker cannot fire — the
four drawn fixtures show it firing on each defect kind.

---

## What I could not do, and what to know

- **pymupdf is not importable from the ambient `python3`.** Everything works via the
  re-exec, but the interpreter it lands on is discovered, not pinned: on this machine it
  chose `/home/eh/areas/corps/.pixi/envs/default/bin/python` from the `$HOME` glob when run
  from `/tmp`, and secreg's own env when run from the course tree. Both have pymupdf 1.28.2
  and agree. If you want it pinned, set `ELIDE_PYTHON`. Adding pymupdf to a python the skill
  controls would be cleaner and I did not do it — that is a dependency decision, and the
  instruction was not to add one.
- **No Typst-compiled widow fixture exists**, for the reason above. The drawn fixtures assert
  the detector's logic against exact geometry; they do not assert that Typst can produce such
  a PDF. If Typst's avoidance is total for prose, the leg's real value is the stranded-heading
  and figure/block-quote cases, which I have not seen in the wild here.
- **The detector is calibrated for justified prose** (`#set par(justify: true)`, as both
  addenda use). A ragged-right addendum would make `continues()` unreliable, and the leg
  would under-report rather than over-report. Not currently a case that exists.
- **Nothing under `~/areas/secreg` was written or fixed**, as instructed.
- `ruff` flags style nits on the two new Python files (blind `except`, `zip`-vs-`pairwise`,
  `SIM103`, shebang-not-executable). Left as written; none affects behavior.
