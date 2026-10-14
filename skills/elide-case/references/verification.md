# Verification — what each gate leg decides

The whole mechanical verdict is the exit code of `${CLAUDE_PLUGIN_ROOT}/skills/elide-case/scripts/check.sh`. It runs seven legs,
none short-circuiting, and prints one PASS/FAIL line per leg. The checkers it drives are the
elide workflow's constraints, in `${CLAUDE_PLUGIN_ROOT}/checks/elide/constraints/`.

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/elide-case/scripts/check.sh \
  --addendum addenda/NN-addendum.typ --pdf output/addenda/<compiled>.pdf \
  --plan .claude/plans/<slug>.md
```

`--plan | --no-plan` is a required decision, and on a `--no-plan` run so is `--target | --no-target`;
naming neither flag of a required pair is a FAIL that names the missing one.

| leg | decides |
|---|---|
| `--plan` (`check-plan.py`) | the two CLARIFY interview answers and each reading's page target are recorded, and which readings are declared non-court |
| `typst compile` | the addendum builds at all |
| `check-quotes.py`, once per caption | every retained sentence is verbatim in the source docx (or the fallback `.txt`) |
| `check-addendum.py --target` | arity, table truth against the PDF, per-reading length |
| `widows.py`, `orphans.py`, `runts.py` --prose | the canonical stray-line checkers, from the typst plugin |
| `check-stranded-headings.py` | a heading at a page foot with its text overleaf — this skill's own class |
| `check-marks.py` | one elision mark per addendum; every retained `#super[N]` footnote renumbered 1..k per reading and paired with its body |
| `bin/workflow-check elide --constraints-only` | every constraint under `checks/elide/constraints/`, on the constraint contract, over the addendum and the plan: the five checkers above with their own defaults (no length target), `check-source-identity.py` (the mapped source contains the caption's reporter citation), and any constraint added there |

**The widows leg is the one leg that is ON BY DEFAULT**, and that is its fail-closed form:
naming no flag RUNS it, so its absence cannot read as a pass. `--no-widows` is the loud
waiver. It decides what `check-quotes.py` structurally cannot — the words can match the
reporter exactly while Typst sets them badly — and its fix vocabulary is layout only.

The caption list for the quotes leg is **derived from the `.typ`**, never passed in. A caption
list supplied as an argument lets a newly added reading go unchecked — the arity bug wearing a
different costume. A reading whose caption resolves to no source is a FAILING leg naming
that reading, never a silent skip.

## Leg 0 — `--plan`, the interview

The interview is the point of this workflow, and prose cannot enforce it. This leg is what
makes the refusal an exit code: it reads the named plan and FAILs when the `## Doctrinal
target` section is absent, when `Doctrinal thread:`, `Cuts against:` or `Taught for:` is
missing, empty or a placeholder (`TBD`, `N/A`, `<…>`), or when `Taught for:` says neither
holding nor reasoning. The failure names which answer is missing.

The same leg reads the plan's `## Non-court readings` bullets and hands them to the quotes
leg, which is how a reading with no reporter text gets exempted by the instructor rather than
by the file being checked. See `editing-marks.md`.

**The leg fails closed.** Passing neither `--plan` nor `--no-plan` is a FAIL naming the
missing flag. `--no-plan` is the explicit escape: it prints `NOT CHECKED` and does not fail,
but then the leg enforces nothing and the interview is back to being a sentence. Every real
run passes the plan path; a `cmd` that omits it has a hole exactly where this workflow's
purpose is.

## Leg 1 — compile

Exit 0 and the PDF exists. Nothing downstream is meaningful without a laid-out document:
page numbers do not exist until Typst produces them.

## Leg 2 — `check-quotes.py`

Proves every retained sentence is verbatim in the source docx (or the fallback `.txt`).

It strips the ECF running header, form feeds, standalone page numbers and inline footnote
reference markers (`et al.,1`) from the source before matching — `pdftotext -layout`
interleaves that furniture mid-sentence, so a genuinely verbatim sentence reports as missing
unless it is removed. A hand-rolled grep check reports the same
false positives from it. **Do not hand-grep quotations sentence by sentence.**

`--caption` is required once the addendum has more than one reading. `--skip-editorial`
drops your own `*[Editors' note` prose inside a `#text(10pt)[...]` block, which is not court
text and always reports as missing; it is off by default on purpose.

Two things it prints that are not failures:

- **`matched across a source gap`** — a footnote block sits physically between the two
  halves of the sentence it annotates, so such a sentence matches across ONE bounded gap.
  Read the printed gap and confirm it is apparatus, not dropped holding.
- **`ADVISORY - check these read as sentences:`** — a prose judgement that only prints.

A match proves fidelity to the **file**. Against a publisher-keyed `.westlaw.docx` that is also
fidelity to the reporter; against an OCR corpus source it is not, because the file matches its own
damage. See `authenticity.md`.

## Leg 3 — `check-addendum.py`

Checks, in order:

1. **arity** — table rows == caption blocks
2. **table truth** — each stated `pp. A--B` against the range computed from the PDF
3. **length** — each reading against `--target`

On success it prints the correct table rows in Typst syntax. **Write the table by pasting
those rows.** If it fails, fix the source and recompile — never hand-edit the table to
match. The checker is reporting the truth about the PDF.

- **The arity check is the one that catches a dead run.** A run that dies mid-write leaves a
  table describing readings the body does not contain — four rows over a two-reading body.
  Nothing about the compiled PDF looks wrong; it just lies.
- **Page targets are missed in both directions and by a lot.** An 11-page excerpt against a 4–6 target
  is not a generous reading assignment, it is a reading nobody finishes. On a `--plan` run the plan supplies each reading's target and `--target` is ignored; `--target` is the `--no-plan` override only.
- **The length check fails closed too.** Passing neither `--target MIN-MAX` nor
  `--no-target` is a FAIL naming the missing flag. `--no-target` is the explicit escape: arity
  and the table still run, the leg prints `LENGTH NOT CHECKED`, and its PASS line then reads
  "arity and table page ranges hold; per-reading length NOT CHECKED" rather than claiming a
  check nothing ran.

## How to read a miss rate

`check-quotes.py` reports N of M sentences found. The number to watch is the **rate**, not
the individual sentences.

**A miss rate above roughly a quarter means the wrong source or a corrupted cut — not bad
sentences.** Do not patch the flagged sentences one at a time. **Re-cut the whole reading
from its source (`docs/<name>.westlaw.docx`; the `.txt` only on the Route 2 fallback).** Patching individual sentences in a section whose provenance is
broken produces a section that passes the checker and still misquotes the court.

Presenting spliced half-sentences as a court's reasoning teaches the opposite of what the
case holds.

### Decimation, not interleave

A wrecked excerpt of alternating, fused lines is usually **line decimation** — the cut dropped
lines of a double-spaced source and joined the remainders with no ellipsis — not a two-column read. Interleave means re-extract the source differently;
decimation means re-cut from the same good source.

### The general rule this produced

**Never trust a corruption tell you have not grepped for in BOTH files.**

Before recording any claim about why a source is bad, run the grep against the source AND
against the excerpt, and paste both counts. Check that your own preprocessing — a
bracket-stripping regex, a whitespace normalizer, a `sed` in the pipeline — did not create
the artifact you are about to blame the source for. A tell that appears in your working copy
and in neither file on disk is a tell you invented.

Cheap discriminators, in order:

```bash
# Route 2 only: the .txt is the source. On the Westlaw route there is no .txt; the source is
# the docx projection, so run the same greps on its text (the westlaw extractor's output).
grep -c '[^[:space:]]' docs/<name>.txt                    # source line count
awk 'length>0{print length}' docs/<name>.txt | sort -n    # median line length
grep -cE '\b(W e|I f|T he)\b' docs/<name>.txt addenda/NN-addendum.typ  # Route 2: in BOTH
# Westlaw route: the same grep on the docx projection's text and on addenda/NN-addendum.typ
```

If the source measures clean and the excerpt is broken anyway, the damage is in the **cut**,
not the source — and the fix is to re-cut.
