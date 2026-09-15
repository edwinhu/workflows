# Runts: single words stranded at the end of a paragraph

Measured 2026-09-10 against `typst 0.15.0 (3ae52774)`. Subject:
`/home/eh/areas/colloquium/addenda/02-addendum-tornetta.typ`, compiled with
`typst compile --root . addenda/02-addendum-tornetta.typ <out>` from `/home/eh/areas/colloquium`
to a 23-page, 958-body-line PDF. All compiles, sweep copies and scratch work live in
`/tmp/runts/`. Nothing under `/home/eh/areas` was written — the live source still carries its
pre-session mtime of `2026-09-10 09:27`, and every sweep variant was compiled from a copy in
`/tmp/runts/work/`. No shipped file in this skill or in `/home/eh/projects/teaching/scripts`
was changed. pymupdf ran under `/home/eh/areas/corps/.pixi/envs/default/bin/python`.

**Headline, and it is the opposite of the widow round's.** Tornetta has **20 runts** under the
default compile — a real, dense defect class where widows and orphans numbered zero. But
`costs.runt` **does not touch a single one of them**, because this document is set ragged
right, and Typst applies line costs only in the optimized line breaker, which `justify: false`
never invokes. Prevention does not beat detection here. It is not even available.

The second headline: **`check-widows.py` already implements this check, and finds 19 of the 20.**
The capability exists and is misfiled under the wrong name.

---

## 1. The count: 20 runts under the default compile

Threshold used, stated before the count (defended in §2): **a runt is the last line of a
multi-line prose paragraph that holds exactly one word.**

Two independent detectors were built and they agree on the same 20 lines exactly.

- **Method A — source-reconstructed membership.** The technique from the horse race: split the
  `.typ` on blank lines, normalize to alphanumerics, match each paragraph's opening against the
  PDF line stream in order, take the last line of each span. Matched 187 of 192 source blocks.
  Needs no justification assumption. Found **17**.
- **Method B — geometric paragraph boundaries.** A line is paragraph-final if the next line is a
  heading, is indented differently (block quote), or sits more than 1.4 × the modal leading
  below it. Modal leading measured at 14.4 pt over 958 lines. Also needs no justification
  assumption — it uses the vertical gap, not the right edge. Found **20**.

Method A's three misses are explained and are its fault, not B's: `follows:` (p13) and the two
before headings (p16, p23) fell into spans that merged because the following block was filtered
out of the source-paragraph list — three `#quote(block: true)` openings and every heading, which
normalize to under 25 characters. The direction of Method A's error is toward *missing* a runt,
exactly as the horse race predicted. **20 is the count.**

| # | Page | Paragraph opens | Stranded word | Width, as fraction of the 451 pt measure |
|---|---|---|---|---|
| 1 | 3 | "The defendants also point to the duration of the process…" | `discussed.` | 0.100 |
| 2 | 4 | "In its final form, the 2018 Grant is divided into 12 vesting…" | `milestones.` | 0.112 |
| 3 | 5 | "This analysis proceeds in four parts. The court first addresses…" | `entirety.` | 0.082 |
| 4 | 5 | "When determining whether corporate fiduciaries have breached…" | `fairness.` | 0.083 |
| 5 | 6 | "Delaware law imposes fiduciary duties on those who control…" | `obligations.` | 0.115 |
| 6 | 7 | "Here, Plaintiff advances theories of both general and transaction…" | `analysis.` | 0.086 |
| 7 | 8 | "This evidence, though not exhaustive, demonstrates the scope…" | `1960s.` | 0.060 |
| 8 | 10 | "When assessing independence, Delaware courts consider not only…" | `wanted[.]”` | 0.106 |
| 9 | 11 | "To sum it up, Musk unilaterally set the timeline or made last…" | `timing.` | 0.071 |
| 10 | 12 | "Delaware law recognizes that 'asking the controlling stockholder…'" | `Elon[.]”` | 0.077 |
| 11 | 12 | "Defendants claim Musk would have rejected such restrictions…" | `tries.”` | 0.055 |
| 12 | 12 | "More telling, Brown took the position that benchmarking was…" | `comparable.”` | 0.127 |
| 13 | 13 | "Gracias explained his understanding of 'fairness' in this context…" | `follows:` | 0.078 |
| 14 | 13 | "The testimony from the key witnesses is perhaps as close to…" | `process.` | 0.080 |
| 15 | 16 | "This decision already addressed most of the facts pertinent…" | `fair.` | 0.038 |
| 16 | 17 | "The next Weinberger factor examines how the transaction was…" | `process.` | 0.080 |
| 17 | 18 | "Worse, the committee seemed to actively advance Musk's interests…" | `Musk[.]` | 0.078 |
| 18 | 18 | "'In the fair price analysis, the court looks at the economic…'" | `community[.]”` | 0.146 |
| 19 | 19 | "As set out in the June 16 Compensation Committee meeting minutes…" | `Officer.”` | 0.078 |
| 20 | 23 | "…transactions where a vote is required. The same is true…" | `vote.` | 0.048 |

20 runts across 155 multi-line prose paragraphs: **12.9 %** of paragraphs end on a single word.
That is a real typographic complaint, not a rounding artifact, and it is why the instructor
noticed it by eye when the widow/orphan checker was reporting the document nearly clean.

### Rendered confirmation

Counts without pixels are claims. Four crops were rendered at 170 dpi from `default.pdf` and
read back. Transcriptions, verbatim:

**#1, page 3** (`/tmp/runts/crop-p3-discussed.png`):

```
Plus, most of the work on the compensation plan occurred during small segments of those nine
months and under significant time pressure imposed by Musk. Musk dictated the timing of the
process, making last-minute changes to the timeline or altering substantive terms immediately prior
to six out of the ten board or compensation committee meetings during which the plan was
discussed.

And that is just the process. The price was no better. In defense of the historically unprecedented
```

One word on the last line, extending roughly a tenth of the way across the column.

**#17, page 18** (`/tmp/runts/crop-p18-Musk.png`):

```
Worse, the committee seemed to actively advance Musk's interests—doing "what feels fair" for
Musk[.]

In the end, Musk dictated the Grant's terms, and the committee effected those wishes.
```

A two-line paragraph whose second line is one word.

**#15, page 16** (`/tmp/runts/miss-p16.png`) — one of the three Method A missed:

```
restates those findings while mapping them onto the Weinberger factors. They fare no better in their
repackaged form. Defendants have failed to demonstrate that the process leading to the Grant was
fair.
i. Initiation And Timing
```

One word, immediately above a bold subsection heading. The narrowest runt in the document at
0.038 of the measure, and the most visible on the page.

**#13, page 13** (`/tmp/runts/miss-p13.png`):

```
Gracias explained his understanding of "fairness" in this context and his approach to the process as
follows:

[W]hat is important is that [CEOs] feel like they're treated fairly. These plans are about
```

A one-word line introducing a block quote.

A caution carried over from the last round: the vision model misjudged *justification* on a
crop, so it is not trusted for that. Counting the words on a line it has transcribed is a
different and much safer task, and the transcriptions above match the pymupdf line text exactly.

---

## 2. The threshold, and how much it matters

**Chosen rule: exactly one word, on the last line of a paragraph of two or more lines.**

The classic alternative — "a last line shorter than the paragraph indent" — is **inapplicable to
this document, as a matter of measurement, not preference.** Paragraph first-line x0 histogram
over the 187 matched paragraphs: 186 at x0 = 71, one at 227 (a block quote). Body-line x0
histogram: 922 of 958 at x0 = 71. **The first-line indent is zero.** This addendum separates
paragraphs by vertical space, not by indentation, so a rule phrased against the indent has no
referent and would flag nothing. Any width-based rule here needs a fraction of the measure
invented from scratch, which is exactly the kind of tuned constant the last two rounds
distrusted.

Sensitivity, over the 155 multi-line prose paragraphs, default compile:

| By word count | Runts | | By width fraction of the 451 pt measure | Runts |
|---|---|---|---|---|
| ≤ 1 word | **20** | | frac < 0.05 | 2 |
| ≤ 2 words | 28 | | frac < 0.075 | 5 |
| ≤ 3 words | 38 | | frac < 0.10 | 15 |
| ≤ 4 words | 49 | | frac < 0.125 | 19 |
| ≤ 5 words | 61 | | frac < 0.15 | 27 |
| | | | frac < 0.20 | 36 |
| | | | frac < 0.25 | 38 |
| | | | frac < 0.33 | 58 |
| | | | frac < 0.50 | 81 |

**The word rule is the more stable of the two, and I am reporting the instability honestly
rather than picking the flattering axis.**

- Word count moves at roughly +9 findings per additional word, smoothly, with no cliff. The
  ≤1 boundary is a natural kind: a line holding one word is a categorically different object
  from a line holding two, and no constant has to be chosen.
- Width fraction has no defensible setting. It nearly doubles between 0.10 and 0.15 (15 → 27),
  a window narrower than the width of a single long word at 11 pt, and it does not even
  reproduce the word rule inside that window: the widest one-word runt is `community[.]”` at
  0.146 while the narrowest is `fair.` at 0.038, so **no single fraction separates one-word
  lines from two-word lines.** `frac < 0.125` returns 19 lines, but they are not a subset of
  the 20 — it drops `comparable.”` and `community[.]”` and adds two 2-word lines.

That is the answer to "a rule whose count swings wildly with the threshold is a weak rule": the
width rule is weak here and should not be shipped. The word rule is the one to use, and it
should be stated as one word, not "one word or a short fragment," because "short" is the part
that needs a constant.

One honest concession: the ≤2 boundary is defensible too (28 findings), and reasonable
typographers disagree about whether `Musk[.]` and `against Musk.` are the same defect. The rule
is a judgment call with a factor-of-1.4 range, not a fact. It is not a factor-of-4 range, which
is what the width rule offers.

---

## 3. The `costs` sweep: `runt` is a no-op on this document

Layout hash = md5 over every body line's `(page, top-y, right-x, text)`. Identical hash means
byte-identical layout. Runt count is Method B (geometric), applied identically to every variant.

### 3a. As the document is actually set (`justify: false`, the shipped default)

| Setting | Pages / lines | Layout hash | Runts (1 word) | ≤2 words |
|---|---|---|---|---|
| unset (default) | 23 / 958 | `cff85dc83154` | **20** | 28 |
| `runt: 0%` | 23 / 958 | `cff85dc83154` | 20 | 28 |
| `runt: 50%` | 23 / 958 | `cff85dc83154` | 20 | 28 |
| `runt: 100%` | 23 / 958 | `cff85dc83154` | 20 | 28 |
| `runt: 400%` | 23 / 958 | `cff85dc83154` | 20 | 28 |
| `runt: 1000%` | 23 / 958 | `cff85dc83154` | 20 | 28 |
| `runt: 400%, hyphenation: 0%` | 23 / 958 | `cff85dc83154` | 20 | 28 |
| `runt: 400%, hyphenation: 100%` | 23 / 958 | `cff85dc83154` | 20 | 28 |
| `runt: 0%, hyphenation: 0%` | 23 / 958 | `cff85dc83154` | 20 | 28 |
| `runt: 0%, hyphenation: 100%` | 23 / 958 | `cff85dc83154` | 20 | 28 |
| `hyphenation: 0%` alone | 23 / 958 | `cff85dc83154` | 20 | 28 |
| `hyphenation: 100%` alone | 23 / 958 | `cff85dc83154` | 20 | 28 |
| `runt: 400%` + `text(hyphenate: true)` | 23 / **946** | `583407d59f0a` | **13** | 26 |

**Twelve of the thirteen produce one byte-identical layout, including the default.** Every value
of `runt` from 0 % to 1000 %, alone or crossed with `hyphenation` at either extreme, changes
nothing. This is a stronger no-op than the widow/orphan round found: there, 0 % at least
degraded the document. Here even 0 % is inert.

The one variant that moves anything is `hyphenate: true`, and note what it proves — the change
comes from **hyphenation being switched on**, not from the runt cost, because `hyphenation: 0%`
and `100%` were both no-ops while `hyphenate` was off. With hyphenation available the document
loses 12 lines and 7 runts (20 → 13). That is a real 35 % reduction, obtained without touching
`costs` at all.

### 3b. Why: the costs only steer the optimized line breaker

The hypothesis was that `par.linebreak` defaults to a greedy first-fit breaker when
`justify: false`, and that line costs are only consulted by the optimized breaker. Attempting
to set it directly fails, verbatim:

```
error: unexpected argument: linebreak
  ┌─ .../02-addendum-tornetta.typ:1:9
  │
1 │ #set par(linebreak: "optimized")
  │          ^^^^^^^^^^^^^^^^^^^^^^
```

`par(linebreak:)` does not exist in 0.15, so **`justify: true` is the only available route to the
optimized breaker**, and the hypothesis can only be tested through it. Tested through it, it
holds.

### 3c. Under `#set par(justify: true)`, `costs.runt` works

| Setting | Pages / lines | Layout hash | Runts (1 word) | ≤2 words |
|---|---|---|---|---|
| `justify` + `runt: 0%` | 23 / 928 | `54a045267440` | **11** | 23 |
| `justify` + `runt: 25%` | 23 / 928 | `54a045267440` | 11 | 23 |
| `justify` + `runt: 50%` | 23 / 928 | `54a045267440` | 11 | 23 |
| `justify`, runt unset | 23 / 926 | `a6096293bb70` | **9** | 21 |
| `justify` + `runt: 100%` | 23 / 926 | `a6096293bb70` | 9 | 21 |
| `justify` + `runt: 200%` | 23 / 926 | `b541b2a1758f` | **8** | 21 |
| `justify` + `runt: 400%` | 23 / 926 | `b541b2a1758f` | 8 | 21 |
| `justify` + `runt: 1000%` | 23 / 926 | `b541b2a1758f` | 8 | 21 |
| `justify` + `runt: 2000%` | 23 / 926 | `b541b2a1758f` | 8 | 21 |
| `justify` + `runt: 5000%` | 23 / 926 | `b541b2a1758f` | 8 | 21 |
| `justify` + `runt: 400%, hyphenation: 0%` | 23 / 928 | `e583175bd7e2` | **7** | 20 |

This is the first setting in three rounds where a `costs` key measurably does its job. A clean
monotone step function that saturates:

- 0–50 % → 11 runts (three layouts hash identically, so 25 % and 50 % are indistinguishable
  from 0 %)
- 100 % → 9. The unset default hashes byte-identically to an explicit `100%`, confirming the
  documented default at a third independent probe.
- ≥ 200 % → 8, and 200/400/1000/2000/5000 % are all one layout. **Saturation is now
  established rather than assumed** — the earlier rounds could not tell saturation from an
  unexercised fixture; five values above the knee producing one hash settles it.

So `costs.runt` is real, tunable, and **weak**: the full span from 0 % to 5000 % is 11 → 8, a
swing of 3 runts out of 154 paragraphs, and raising it above the default buys exactly one. The
best result in the whole sweep, `justify` + `runt: 400%` + `hyphenation: 0%`, reaches 7 —
against 20 for the shipped default. **Nearly all of that 20 → 7 improvement comes from turning
on justification (and with it, hyphenation), not from the runt cost**: justify alone gets to 9,
and every remaining lever combined is worth 2 more.

**Verdict on prevention: `costs.runt` should not be written into an addendum preamble.** On the
document as it is actually set it is a documented no-op dressed as protection — the exact
failure mode the last round warned about, now measured for a third key. It becomes a live knob
only if the user first sets `justify: true`, and even then it is worth one runt above its
default.

---

## 4. Does `check-widows.py` already implement this? Yes — 19 of 20

Run unmodified against the prose PDF:

```
$ check-widows.py /tmp/runts/default.pdf
Found 25 potential widow/orphan(s) in default.pdf:
  page 3: "discussed."
    after: "to six out of the ten board or compensation committee meetings during "
  ...
EXIT=1
```

Its docstring's definition — "a single word or very short fragment that wraps to its own line at
the end of a bullet point, heading, or text block" — **is the runt definition**, and its logic is
`len(curr_words) <= 1` on a line whose predecessor is a long, same-column, one-leading-step-above
line. Nothing in that is bullet-specific. Scored against the 20:

| | Count |
|---|---|
| One-word findings | 19 |
| Of which are in the ground-truth 20 | **19** |
| False positives among one-word findings | **0** |
| Runts missed | **1** (`process.`, p17) |
| Additional "(short continuation)" findings (2 words) | 6 |

**Its precision on the one-word class is perfect on this document.** That is a sharp contrast
with `check-page-breaks.py`, which on the same file fired four times with three false positives.
The difference is structural: runt detection needs a *vertical* judgment (is the next line far
away?), and `check-widows.py` makes it with `y_gap`, whereas widow/orphan detection as
implemented needs a *horizontal* one (is this line flush right?), which ragged-right prose
cannot supply.

### The one miss, and it is a Touying assumption

Not a threshold problem. `detect_widows` dedups with `dedup_key = (slide_num, curr_text)` to
collapse Touying animation steps. On an addendum there is no `N / M` footer, so
`get_slide_number_fitz` returns `None` on **all 23 pages** (verified), and the key degenerates to
`(None, text)` — a **document-global** dedup on line text. `process.` occurs as a one-word line
twice, on pages 13 and 17; it is the only one-word line in the document that repeats. The p13
finding is emitted and the p17 finding is silently swallowed. Every other filter passes for p17:

```
p17 'process.' idx=19
  y_gap=14.39         (reject if >35 or <5)
  prev_width=434.8 ratio=0.730   (reject if <0.35)
  len(prev)=97        (reject if <20); words(prev)=15 (reject if <3)
  is_chrome(this)=False
```

This is the bullet/Touying assumption defeating it, and it is the one that matters: a legal
addendum will repeat short closing words (`process.`, `fair.`, `vote.`, `id.`) far more often
than a slide deck does, so the miss rate would grow with document length.

### The other assumptions, checked

- **`is_chrome` bottom-15 % cutoff** — set for slide footers. On A4 prose it discards everything
  below y = 715.6 of 841.9, roughly the last four body lines of every page. It cost nothing on
  this document (no runt fell there) but it is a silent blind spot on 23 pages of prose, and it
  is a coincidence, not a design.
- **`min_prev_width_ratio = 0.35`** — written to skip narrow table cells. Body lines here run
  0.73 of the page width, so it never fires. Harmless.
- **Multi-column backward search (`x_column_gap = 100`)** — inert; this document has one column.
- **`is_bullet_start`, `is_list_marker`, `is_paren_ref`** — inert on prose.
- **The 6 "short continuation" findings** are a mixed bag and would need their own threshold
  defense. One is a clear false positive for prose: `McCORMICK, C.` on page 2 is the **judge
  line**, not a paragraph tail. That class should stay off by default for prose.

So: the capability exists, it is misfiled under "widows," and it transfers to prose with **one
real bug** (the global dedup) and one latent blind spot (the footer cutoff). That is a much
better starting position than building a fourth defect class from scratch.

---

## 5. Recommendation

**Fold the runt check into the existing `check-widows.py` capability, invoked as a separate
check from the elide-case leg — not as a fourth defect class inside `check-page-breaks.py`, and
not left to `costs`.** Four sub-claims, each from a number above.

**1. Not `costs`.** Detection is not optional here, because prevention is unavailable. On the
document as shipped, every `runt` value from 0 % to 1000 % produces one byte-identical layout.
Even under `justify: true`, where the key does work, its full range is worth 3 runts and its
range *above the default* is worth 1. Writing `costs: (runt: 400%)` into an addendum preamble
would be the third no-op-that-looks-like-protection this project has now measured. Do not
write it.

**2. Not a fourth defect in `check-page-breaks.py`.** That script's premise — "detection rests on
justified body text" — is false for this document, and the leg is currently shipping a 3-of-4
false-positive rate because of it. Adding a defect class to a checker whose central geometric
assumption is broken would inherit the breakage and would also disguise the fix: the standing
suggestion is that `body_metrics()` should refuse to render widow/orphan verdicts below ~60 %
flush-right, and **a runt check must keep running when that refusal fires**, because runts are
precisely the defect that ragged-right prose has and justified prose largely does not. Bolting
them together makes one gate that has to be both on and off at once. Keep the leg's refusal
clean; give runts their own exit code.

**3. Reuse `check-widows.py`'s logic rather than writing a fourth detector.** It scored 19/20
with zero false positives on the one-word class against an independently constructed ground
truth. That is better than anything in this skill has scored on real prose. Rebuilding it under
a new name in `elide-case/scripts/` would duplicate a working algorithm and start its accuracy
back at zero — and the comment in `check-page-breaks.py` already anticipates the wrong version
of this ("shares nothing with page-boundary analysis"), which was true of *page-boundary*
analysis and is not true of runts.

**4. What has to change first, and it is small.** Two defects block reuse on prose, both
decidable and both cheap:
   - **The dedup key must include the page** (or drop when `slide_num is None`). One line. It is
     the only cause of the one miss, and its cost grows with document length.
   - **`is_chrome`'s 15 % footer cutoff must be parameterized** for prose, where it currently
     discards the bottom four body lines of every page.

   Both are edits to a shipped file, which this task forbids, so they are stated and not made.

**On naming, which is the part worth arguing.** The instructor asked about "single words at the
end of a paragraph" and the existing checker calls that a widow. It is a runt. Keeping both
under one word is what let this class go unmeasured for two rounds: the elide-case leg reported
Tornetta as having zero widows — correctly, under its own definition — while 20 paragraphs on
the same 23 pages ended on a single word and the instructor could see them. **Whatever ships,
the three names should be distinct in the output**, because they have different causes
(page breaking vs. line filling), different fixes (move the break vs. rewrite or rebreak the
line), and, on this document, disjoint findings.

**One thing to put to the user rather than decide here.** 20 runts is 12.9 % of paragraphs, and
`justify: true` alone cuts it to 9 while also making the widow/orphan leg's premise true for the
first time. The prior round already noted this file sets no `page`, `text` or `par` rules at all
and inherits A4 defaults. Setting it justified would fix more of this skill's problems at once
than any checker change. That is a decision about the user's live document, and it is theirs.

**Fix vocabulary is unchanged and must be restated:** a runt is fixed by layout — spacing, the
measure, hyphenation, or the line break — never by adding, cutting or rewording the court's
text. Runts are more tempting to fix by rewriting than widows are, because deleting one word
visibly fixes one, which is exactly why the verbatim gate matters more for this class, not less.

---

## What I could not determine

1. **Whether the 20 is right at the ≤2-word boundary.** 28 paragraphs end on two words or fewer.
   I rendered and eyeballed 4 of the 20 one-word runts and none of the 8 two-word lines, so I
   cannot say how many of the 8 a typographer would call defects. The ≤1 rule is defended as
   stable, not as uniquely correct.
2. **Whether all 20 are visually objectionable.** Four were confirmed by render. The other 16
   rest on pymupdf line geometry plus two agreeing detectors, which is strong evidence about
   *what is on the page* and no evidence at all about whether it looks bad.
3. **Whether `costs.runt` interacts with `widow`/`orphan`.** I swept `runt` alone and crossed it
   with `hyphenation` only, as the task specified. All four keys have never been varied together.
4. **Why `hyphenate: true` helps and `hyphenation: 0%` does not.** The measurement is clear
   (`hyphenate` changes the layout, the `hyphenation` cost never does) but I did not establish
   the mechanism beyond the `linebreak` error above, and I did not read the Typst source.
5. **Whether `justify: true` is what the user wants.** I compiled it and counted; I made no
   aesthetic judgment and did not render a justified page.
6. **Whether the two dead `check-widows.py` assumptions are the only ones.** I checked
   `is_chrome`, `min_prev_width_ratio`, `x_column_gap`, the dedup key, and the three regex
   skips against this one document. A second prose document could expose more.
7. **The 6 "short continuation" findings, beyond the one judge-line false positive.** I did not
   adjudicate the other five.
8. **Runt behavior across page boundaries.** Method B deliberately skips a line whose successor
   is on the next page, since paragraph-final cannot be decided there without membership. Method
   A covers those and found none, but the two methods do not cross-check on that subset, so a
   runt sitting as the last line of a page is a gap in both.
9. **Runtimes.** Not measured this round. The last round established both checkers are
   sub-second on this document and nothing here is a cost consideration.
