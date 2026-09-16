# Verification — what each gate leg decides

The whole mechanical verdict is the exit code of `scripts/check.sh`. It runs five legs,
none short-circuiting, and prints one PASS/FAIL line per leg.

```bash
bash skills/elide-case/scripts/check.sh \
  --addendum addenda/NN-addendum.typ --pdf output/addenda/<compiled>.pdf \
  --plan .claude/plans/<slug>.md --target 4-6
```

Both `--plan | --no-plan` and `--target | --no-target` are required decisions; naming neither
flag of a pair is a FAIL that names the missing one.

| leg | decides |
|---|---|
| `--plan` | the two CLARIFY interview answers are recorded, and which readings are declared non-court |
| `typst compile` | the addendum builds at all |
| `check-quotes.py`, once per caption | every retained sentence is verbatim in `docs/*.txt` |
| `check-addendum.py --target` | arity, table truth against the PDF, per-reading length |
| `widows.py`, `orphans.py`, `runts.py` --prose | the canonical stray-line checkers, from the typst plugin |
| `check-stranded-headings.py` | a heading at a page foot with its text overleaf — this skill's own class |

**The widows leg is the one leg that is ON BY DEFAULT**, and that is its fail-closed form:
naming no flag RUNS it, so its absence cannot read as a pass. `--no-widows` is the loud
waiver. It decides what `check-quotes.py` structurally cannot — the words can match the
reporter exactly while Typst sets them badly — and its fix vocabulary is layout only.

The caption list for the quotes leg is **derived from the `.typ`**, never passed in. A caption
list supplied as an argument lets a newly added reading go unchecked — the arity bug wearing a
different costume. A reading whose caption resolves to no `docs/*.txt` is a FAILING leg naming
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

Proves every retained sentence is verbatim in the source `.txt`.

It strips the ECF running header, form feeds, standalone page numbers and inline footnote
reference markers (`et al.,1`) from the source before matching — `pdftotext -layout`
interleaves that furniture mid-sentence, so a genuinely verbatim sentence reports as missing
unless it is removed. Every hand-rolled grep check on the Telegram opinion produced the same
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
- **Page targets are missed in both directions and by a lot.** Hand runs on 2026-09-09
  produced an 11-page excerpt against a 4–6 target and a 2-page one. Eleven pages is not a
  generous reading assignment, it is a reading nobody finishes. Always pass `--target`.
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
from the `.txt` in `docs/`.** Patching individual sentences in a section whose provenance is
broken produces a section that passes the checker and still misquotes the court.

Presenting spliced half-sentences as a court's reasoning teaches the opposite of what the
case holds.

### The Mutual Benefits case — what actually went wrong

Run on 02-addendum's Mutual Benefits section, `check-quotes.py` reports **9 of 21**. The
conclusion above is right; the diagnosis originally recorded for it was **false**, and the
way it was false is the lesson.

**The false diagnosis** (recorded, then measured and disproved on 2026-09-09) said the
section was cut from a two-column source PDF, with tells *spaced capitals at line starts
(`W e`, `I f`)*, by the mechanism *`pdftotext -layout` reading a two-column page straight
across*. All three claims are wrong:

- The source `docs/SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.txt` is **clean
  single-column** — ~375 non-empty lines (374 by `grep -c '[^[:space:]]'`), median line
  length 81, and twenty consecutive lines read as connected prose.
- `grep -c` for the spaced-capital tell returns **0 in BOTH** the source and the corrupt
  excerpt. That tell never existed in either file. It was **manufactured by the reviewer's
  own bracket-stripping regex**, which turned `[W]e` into `W e` in the reviewer's working
  copy and was then reported as a property of the source.

**The real mechanism is LINE DECIMATION.** The `.txt` is double-spaced, so prose sits on
alternating lines. The excerpt took source lines 57, 59, 65 — dropping 61 and 63 — and 604,
606, 610 — dropping 608 — and concatenated the surviving remainders into sentences the
Eleventh Circuit never wrote. Every other line of real text is simply gone, and what is left
is fused across the deletions with no ellipsis at the join.

Decimation and column-interleave produce a similar-looking wreck — disconnected alternating
lines, fused sentences — which is why the wrong diagnosis was plausible. They call for
different fixes: interleave means re-extract the PDF differently, decimation means the cut
itself dropped lines and the reading must be re-cut from the same good `.txt`.

### The general rule this produced

**Never trust a corruption tell you have not grepped for in BOTH files.**

Before recording any claim about why a source is bad, run the grep against the source AND
against the excerpt, and paste both counts. Check that your own preprocessing — a
bracket-stripping regex, a whitespace normalizer, a `sed` in the pipeline — did not create
the artifact you are about to blame the source for. A tell that appears in your working copy
and in neither file on disk is a tell you invented.

Cheap discriminators, in order:

```bash
grep -c '[^[:space:]]' docs/<name>.txt                    # source line count
awk 'length>0{print length}' docs/<name>.txt | sort -n    # median line length
grep -cE '\b(W e|I f|T he)\b' docs/<name>.txt addenda/NN-addendum.typ  # in BOTH
```

If the source measures clean and the excerpt is broken anyway, the damage is in the **cut**,
not the source — and the fix is to re-cut.
