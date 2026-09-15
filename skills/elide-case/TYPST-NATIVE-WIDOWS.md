# Can `.typ` itself lint for widows and orphans?

Measurements taken 2026-09-10 against `typst 0.15.0 (3ae52774)`. All fixtures, prototypes
and raw output live in `/tmp/typw/`. pymupdf extraction ran under
`/home/eh/areas/secreg/.pixi/envs/default/bin/python`. Nothing under
`/home/eh/areas/secreg` was written, and no file in this skill other than this one was
changed.

## Correction to the previous report, stated plainly

The earlier task's two claims split.

- **`par(costs:)` is rejected.** Reproduced verbatim:

  ```
  error: unexpected argument: costs
    ┌─ bad.typ:1:9
    │
  1 │ #set par(costs: (widow: 100%))
    │          ^^^^^^^^^^^^^^^^^^^^
  ```

- **"Typst 0.15 suppressed every attempt to provoke a widow from prose" was wrong.** It was
  right about the *default*, and wrong about the engine. The default suppresses widows;
  `#set text(costs: (widow: 0%, orphan: 0%))` compiles cleanly and **does** produce both
  defects, reproducibly. A compiled fixture therefore asserts a great deal. The prior sweep
  never varied the knob because it varied the wrong element, and concluded from "I could not
  provoke one" that the engine could not emit one. Those are different propositions.

`#set text(costs: (widow: N%, orphan: N%))` compiles at 0%, 50%, 100%, 400% and 1000%.

## Q1 — does Typst prevent this, and is it tunable?

**Fixture.** 5in × 3.2in page, 0.4in margins, 11pt New Computer Modern, `par(justify: true)`,
`#lorem(95)` followed by `#lorem(60)`, with a `#v(Npt)` spacer swept to walk the paragraph
across the page boundary in ~one-line steps. Line counts are pymupdf `get_text("dict")`
line bboxes; block boundaries are detected by a ragged (non-flush-right) line end.

Read `bXpY=n` as "block X put n lines on page Y".

| `#v()` | costs 0% | costs 100% (documented default) | costs 400% |
|---|---|---|---|
| 0–18 | `b1p1=11,b2p2=7` | `b1p1=11,b2p2=7` | `b1p1=11,b2p2=7` |
| **24** | **`b1p1=10,b1p2=1,b2p2=7`** ← widow | `b1p1=9,b1p2=2,b2p2=7` | `b1p1=9,b1p2=2,b2p2=7` |
| **30** | **`b1p1=10,b1p2=1,b2p2=7`** ← widow | `b1p1=9,b1p2=2,b2p2=7` | `b1p1=9,b1p2=2,b2p2=7` |
| 36–42 | `b1p1=9,b1p2=2,b2p2=7` | same | same |
| 48–60 | `b1p1=8,b1p2=3,b2p2=7` | same | same |
| 66–72 | `b1p1=7,b1p2=4,b2p2=7` | same | same |
| **78** | **`b1p1=6,b1p2=5,b2p2=6,b2p3=1`** ← widow | `b1p1=6,b1p2=5,b2p2=5,b2p3=2` | `…b2p3=2` |
| **84** | **`…b2p2=6,b2p3=1`** ← widow | `…b2p2=5,b2p3=2` | `…b2p3=2` |
| **90** | **`…b2p2=6,b2p3=1`** ← widow | `…b2p2=5,b2p3=2` | `…b2p3=2` |
| 96–102 | `b1p1=5,b1p2=6,b2p2=5,b2p3=2` | same | same |
| 108–120 | `b1p1=4,b1p2=7,b2p2=4,b2p3=3` | same | same |
| 126–132 | `b1p1=3,b1p2=8,b2p2=3,b2p3=4` | same | same |
| 138–150 | `b1p1=2,b1p2=9,b2p2=2,b2p3=5` | same | same |
| **156** | **`b1p1=1,b1p2=10,b2p2=1,b2p3=6`** ← two orphans | `b1p2=11,b2p3=7` | `b1p2=11,b2p3=7` |
| **162** | **`b1p1=1,b1p2=10,b2p2=1,b2p3=6`** ← two orphans | `b1p2=11,b2p3=7` | `b1p2=11,b2p3=7` |
| 168–234 | `b1p2=11,b2p3=7` | same | same |

Answers:

**(a) Yes — 0% produces defects the default suppresses.** At `v=24` and `v=30`, costs 0%
strands the paragraph's last line alone at the top of page 2 (`b1p2=1`); the default keeps
two lines together. At `v=78`–`90` the same happens to block 2 on page 3. At `v=156`–`162`,
costs 0% leaves a paragraph's *first* line alone at the foot of a page (`b1p1=1`, `b2p2=1`) —
a textbook orphan — while the default pushes the whole paragraph over. The engine can emit
both defects; the default is what stops it.

**(b) Yes — the default already prevents them in ordinary prose.** Across the full sweep,
costs 100% never produced a 1-line page fragment of a paragraph. The unset default is byte-
identical to an explicit 100% at three independently checked probe points (`v=24`, `78`,
`156`): line counts and every line's y-position matched exactly. Setting `costs: 100%` in a
preamble is therefore a **no-op** on this version.

**400% changes nothing over 100%** anywhere in the sweep. Higher values compile (1000% was
accepted) but bought no additional protection in this fixture. Whether the penalty scale
saturates or the fixture simply never presented a case where a larger cost would tip the
decision, I did not determine.

**Stranded headings are not covered by `costs`.** A 13pt bold heading swept across the page
boundary (`v` = 120, 132, 144, 150, 156, 162) produced no stranded heading at the default,
so the existing checker's third defect class went unexercised here. I could not construct a
case in which it fired, and therefore cannot say whether Typst prevents it or my fixture
simply never reached it.

### The external checker, validated against these fixtures

```
s-24-0:   FAIL page-breaks: 1 defect(s)   widow at the top of page 2: "assumenda est, omnis dolor."
s-24-100: PASS page-breaks: no widow, orphan or stranded heading
s-156-0:  FAIL page-breaks: 2 defect(s)   orphan at the foot of page 1: "Lorem ipsum dolor sit amet, …"
s-156-100: PASS page-breaks: no widow, orphan or stranded heading
```

`check-page-breaks.py` catches exactly the defects the sweep produced and stays clean on
exactly the ones it does not. It is not a vacuous checker. This is also the first real
positive fixture for it — the previous run's "everything is clean" was a pass over an input
class that had no defects in it.

## Q2 — can pure `.typ` detect a widow?

### Line boxes are not queryable. Verified, not assumed.

```
== query text        error: text is not locatable
== query block       error: block is not locatable
== query box         error: box is not locatable
== query linebreak   error: linebreak is not locatable
== query line        error: line is not locatable
== query par         []                       (locatable, but zero results)
```

There is no element whose position is a line's position. Any `.typ` lint must therefore
reconstruct line counts from markers plus arithmetic.

### Markers do NOT perturb layout — the one piece of good news

Matched pair, identical but for `#metadata(n)#label(…)` bracketing each paragraph:

```
pert-plain.pdf  pages 2 lines 18 hash 8b0df868294d
pert-marked.pdf pages 2 lines 18 hash 8b0df868294d
IDENTICAL LAYOUT: True
```

The hash covers every line's page, top-y, right-x and text. Zero-size metadata markers do
not move a single line break. The measurement instrument is non-perturbing.

### What defeats the arithmetic

Two independent failures, both measured.

**1. The end marker does not report the last line.** Bracketing `#lorem(95)` and `#lorem(60)`
with start and end markers and printing `location().position()`:

```
MARK p1 start=(pg1, 52.8pt)  end=(pg2, 64.18pt)
MARK p2 start=(pg2, 64.18pt) end=(pg2, 159.67pt)
```

Paragraph 1's `end` and paragraph 2's `start` are the *same point*, 64.18pt. The actual last
line of paragraph 1 sits at y = 42.11pt on page 2 (from the PDF: page 2 line tops are
`27.45, 42.11, 62.82, 77.49, 92.15, 106.81, 121.48, 136.14, 150.80`). A trailing marker is
carried into the following block's first line, so it measures where the *next* thing starts,
not where this paragraph ends. Only start markers report anything about the paragraph they
label — and a start marker alone cannot tell you how many lines followed it.

**2. Line pitch is not obtainable in `.typ`.** The real baseline pitch in this document is
14.66pt (from the y-list above). `par.leading + text.size` evaluates to 18.15pt — wrong by
24%. A calibration probe (two markers one `\` apart, off-flow via `#place`) returned
**7.51pt** — the bare leading, wrong by half. Neither route recovers the constant the
arithmetic needs, and the y-delta between consecutive start markers also absorbs an unknown
inter-block spacing term.

### The prototype, and its measured failure

`/tmp/typw/lint.typ` is a working end-to-end in-`.typ` lint: it calibrates a pitch, converts
a marker y-delta to a line count, and calls `panic()` on a suspected widow. The mechanism
works — `panic()` inside `context` does fail the compile with a nonzero exit and a legible
message. The verdict is what is wrong. Run across the Q1 fixtures:

```
v=24  costs=0%:   OK pitch=7.51pt tail-metric=2.757    ← MISSED (this is a real widow)
v=24  costs=100%: OK pitch=7.51pt tail-metric=4.709
v=78  costs=0%:   OK pitch=7.51pt tail-metric=10.564   ← MISSED (real widow)
v=78  costs=100%: OK pitch=7.51pt tail-metric=10.564
v=156 costs=0%:   OK pitch=7.51pt tail-metric=20.322   ← MISSED (two real orphans)
v=156 costs=100%: error: panicked with: WIDOW: paragraph 1 has ~0 line(s) on page 3
                                        ← FALSE POSITIVE (this file is clean)
```

Three false negatives and one false positive, on the four-case set the external checker got
right in all four. The one compile it failed was the clean document; every defective document
passed. That is worse than no check, because it fails loudly on good work and certifies bad.

Note also `v=78`: costs 0% and costs 100% produce *different* layouts (`b2p2=6,b2p3=1` vs
`b2p2=5,b2p3=2`) but an **identical** marker metric of 10.564. The markers this scheme can
place are blind to the distinction that defines the defect. That is not a threshold-tuning
problem; the signal is not in the data.

I did not attempt to rescue this by hardcoding a per-document pitch constant measured from a
prior PDF. It would work on this fixture, but the constant would come from the very post-hoc
extraction the approach is meant to replace, and it would break on any document with mixed
type sizes — which is what an addendum with captions, judge lines and block quotes is.

## Q3 — recommendation

**(c): keep the external checker, and *do not* add `text(costs:)` to the preamble.**

That is (c) with the prevention half deleted, because Q1 showed prevention is already on.
Concretely: change nothing.

Reasoning against each alternative.

**(d) is out, and this is the important finding.** The house rule prefers a computed
constraint to be a command's exit code, and prefers one mechanical entry point — so folding
widows into the compile leg would be the right shape *if the computation were sound*. It is
not. Q2 measured 3 misses and 1 false alarm out of 4. A gate that fails the clean file and
passes the broken one is not a stricter gate; it is a broken one, and the house rule's own
logic — a claim that can be computed should be computed — cuts against it, because this
particular claim **cannot** be computed from what `.typ` exposes. Line boxes are not
locatable, end markers report the next block, and pitch is not recoverable. Revisit only if
a future Typst version makes lines locatable.

**(b) is out.** It rests on "a defect the engine cannot produce needs no detector," and Q1
falsified the premise. The engine produces widows and orphans readily; the *default* is what
prevents them. A default is a setting, and settings get changed — by a template, by a
`#show` rule, by a future version's changed default, by an instructor who sets `costs` while
chasing something else. Deleting the detector would make the workflow depend on an unstated
invariant with nothing watching it. Worse, adding `costs: 100%` to the preamble as the
"prevention" would be a documented no-op that *looks* like protection: a line of code
readers would credit with doing work it measurably does not do. Do not write it.

**(a) versus (c).** These are the same recommendation here. The external checker already is
the small check that catches what prevention cannot, because prevention in this version is
the unset default and costs nothing. There is nothing to delete and nothing to add.

**On Addenda I and II both being clean.** That is now explained rather than merely observed:
they are clean because the default prevented the defect, not because the checker is
toothless. The two hypotheses were indistinguishable before this run and are distinguishable
now — `s-24-0.pdf` and `s-156-0.pdf` are compiled documents on which the leg fails. The leg's
cost is one pymupdf pass over a PDF that was already built; its value is that the invariant
it guards is a default rather than a law.

## What I could not determine

1. Whether `costs` above 100% ever changes output. 400% and 1000% compile; 400% was identical
   to 100% at every point in the sweep. Saturation versus an unexercised fixture: unresolved.
2. Whether the default is *literally* 100% or merely indistinguishable from it. Measured
   identical at `v` = 24, 78, 156; not proven for all inputs, and I did not read the source.
3. Whether Typst prevents stranded headings. No fixture I built produced one at the default,
   so the checker's third defect class remains unexercised by a positive case.
4. Whether the `costs` widow and orphan keys act independently. I varied them together
   throughout; the `v=24` case reads as a widow and `v=156` as an orphan, but I did not
   isolate either key.
5. Whether a `.typ` lint could work on documents of uniform single-size type with a
   hardcoded pitch. Plausible; not tested, and not relevant to addenda, which are not
   uniform.
6. Whether `context` converges in multiple layout passes for this construction. It compiled
   without a convergence warning in every run, but I did not probe the pass count or build a
   case designed to oscillate.
