# Star-pagination stripper: accept a parallel double-asterisk series

`scripts/check-quotes.py`'s `STAR_PAGE` matched only a single-asterisk marker (`\*\d+`). A case
reported in two reporters carries two interleaved star series, and Westlaw marks the parallel one
with a double asterisk. Against `\*\d+` the leading asterisk of `**304` is not consumed, so
stripping leaves a stray `*` embedded mid-sentence and verbatim matching breaks for exactly the
two-reporter shape — the common one for federal appellate opinions with a parallel cite.

Evidence, `/home/eh/areas/secreg/docs/SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.westlaw.txt`
(read, not modified): 19 single-asterisk markers, 21 double. Context: `airman *538 **304 Brian P`.
Ripple and Mutual Benefits carry zero double markers, which is why nothing had failed yet.

## Diff

`skills/elide-case/` is untracked in the `teaching` repo, so `git diff` produces nothing. The
change, reproduced verbatim:

```diff
--- a/skills/elide-case/scripts/check-quotes.py
+++ b/skills/elide-case/scripts/check-quotes.py
@@
 # Westlaw star pagination, interleaved mid-sentence: "the vast *329 majority of". Anchored
-# to an asterisk IMMEDIATELY followed by digits and then a non-digit, so an emphasis or
-# footnote asterisk ("* * *", "see note *") keeps its meaning. One trailing space goes with
-# it, since the marker sits between two words that are contiguous in the reporter.
-STAR_PAGE = re.compile(r"\*\d+\b ?")
+# to one or two asterisks IMMEDIATELY followed by digits and then a non-digit, so an
+# emphasis or footnote asterisk ("* * *", "see note *") keeps its meaning. One trailing
+# space goes with it, since the marker sits between two words that are contiguous in the
+# reporter. A case reported in two reporters carries TWO interleaved series and Westlaw
+# marks the parallel one with a DOUBLE asterisk ("airman *538 **304 Brian"); matching only
+# a single asterisk strands a bare "*" mid-sentence and breaks verbatim matching.
+STAR_PAGE = re.compile(r"\*\*?\d+\b ?")
```

Ordering relative to `FOOTNOTE_MARKER` is unchanged: `STAR_PAGE` still runs first in
`strip_furniture`, so a short star page's digits are not eaten with its asterisk stranded. The
guards hold — `* * *`, `note *` and `*word*` carry no digits and are untouched, and the existing
tests asserting that still pass.

Two tests added to `scripts/check-quotes.test.ts`: a unit assertion on `strip_furniture` using the
real `airman *538 **304 Brian` shape, and an end-to-end run where a sentence split by both series
in the source must not be reported as a miss.

## Test output — BEFORE (fix reverted, test present)

```
bun test v1.4.0 (34cbb9a40)

check-quotes.test.ts:
139 |   // A case reported in two reporters carries TWO interleaved star series, and Westlaw
140 |   // marks the parallel one with a DOUBLE asterisk ("*538 **304"). A single-asterisk-only
141 |   // pattern leaves the extra "*" stranded mid-sentence, breaking verbatim matching for
142 |   // exactly the federal appellate opinions that carry a parallel cite.
143 |   test("the furniture stripper eats a parallel DOUBLE-asterisk star page", () => {
144 |     expect(stripFurniture("airman *538 **304 Brian P. Peden")).toBe(
                                                                     ^
error: expect(received).toBe(expected)

Expected: "airman Brian P. Peden"
Received: "airman *Brian P. Peden"

      at <anonymous> (/home/eh/projects/workflows/skills/elide-case/scripts/check-quotes.test.ts:144:64)
(fail) check-quotes.py > the furniture stripper eats a parallel DOUBLE-asterisk star page [15.52ms]

 8 pass
 1 fail
 32 expect() calls
Ran 9 tests across 1 file. [437.00ms]
```

The received value `airman *Brian P. Peden` is the stray asterisk itself.

## Test output — AFTER (fix applied)

```
bun test v1.4.0 (34cbb9a40)

 9 pass
 0 fail
 34 expect() calls
Ran 9 tests across 1 file. [475.00ms]
```

## Gate output (read-only, after the fix)

```
$ cd /home/eh/areas/secreg && bash /home/eh/projects/workflows/skills/elide-case/scripts/check.sh \
    --addendum addenda/02-addendum.typ --docs docs --plan .claude/plans/addendum-02.md

--- leg plan
LEG plan: PASS — both interview answers recorded in addendum-02.md; 1 non-court reading(s) declared
--- leg compile
LEG compile: PASS — 02-addendum.typ builds to 02-addendum.pdf
--- leg quotes
  reading 1/4 "SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA": PASS [declared] — verbatim against SEC-v-Ripple-682-FSupp3d-308-SDNY-2023.westlaw.txt
    matched across a source gap (likely a footnote block) — verify:
      in 'SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA': §§ 77e(a) and (c). The SEC also alleges that Garlinghouse and Larsen aided and abetted Ripple's Section 5 violations.
        source gap begins: am compl 9 430 35 ecf no 46 the sec also alleges ...
      in 'SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA': Tcherepnin v. Knight, 389 U.S. 332, 336 (1967); Glen-Arden Commodities, Inc. v. Constantino, 493 F.2d 1027, 1034 (2d Cir. 1974).
        source gap begins: 88 s ct 548 19 l ed 2d 564 1967 glen arden ...
      in 'SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA': In its opposition papers, the SEC pivots and argues instead that the Other Distributions were an indirect public offering because "the parties that received XRP from Ripple, such as an '[Xpring] recipient,' could 'transfer their XRP (in exchange for units of another currency, goods, or services) to another holder.'" In any event, the SEC does not develop the argument that these secondary market sales were offers or sales of investment contracts, particularly where the payment of money for these XRP sales never traced back to Ripple, and the Court cannot make such a finding.
        source gap begins: sec opp at 26 citation omitted but the sec does not elsewhere ...
  reading 2/4 "SECURITIES AND EXCHANGE COMMISSION v. LIFE PARTNERS, INC.": PASS [derived] — verbatim against SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.txt
  reading 3/4 "SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.": PASS [derived] — verbatim against SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.txt
    matched across a source gap (likely a footnote block) — verify:
      in 'SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.': If MBC underestimated the insureds' life expectancy, the chances increased that the investors would realize less of a profit, or no profit at all.
        source gap begins: as judge wald pointed out in her life partners dissent i f ...
  reading 4/4 "SEC v. Ripple: Everyone Loses": DECLARED-UNCHECKED [plan] — a CLS Blue Sky Blog post by the instructor, not a judicial opinion; there is no retrieved source text to verify it against.
LEG quotes: PASS — 3 of 4 reading(s) verified verbatim, 1 declared unchecked
--- leg addendum
  PASS arity: 4 table row(s) == 4 caption block(s)
  PASS table: all 4 stated page range(s) match the PDF
  
  Computed table rows (paste these):
    [7],
    [_SEC v. Ripple Labs, Inc._, 682 F. Supp. 3d 308 (S.D.N.Y. 2023) (insert at p. 157)],
    [pp. 2--9],
    [7],
    [_SEC v. Life Partners, Inc._, 87 F.3d 536 (D.C. Cir. 1996) (insert at p. 158)],
    [pp. 10--11],
    [7],
    [_SEC v. Mutual Benefits Corp._, 408 F.3d 737 (11th Cir. 2005) (insert at p. 158)],
    [pp. 12--15],
    [7],
    [Edwin Hu, _SEC v. Ripple: Everyone Loses_, CLS Blue Sky Blog (July 18, 2023)],
    [pp. 16--18],
LEG addendum: PASS — arity, table page ranges and length all hold
--- verdict
PASS: every leg passed
```

No leg changed verdict. The Life Partners reading stays PASS.

One thing worth naming: the gate resolves Life Partners to
`SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.txt`, not the `.westlaw.txt` that carries the double
markers. That leg therefore did not exercise the fix, and it was the unit and end-to-end tests, not
the gate, that demonstrated the bug and its repair. The gate run here shows only that the change
regressed nothing.

## Upstream documentation

`/home/eh/projects/workflows/skills/westlaw/SKILL.md` **already documents the correct pattern**, at
line 168:

> Strip with `\*\*?\d+`; a `\*\d+` pattern matches inside `**304` and leaves a stray asterisk, and
> counts the two series as one (which is why the extractor reports 42, not 21 + 21).

It even uses the same `*538 **304 Brian Pardo` line as its example. Nothing changed there; the
workflows repo was read only. This fix brings the consumer into line with a rule the producer had
already written down.

## Files touched

- `skills/elide-case/scripts/check-quotes.py` — the `STAR_PAGE` pattern and its comment.
- `skills/elide-case/scripts/check-quotes.test.ts` — two tests added.
- `skills/elide-case/STAR-FIX.md` — this file.

Nothing else in the repo, and nothing in `~/areas/secreg` or `~/projects/workflows`.
