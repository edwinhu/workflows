# Tilde normalization in `check-quotes.py`

`~` is Typst markup that renders as U+00A0. The instructor's chosen fix for a runt is to weld
the last two words with one (`individual~participant.”`), which closes the runt by layout alone
and alters no character of the court's text. This note records the stripper change that makes
that markup legible to the quotation gate, and — more importantly — corrects the premise the
change was requested under.

## Headline correction: the ordering hazard did not materialize

The brief predicted that a tilde in the `.typ` would reach the sentence splitter as a literal
`~`, break verbatim matching, and flip `strays=FAIL` into `quotes=FAIL`. **Measured against the
real addendum, it does not.** `norm()` — the normalizer applied to *both* the `.typ` side and the
source side — already folds `~` and a literal U+00A0 into a space, because its last substantive
line is:

```python
s = re.sub(r"[^a-z0-9]+", " ", s.lower())
```

Every non-alphanumeric character, tilde and U+00A0 included, is already a space by the time any
comparison happens. Verified directly:

```
norm tilde  : 'foo bar'
norm nbsp   : 'foo bar'
```

Consequences, stated plainly:

- **No source-side rule was added.** The brief asked me to check whether the source-side
  normalizer already handles U+00A0 before adding anything. It does, in `norm()`, for both sides
  at once. Adding a second rule would have been the duplicate the brief forbade.
- **The tildes were safe to insert before this edit.** The instructor could have added them
  first and the gate would not have moved.

## The change

One line in `strip_typ_markup()`, with the rationale as a comment:

```python
# `~` is Typst markup for U+00A0, exactly as `---` is an em dash and `_x_` is italics:
# the reader sees a space, so the checker must compare a space. This is not a loosening —
# it strips no neighbouring character and matches no wildcard. (norm() also folds `~`
# and a literal U+00A0 into a space on BOTH sides, which is where the source-side
# guarantee lives; this rule makes the reader-visible space explicit at the markup layer,
# so a MISS diagnostic prints the sentence as it is set rather than with a raw tilde.)
body = body.replace("~", " ")
```

What it actually buys, since matching was never at risk: the markup layer now interprets `~` where
it interprets every other Typst construct, and a `MISS` report prints the sentence as the reader
sees it instead of with a raw tilde in the middle. It is a correctness-of-representation fix, not
a correctness-of-matching fix.

**Not a loosening.** `~` in Typst *is* a space, as `---` is an em dash. Normalizing it compares
what the reader sees against what the reporter printed, which is what the gate is for. Stripping
`~` together with its neighbouring characters, or treating a tilde as a wildcard, *would* be a
loosening; test (c) below forbids both.

## Tests

Three added to `check-quotes.test.ts`, labeled by what they actually are:

| Test | Fail-first? |
|---|---|
| (a) `.typ` tilde matches a source space | **No — regression guard.** Passes before and after; `norm()` already did this. |
| (b) source U+00A0 matches a `.typ` space | **No — regression guard.** Same reason. |
| (c) tilde absorbs no adjacent character, is no wildcard | **Yes, fail-first** at the `strip_typ_markup` assertion. |

I did not manufacture fail-first status for (a) and (b) by loosening an assertion. They pin
behavior that a future rewrite of `norm()` could silently remove.

### (c) failing before the change

With the one line removed:

```
260 |   test("REGRESSION GUARD: a tilde absorbs no adjacent character and is no wildcard", () => {
261 |     expect(stripTyp("foo~bar")).toBe("foo bar");
                                      ^
error: expect(received).toBe(expected)

Expected: "foo bar"
Received: "foo~bar"

      at .../check-quotes.test.ts:261:33
(fail) check-quotes.py > REGRESSION GUARD: a tilde absorbs no adjacent character and is no wildcard [22.67ms]

 2 pass
 68 filtered out
 1 fail
```

The "2 pass" are (a) and (b) — passing with the fix reverted, which is the evidence for the table
above.

### Full suite after the change

```
$ cd /home/eh/projects/workflows/skills/elide-case/scripts && bun test
bun test v1.4.0 (34cbb9a40)

 71 pass
 0 fail
 304 expect() calls
Ran 71 tests across 2 files. [41.58s]
```

## Reverted-vs-applied demonstration

A scratch copy of `02-addendum.typ` in `/tmp/tilde-demo` (nothing under `~/areas` was written),
carrying all three tildes at lines 130, 164 and 255. Checked against
`SEC-v-Ripple-682-FSupp3d-308-SDNY-2023.westlaw.txt` with `--skip-editorial`.

**Fix REVERTED:**

```
96 sentences checked, 0 not found
```

**Fix APPLIED:**

```
96 sentences checked, 0 not found
```

`diff reverted.txt applied.txt` → identical, byte for byte, including both "matched across a
source gap" advisories. Exit 0 both ways.

This is the honest result, and it is the opposite of what the brief expected. The reverted run
was supposed to show the misses; it shows none, because `norm()` was already doing the work. I
am reporting that rather than presenting the edit as load-bearing.

### The third site is excluded either way

Line 255 (`bracketed~ellipses.]`) sits inside `#emph[[Editors' note: ...]]`. `strip_typ_markup()`
drops that block wholesale via `EDITORS_NOTE`, **regardless of `--skip-editorial`** — confirmed by
calling the function both ways and testing for the word in the graded prose:

```
skip_editorial=True: 'bracketed' present in graded prose?  False
skip_editorial=False: 'bracketed' present in graded prose?  False
```

So that tilde never reached the quotation gate and never needed the fix. It is the editor's own
prose; only its *layout* is at issue.

## Per-site verdict: did the tildes close the runts?

Baseline and tilded copies compiled with `typst compile`, then `scripts/check-widows.py --prose`.

**Baseline — 3 runts:**

```
Found 3 potential runt(s) in base.pdf:

  page 4: "participant.”"
    after: "and offers made to investors; it is not a search for the precise motiv"

  page 7: "contracts."
    after: "concludes that Ripple’s Other Distributions did not constitute the off"

  page 10: "ellipses.]"
    after: "without further notice. Omissions within and between passages are indi"
```

**With the three tildes — 1 runt:**

```
Found 1 potential runt(s) in tilde.pdf:

  page 4: "ipant.”"
    after: "offers made to investors; it is not a search for the precise motivatio"
```

| Site | Tilde | Verdict |
|---|---|---|
| line 130, page 4 | `individual~participant.”` | **DID NOT CLOSE.** The runt is still on page 4. The non-breaking space stopped the break falling between the two words, so Typst hyphenated instead and the last line is now the fragment `ipant.”`. The word is shorter; the defect is the same defect. |
| line 164, page 7 | `investment~contracts.` | **CLOSED.** No runt reported on page 7. |
| line 255, page 10 | `bracketed~ellipses.]` | **CLOSED.** No runt reported on page 10. |

The page-4 site needs a different layout fix — suppressing hyphenation on that paragraph, or
adjusting the measure. A second tilde one word earlier is the obvious next thing to try, but I
have not measured it, so I am not recommending it as though I had.

## What I did not do

- Did not touch anything under `/home/eh/areas/secreg`. The real addendum is unmodified; the
  demonstration ran on a copy in `/tmp/tilde-demo`.
- Did not run the full `check.sh` (all five legs). I ran the two legs the brief named — the
  quotes leg via `check-quotes.py` directly, and the strays leg's runt sub-check via
  `check-widows.py --prose`. The plan, addendum and widow/orphan legs were not exercised.
- Did not add a source-side U+00A0 rule, because `norm()` already covers it. See above.
