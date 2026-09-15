# Horse race on a real document: Tornetta v. Musk addendum

Measured 2026-09-10 against `typst 0.15.0 (3ae52774)`. Subject:
`/home/eh/areas/colloquium/addenda/02-addendum-tornetta.typ`, 444 lines, compiling to a
23-page PDF, 958 body lines. All compiles and scratch work in `/tmp/tornetta/`. Nothing under
`/home/eh/areas` was written; no shipped file in this skill was changed. pymupdf ran under
`/home/eh/areas/corps/.pixi/envs/default/bin/python` (the interpreter the checker itself
re-execs into).

**Headline: the checker fires four times on the default compile, and three of the four are
false positives.** The premise printed in its own docstring — "Detection rests on justified
body text" — does not hold for this document, which is set ragged right.

## Contestants

- **A** — `scripts/check-page-breaks.py` as it stands. Raced.
- **B** — `#set text(costs: (widow: N%, orphan: N%))` prepended to a copy, N ∈ {0, 50, 100,
  400} plus unset, recompiled each time. Raced.
- **C** — the in-`.typ` marker/query prototype. **Not raced, and I am saying so rather than
  dropping it quietly.** In the synthetic round it scored 3 false negatives and 1 false
  positive on a 4-case set, failing the clean file and passing every broken one. Its two
  measured blockers (a trailing marker reports the *next* block's position; line pitch is not
  recoverable in `.typ`) are properties of the language, not of the fixture, and both get
  worse here: this document mixes 11pt body, 13pt caption and indented block quotes, so a
  single pitch constant cannot exist. Rebuilding it would have cost a large share of the
  budget to reproduce a known-negative result.

## A on the default compile

`typst compile --root . addenda/02-addendum-tornetta.typ` → `check-page-breaks.py` →
**exit 1, 4 defects.**

| # | Kind | Page | Offending text (as printed) | Verdict after eyeballing |
|---|---|---|---|---|
| 1 | stranded-heading | foot of 10 | `a. Musk Controlled The Timing.` | **GENUINE** |
| 2 | widow | top of 12 | `all different than I think were initially thought of by Elon. But I don't want to say that it was` | **FALSE POSITIVE** |
| 3 | orphan | foot of 19 | `market capitalization. After all, he stood to benefit by over $10 billion for every $50 billion incr…` | **FALSE POSITIVE** |
| 4 | widow | top of 20 | `His equity stake was also a powerful incentive to avoid allowing Tesla to fall in what Musk might` | **FALSE POSITIVE** |

### Eyeballed confirmation

**Finding 1 is real.** Rendered crop of the bottom of page 10, read back verbatim:

```
that they did not view the process as an arm's length negotiation.
a. Musk Controlled The Timing.          <- bold, last line on the page
```

Page 11 opens with `Defendants emphasize that nine months passed after the initial April 9
call…`. A bold subsection heading sits alone at the foot of page 10 with its body overleaf.
That is the defect the checker names, and it is the first positive fixture for the
stranded-heading class in either round — the synthetic round could not provoke one at all.

**Finding 4 is not real.** Rendered crop of the top of page 20, read back verbatim:

```
His equity stake was also a powerful incentive to avoid allowing Tesla to fall in what Musk might
consider to be incapable hands.
The principal defect with Defendants' give/get argument (indeed, their fair price argument as a
```

The carried-over paragraph puts **two** lines on page 20, not one. No widow. Finding 3 is the
same page boundary seen from the other side: paragraph #168 (`So why not here? Why did Tesla
have to "give" anything…`) has **four** lines on page 19, so its last line is not its first
line and there is no orphan. Finding 2 is the same shape at the 11→12 boundary: paragraph #92
puts 4 lines on page 11 and 2 on page 12.

### Why A misfires: the justification premise fails

| Measurement | Value |
|---|---|
| Body lines in the PDF | 958 |
| Modal right edge (what `continues()` uses) | x1 = 522.0 |
| Lines within 3 pt of it (`continues()` true) | 226 = **23.6 %** |
| Lines within 10 pt | 40.2 % |
| Population stdev of x1 among near-margin lines | 11.5 pt |
| Max / min x1 | 527 / 88 |

In justified prose ~90 % of lines land within a point of the margin. Here fewer than a quarter
do. The source sets no rules at all — no `#set par(justify: true)`, no `#set page`, no `#set
text` — and Typst's default is `justify: false`, so the file compiles ragged right. Both the
geometry and the source agree. `continues()` therefore reads a merely-short line as "paragraph
ended here," which is exactly how a 2-line carryover becomes a reported widow.

(Caution worth recording: the vision model reading the page crop called the text "justified."
Long ragged lines look flush at a glance. The x1 distribution and the absent `set par` rule are
the evidence; the visual impression is not.)

### Independent ground truth

To judge A rather than take its word, I reconstructed paragraph membership from the **source**:
split `.typ` on blank lines, normalize to alphanumerics, match each paragraph's opening against
PDF line text in order, then count lines per (paragraph, page). This needs no justification
assumption. 210 of 220 source paragraphs matched; the 10 misses are markup-only blocks
(`#pagebreak()`, `#v()`, the `* * *` separators) and three `#quote(block: true)` openings.
Unmatched openings merge into the preceding paragraph, which *inflates* line counts — so this
ground truth can miss a defect but is very unlikely to invent one.

| Compile | Cross-page paragraphs | Paragraphs leaving a **1-line** fragment (true widow/orphan) |
|---|---|---|
| default / unset | 12 | **0** |
| `costs: 0%` | — | **8** |

Zero real widows and zero real orphans in the shipped default. All three of A's
widow/orphan findings are artifacts; only the stranded heading survives.

## B — the `costs` sweep

Layout hash = md5 over every body line's `(page, top-y, right-x, text)`. Identical hash means
byte-identical layout.

| `costs` value | Compile | Pages / lines | Layout hash | A's verdict | A's defect count | Ground-truth 1-line fragments |
|---|---|---|---|---|---|---|
| unset (default) | ok | 23 / 958 | `b6c2069e9f2e` | FAIL | 4 (1 real + 3 FP) | 0 |
| 0 % | ok | 23 / 958 | `e65679fac510` | FAIL | 4 | **8** |
| 50 % | ok | 23 / 958 | `b6c2069e9f2e` | FAIL | 4 (same 4) | 0 |
| 100 % | ok | 23 / 958 | `b6c2069e9f2e` | FAIL | 4 (same 4) | 0 |
| 400 % | ok | 23 / 958 | `b6c2069e9f2e` | FAIL | 4 (same 4) | 0 |

The default compile and the sweep's unset copy also hash identically (`b6c2069e9f2e`), so the
copy is faithful.

**50 %, 100 %, 400 % and unset are one and the same layout, to the point.** Only 0 % differs.
The prior round's small-scale conclusion is **confirmed, not overturned**: on 23 pages of real
prose, setting `costs` at or above 50 % is a measurable no-op, and 400 % buys nothing over
100 %. The one new fact is the lower bound: 50 % is already indistinguishable from the default,
where the synthetic round only tested 0 / 100 / 400.

At 0 % the document genuinely degrades — 8 single-line paragraph fragments across the 23 pages,
including a widow at the top of page 22 reading only `privately held portfolio company.` A
reports only 3 widow/orphan findings on that file, at page boundaries that do not match any of
the 8. So on this document A both invents defects that are not there and misses most of the
ones that are.

## Runtimes

| Step | Wall clock (3 runs) |
|---|---|
| `typst compile` of the 23-page addendum | 152 / 157 / 153 ms |
| A, run under the pymupdf interpreter directly | 157 / 148 / 156 ms |
| A, invoked as `python3 …` (pays the re-exec probe) | 293 ms |
| B, one sweep point (compile + check) | ≈ 0.31 s |
| B, full 5-value sweep | ≈ 1.6 s |
| C | not run |

Nothing here is a cost consideration. Both approaches are sub-second on the real document.

## The three questions, answered plainly

**1. Does the real 23-page document contain widows or orphans under the default? No — but it
does contain one stranded heading.** Ground truth over 12 cross-page paragraphs finds zero
one-line fragments; every carried paragraph puts at least two lines on each side. Typst's
default widow/orphan protection is doing its job on real long-form prose exactly as it did on
the fixtures. The *stranded heading* at the foot of page 10 is real, and `costs` does not touch
that class — it is a block-breaking question, not a line-cost one. So the leg is justified, but
by a different defect than expected, and the earlier "Addenda I and II are clean" result is
better read as "the default prevents widows and orphans" than as small-sample luck.

**2. Does `text(costs:)` do anything measurable at this scale? No, above 0 %.** Unset, 50 %,
100 % and 400 % produce a byte-identical 958-line layout. The prior round's finding survives
contact with a real document. Only 0 % changes anything, and it changes it for the worse (8
real fragments). Writing `costs: 100%` into an addendum preamble would be a documented no-op
dressed as protection.

**3. Does "change nothing" survive? Half of it does; the other half must change.**

- *Do not add `text(costs:)` to the preamble.* Confirmed on real input. Unchanged.
- *Keep the external checker* — but **it cannot be trusted as a gate on this document as
  written.** It fails a file whose only real defect is one heading, on the strength of three
  fabricated widow/orphan findings, and it does so silently: the output reads like four
  defects, and an author fixing them would be chasing three ghosts through the court's text —
  precisely the pressure the script's own "FIX BY LAYOUT ONLY" warning exists to resist.

**Recommendation (recommend only; nothing was changed).** In order:

1. **Make the justification premise checkable rather than assumed.** `body_metrics()` should
   compute the fraction of lines flush to the modal right edge and, below some threshold
   (~60 %), refuse to render widow/orphan verdicts — reporting "input is not justified;
   widow/orphan detection not applicable" and running the stranded-heading check only. That is
   a decidable condition over data the script already extracts, and it converts today's silent
   false positives into an explicit non-answer.
2. **Or set the addendum justified**, which is arguably what it wants anyway: this file sets no
   page, text or par rules at all and inherits A4 with Typst defaults, which is unlikely to be
   the intended classroom typography. Adding `#set par(justify: true)` in the wrapper would
   make the checker's premise true and would independently improve the page. This is a decision
   for the user about their live document, not for this skill.
3. **Either way, fix the stranded heading on page 10 by layout**, not by text.

Note also that the "stranded heading" check is the only one that survived here, and it is the
class the synthetic round could never exercise. Its detection uses bold-and-short rather than
justification, which is why it is unaffected by the ragged-right problem.

## What I could not determine

1. Whether `#set par(justify: true)` would eliminate A's three false positives, or merely move
   them. I did not compile a justified variant — the sweep the task specified was over `costs`,
   and adding a justify variant would have changed the subject mid-race.
2. Whether the 10 unmatched source paragraphs conceal a real widow. Merging inflates counts, so
   the direction of the error is toward *missing* a defect; I did not hand-check all 12
   cross-page boundaries visually, only the two the checker flagged.
3. Where `costs` stops being a no-op between 0 % and 50 %. I swept the values the prior round
   used; 25 % was not tested.
4. Whether `costs` affects stranded headings at all. The page-10 heading is present at every
   swept value including 0 %, which is consistent with "not covered," but I did not construct a
   case that would isolate the mechanism.
5. Whether the widow and orphan keys act independently. Varied together throughout, as before.
6. Whether the 8 fragments under `costs: 0%` are all genuine. Only the page-22 one
   (`privately held portfolio company.`) was inspected in text form; none of the eight was
   rendered and eyeballed, because the 0 % file is a diagnostic artifact, not shipped output.
7. Why `out-400.pdf` has a different file-level md5 from `out-100.pdf` despite an identical
   layout hash. Non-layout bytes (embedded metadata) differ; I did not chase it, since the
   layout hash is the measurement that matters.
