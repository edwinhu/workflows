# Runts, implemented

Implementation of RUNTS.md §5, 2026-09-10. Files changed:

- `/home/eh/projects/teaching/scripts/check-widows.py` (shared with the slides workflow)
- `/home/eh/projects/workflows/skills/elide-case/scripts/check-page-breaks.py`
- `/home/eh/projects/workflows/skills/elide-case/scripts/check.sh`
- `/home/eh/projects/workflows/skills/elide-case/scripts/check.test.ts`
- `/home/eh/projects/workflows/skills/elide-case/fixtures/make-pagebreak-fixture.py`
- `/home/eh/projects/workflows/skills/elide-case/fixtures/mini-addendum.typ`, `fixtures/source-addendum.typ`
  (one editorial sentence reworded — see §6)

Nothing under `/home/eh/areas` was written. `git status` in `secreg` shows no change under
`addenda/` or `docs/`, `colloquium` shows only its pre-existing untracked tree, and every compile
went to `/tmp/runtimpl/`. pymupdf ran under `/home/eh/areas/corps/.pixi/envs/default/bin/python`.

---

## 1. The two edits to `check-widows.py`

### (a) The dedup key

Before:

```python
            # Dedup across animation steps (same slide + same text)
            dedup_key = (slide_num, curr_text)
```

After:

```python
            # Dedup across animation steps (same slide + same text). The page is
            # part of the key when there is NO slide number: a document with no
            # Touying footer returns None on every page, and (None, text) is then
            # a DOCUMENT-GLOBAL dedup on line text, which silently swallows the
            # second occurrence of any repeated one-word line. On slides slide_num
            # is present, so this branch never fires there.
            dedup_key = (
                (slide_num, curr_text) if slide_num is not None else (page_num, curr_text)
            )
```

The RUNTS.md prediction holds exactly: Tornetta now reports **20** runts including
`page 17: "process."`, the one the global dedup swallowed. 19/20 → 20/20.

### (b) The 15% footer cutoff

Before:

```python
def is_chrome(line: dict, page_height: float) -> bool:
    """Detect header/footer/slide-number lines to exclude."""
    text = line["text"]
    y = line["y0"]
    # Footer region (bottom 15%)
    if y > page_height * 0.85:
        return True
```

After (signature parameterized, default unchanged; `detect_widows` gained a matching
`footer_frac` parameter and passes it through):

```python
def is_chrome(line: dict, page_height: float, footer_frac: float = 0.85) -> bool:
    """Detect header/footer/slide-number lines to exclude.

    footer_frac is the fraction of the page above which a line counts as footer
    chrome. 0.85 is a SLIDE constant — a Touying footer occupies the bottom 15%
    of a 16:9 frame. On A4 prose the same constant discards the bottom four body
    lines of every page, so prose callers pass a value near the page number's own
    band instead.
    """
    text = line["text"]
    y = line["y0"]
    if y > page_height * footer_frac:
        return True
```

`--prose` defaults it to 0.96; `--footer-frac` overrides either.

### Three further prose-only knobs, disclosed rather than smuggled in

RUNTS.md named two blocking defects. Running the result against real documents exposed three more
that are prose-specific, all off by default and therefore invisible to slides:

1. **`skip_first_unnumbered`** (default `True`, `--prose` sets `False`). The existing "skip the TOC
   page" rule keys on *page 1 with no slide number*. On a document with no slide numbers anywhere,
   that is body text, and skipping it hides real findings.
2. **`max_short_words=0` under `--prose`.** The two-word "short continuation" class needs its own
   undefended threshold and RUNTS.md §4 already caught it firing on a judge line. The runt rule is
   exactly one word.
3. **`paragraph_gap_from_leading`** (default `False`, `--prose` sets `True`). This one I did not
   plan and am flagging as a correction to my own §4 claim of *perfect* precision. The shipped
   `max_line_gap = 35.0` is a slide constant; on prose it lets a **one-word standalone paragraph**
   read as a runt. The `mini-addendum.typ` fixture exposed it immediately: `AFFIRMED.`, which is its
   own paragraph, was reported as a runt. In prose mode the gap cut is now `1.4 x the document's
   modal leading` — RUNTS.md's own Method B paragraph-boundary rule, measured per document rather
   than a new tuned constant. After it, `AFFIRMED.` is gone and Tornetta's count is unchanged at 20.

### Slide-regression evidence

**There is no test in `/home/eh/projects/teaching/tests/` covering `check-widows.py`'s detection
behavior.** `grep -rn widow tests/` returns only `mechanical-floor-compile-gate.test.mjs`, which
greps `report-slides.sh`'s *source text* for exit-code handling, and a filename mention in
`native-workflow-doctrine.test.ts`. Nothing runs the detector against a PDF. I am saying so plainly
rather than claiming safety a suite gave me.

So I built the evidence: **45 real compiled PDFs** in `/home/eh/areas/secreg/output/`, run through
the unmodified script and the modified one, byte-diffed.

```
$ diff /tmp/runtimpl/slides-BEFORE.txt /tmp/runtimpl/slides-AFTER2.txt
312c312
< Found 13 potential widow/orphan(s) in 08-security.pdf:
> Found 14 potential widow/orphan(s) in 08-security.pdf:
346a347,349
>   page 10: "security."
>     after: "them initially. The loan is secured and pays market-rate interest. The"
939c942
< Found 11 potential widow/orphan(s) in practice-exam-1-mc.pdf:
> Found 12 potential widow/orphan(s) in practice-exam-1-mc.pdf:
970a974,976
>   page 7: "a) I." (short continuation)
>     after: "profits come “predominantly” from others’ efforts."
1105c1111
< Found 18 potential widow/orphan(s) in practice-exam-2.pdf:
> Found 19 potential widow/orphan(s) in practice-exam-2.pdf:
1144a1151,1153
>   page 11: "misleading."
>     after: "filing. § 11 reaches both untrue statements and omissions necessary to"
```

**42 of 45 are byte-identical. Three gained exactly one finding each.** The honest reading:

- Every finding in the diff is reported as `page N`, not `slide N`. That is the tell: `slide_num`
  was `None` on those pages, so the old global dedup applied.
- Classified by document, **every PDF that reports slide numbers at all is byte-identical**,
  including `09-exempt-pres.pdf`, which is a genuine Touying deck with 68 slide-numbered findings
  *and* 9 page-numbered ones. The three that changed (`08-security.pdf`, `practice-exam-1-mc.pdf`,
  `practice-exam-2.pdf`) report **zero** slide-numbered findings — they are handouts and exams, i.e.
  prose, not decks.
- Each new finding is the second occurrence of a line that was already reported elsewhere:
  `"security."` at pages 5 and 10; `"a) I."` at pages 3 and 7; `"misleading."` at pages 4 and 11.
  These are the swallowed duplicates, surfacing.

**So the strict claim "the slide path behaves exactly as before" is TRUE on the slide path and
FALSE as a statement about the whole 45-file corpus, and I am not rounding that off.** Fixing the
global dedup necessarily changes output on unnumbered pages — that *is* the bug — and the three
affected files are prose documents that happen to sit in `output/`. If the instructor wants literal
byte-identity across everything, the narrower form is to page-key only when *no* page in the
document carries a number; that would leave the bug live on the unnumbered pages of mixed decks. I
did not take it, and I flag the choice rather than hide it.

The `paragraph_gap_from_leading` addition was measured separately and is inert on slides:

```
$ diff /tmp/runtimpl/slides-AFTER.txt /tmp/runtimpl/slides-AFTER2.txt
IDENTICAL: the paragraph-gap rule is prose-only and changed nothing on the slide path
```

---

## 2. The new leg: `strays`, with three distinct names

The leg was `widows`. It is now **`strays`** — the family of stray lines — with flags
`--strays` / `--no-strays`, matching the established `--plan`/`--no-plan`,
`--target`/`--no-target` convention exactly. `--widows`/`--no-widows` are accepted as the old
names of the same pair, so no existing invocation (including the hashed `mechanicalChecks` entry
in `.claude/plans/elide-case-workflow.md`, which no task may rewrite) breaks. That is the same
convention under an old name, not a third one.

**No second `mechanicalChecks` entry was added.** The runt check is a sub-check inside the one
`check.sh` leg.

Each defect reports under its own name. On a failing run:

```
--- leg strays
  PASS page-breaks: no widow, orphan or stranded heading in 02-addendum.pdf
  SUB widow/orphan/stranded-heading: PASS — none at any page boundary
  Found 3 potential runt(s) in 02-addendum.pdf:
    page 4: "participant.”"
  SUB runt: FAIL — at least one paragraph ends on a single stranded word
LEG strays: FAIL — at least one widow, orphan, stranded heading or runt
```

Fail-closed, as the other legs are: the flag's **absence runs the check**. `--no-strays` is the
loud waiver and now names runts in its warning
(`NOBODY IS CHECKING PAGE BREAKS OR RUNTS`); `--strays` with `--no-strays` is a FAIL.

The runt sub-check has its own exit code (`check-widows.py --prose`, 0/1/2) and its own line, and
it runs unconditionally after the widow/orphan sub-check — including when that one refuses itself.
`check.sh` borrows `check-page-breaks.py --which-python` to find a pymupdf interpreter, since
`check-widows.py` does not re-exec on its own; a runt checker that could not run is a FAIL, never a
skip.

---

## 3. The refusal in `check-page-breaks.py`

`body_metrics()` now returns a fourth value, the flush-right fraction, computed from the `x1`
values it already extracts:

```python
    flush = (
        sum(1 for v in x1s if v >= right - right_tol) / len(x1s) if x1s else 0.0
    )
    return right, body, lead, flush
```

`analyze()` takes `min_flush_frac=0.60` and, below it, skips the widow and orphan branches while
leaving the stranded-heading branch untouched. The stranded-heading test is bold-and-short, not
flush-right, so it is geometry-independent by construction.

Behavior, verbatim, on the live Tornetta addendum:

```
$ check-page-breaks.py /tmp/runtimpl/tornetta.pdf
REFUSED widow/orphan: only 23.7% of lines are flush to the right margin (floor 60%), so this
document is NOT justified and widow/orphan detection is not applicable. This is a NON-ANSWER, not
a clean bill: nobody judged widows or orphans here. Stranded headings were still checked.
FAIL page-breaks: 1 defect(s) in tornetta.pdf
  stranded-heading at the foot of page 14: "2. The Process Disclosures"
    adjoining: "When asked to approve a transaction, stockholders are entitled to a full and acc"
EXIT=1
```

23.7% matches the horse race's measured 23.6% to the rounding.

**Exit code 3** is the refusal with nothing else found — deliberately neither 0 nor 1. `check.sh`
maps it to `SUB widow/orphan: NOT JUDGED`, and the verdict line carries it either way:

- passing run: `PASS: every leg passed — EXCEPT widow/orphan, which the checker REFUSED to judge
  on unjustified text`
- failing run: `FAIL: ... strays=FAIL(widow/orphan NOT-JUDGED)`

A refusal never prints `PASS page-breaks` and never reaches the leg's
`LEG strays: PASS — no widow, orphan, stranded heading or runt` line.

**What the refusal removed.** Same PDF, floor lowered to 0 to reproduce the old behavior:

```
$ check-page-breaks.py /tmp/runtimpl/tornetta.pdf --min-flush-frac 0.0
FAIL page-breaks: 9 defect(s) in tornetta.pdf
  widow at the top of page 3 / widow page 4 / orphan page 6 / widow page 7 / orphan page 9 /
  orphan page 13 / widow page 14 / stranded-heading page 14 / widow page 21
```

Nine findings become one. Eight of the nine were widow/orphan verdicts rendered on geometry that
cannot support them.

---

## 4. Test suite — verbatim

```
$ cd /home/eh/projects/workflows/skills/elide-case/scripts && bun test
bun test v1.4.0 (34cbb9a40)

 68 pass
 0 fail
 289 expect() calls
Ran 68 tests across 2 files. [41.86s]
```

Baseline before any edit was `58 pass / 0 fail`. Ten tests added.

**Fail-first** (each fails against the pre-change scripts, by construction — the behavior did not
exist):

| test | what it pins |
|---|---|
| a repeated one-word line on a LATER page is still reported | the dedup fix; asserts `page 2: "process."` explicitly, the finding the old key swallowed |
| a runt is reported as a RUNT, not as a widow | the three names are distinct in the output |
| below the flush-right floor the checker REFUSES rather than emitting verdicts | refusal fires, no widow/orphan lines, no `PASS page-breaks`, exit 3 |
| the stranded-heading check keeps running through the refusal | the geometry-independent check survives |
| the refusal turns on a measured fraction, not on a guess | same PDF refused at the shipped floor, judged at floor 0; a justified fixture is above the floor |
| naming no strays flag runs the RUNT sub-check under its own name | the runt leg's fail-closed flag |
| --no-strays waives the RUNT sub-check too, and says so | the waiver covers runts and says so |
| a refused widow/orphan verdict never reads as a pass in the summary | the non-answer reaches the summary line |
| the runt sub-check still runs when the widow/orphan verdict refuses itself | the two sub-checks do not share a gate |

**Regression guard, not fail-first** (labeled as such in the file, as in the two prior rounds):

| test | why |
|---|---|
| `--no-widows` is still accepted as the old name of `--no-strays` | the leg was renamed and its callers were not; this would have passed before the change too, under the old name |

Three new fixture kinds in `make-pagebreak-fixture.py` — `ragged`, `ragged-heading`,
`runt-repeat` — drawn, not compiled, for the same reason the existing four are: a stated defect
beats a hoped-for one. A `raggedFixture()` helper flips `#set par(justify: true)` to `false` in a
copied addendum so the `check.sh`-level refusal is provoked from the source (`--pdf` cannot be used
to inject a drawn PDF, because the compile leg writes to that path).

---

## 5. Tornetta, read-only

Compiled from the live source to `/tmp/runtimpl/tornetta.pdf`; nothing written under
`/home/eh/areas`.

**20 runts — the RUNTS.md count exactly, page for page and word for word:**

```
Found 20 potential runt(s) in tornetta.pdf:
  page 3: "discussed."     page 12: "tries.”"
  page 4: "milestones."    page 13: "comparable.”"
  page 5: "entirety."      page 13: "follows:"
  page 5: "fairness."      page 13: "process."
  page 6: "obligations."   page 16: "fair."
  page 7: "analysis."      page 17: "process."     <- the one the old dedup swallowed
  page 8: "1960s."         page 18: "Musk[.]"
  page 10: "wanted[.]”"    page 18: "community[.]”"
  page 11: "timing."       page 19: "Officer.”"
  page 12: "Elon[.]”"      page 23: "vote."
```

**The stranded heading is real but is NOT the one the horse race named.** It reports
`2. The Process Disclosures` at the foot of page 14, not `a. Musk Controlled The Timing.` at the
foot of page 10. The cause is not my edits: **the instructor has edited the source since the runt
round.** RUNTS.md recorded `mtime 2026-09-10 09:27`; it now reads `2026-09-10 10:31:17`. The
stranded-heading code path is byte-for-byte unchanged by this work, and it fires on the current
document at the current page. The four false positives of the horse race are gone; one genuine
stranded heading survives, as predicted.

---

## 6. The secreg gate — it FAILS, and the finding is real

Exact invocation:

```
cd /home/eh/areas/secreg && bash /home/eh/projects/workflows/skills/elide-case/scripts/check.sh \
  --addendum addenda/02-addendum.typ --docs docs --plan .claude/plans/addendum-02.md
```

Verbatim tail:

```
LEG plan: PASS — both interview answers recorded in addendum-02.md; 4 reading(s) with a page target; 1 non-court reading(s) declared
LEG compile: PASS — 02-addendum.typ builds to 02-addendum.pdf
LEG quotes: PASS — 3 of 4 reading(s) verified verbatim, 1 declared unchecked
LEG addendum: PASS — arity, table page ranges and per-reading length (targets from the plan) all hold
--- leg strays
  PASS page-breaks: no widow, orphan or stranded heading in 02-addendum.pdf
  SUB widow/orphan/stranded-heading: PASS — none at any page boundary
  Found 3 potential runt(s) in 02-addendum.pdf:

    page 4: "participant.”"
      after: "and offers made to investors; it is not a search for the precise motiv"

    page 7: "contracts."
      after: "concludes that Ripple’s Other Distributions did not constitute the off"

    page 10: "ellipses.]"
      after: "without further notice. Omissions within and between passages are indi"

  SUB runt: FAIL — at least one paragraph ends on a single stranded word
    FIX BY LAYOUT ONLY — the measure, spacing, hyphenation or the line break.
    Deleting a word visibly closes a runt, and that is exactly what the verbatim gate forbids.
LEG strays: FAIL — at least one widow, orphan, stranded heading or runt
--- verdict
FAIL: plan=PASS compile=PASS quotes=PASS addendum=PASS strays=FAIL
EXIT=1
```

**Four of the five legs pass. The gate is red on three genuine runts**, and the offending words are
`participant.”` (p4), `contracts.` (p7) and `ellipses.]` (p10). The check was not weakened to get
green. Note that Addendum II is set `justify: true`, so widow/orphan was **judged**, not refused —
the refusal and the runt finding are independent, exactly as designed.

Two of the three are court text (`participant.”`, `contracts.`) and must be fixed by layout, never
by rewriting. The third, `ellipses.]`, is the instructor's own editors' note and can be reworded
freely — which is what I did in the two *fixtures*, below.

**Fixture change, disclosed.** `fixtures/mini-addendum.typ` and `fixtures/source-addendum.typ`
carry the same editors' note and so had the same real runt. I fixed it in the fixtures by rewording
the note — authored commentary, not court text —
`"indicated by bracketed ellipses.]"` → `"indicated by bracketed ellipses in the excerpt below.]"`.
That is a layout fix on prose the project owns, not a loosened assertion. I did **not** make the
equivalent change to the live `secreg` addendum: that is the instructor's document.

---

## Left undone, and one thing to decide

1. **`skills/slides/scripts/check-widows.py` was not touched.** It is an older, diverged copy of
   the same script (it still inlines `compile_typ`, lacks `find_source_line`, and has the
   pre-fix `^\d+\.\d*\.?\s` chrome regex). It carries the global-dedup bug. Reconciling the two
   copies is its own task and I did not fold it into this one.
2. **The PASS-with-refusal summary clause is not covered by a test.** The string
   `REFUSED to judge on unjustified text` appears only when every leg passes; no fixture yields a
   ragged-right addendum with zero runts, so only the FAIL form
   (`strays=FAIL(widow/orphan NOT-JUDGED)`) is exercised. The assertion is written as an
   alternation over the three non-answer strings, which is weaker than I would like.
3. **`--json` output shape changed** from a bare list to `{"findings": [...], "geometry": {...}}`.
   `grep` found no consumer, and the test suite is now one.
4. **The 0.60 floor is not calibrated.** It comes from the horse race's recommendation. Measured:
   Tornetta 23.7%, a justified fixture well above it, the drawn ragged fixture 42.1%. Nothing
   between 42% and the justified fixtures was tested, so the exact placement of the floor inside
   that gap is unexercised.
5. **The runt rule's false-positive class is narrowed, not closed.** `paragraph_gap_from_leading`
   removes the one-word standalone paragraph on documents with a uniform modal leading. A document
   mixing body, caption and block-quote leading (Tornetta does) has one modal value that may not
   describe every block, so a one-word paragraph in an unusual block could still report.
6. **For the instructor, unchanged from RUNTS.md §5:** setting the Tornetta addendum
   `#set par(justify: true)` would cut its runts from 20 to 9 *and* make the widow/orphan leg's
   premise true, so the refusal would stop firing. That is a decision about a live document and
   remains his.
