# `// elide-...` directive lines were being graded as court text

## The bug

`// elide-source: <basename>` and `// elide-unchecked: ...` are machine directives that
`check.sh` parses out of the `.typ`. `check-quotes.py`'s Typst-markup stripper did not
remove them, so each directive line reached the sentence splitter and was graded as if it
were quoted court text — an unconditional MISS, because no directive line appears in any
reporter.

A second, compounding effect: a directive placed on the line before reading N's caption
sits textually inside reading N-1's body block, so the fabricated MISS was reported
against the *wrong* reading. Only the first reading in a file escaped, having no
predecessor.

Observed on `/home/eh/areas/secreg/addenda/02-addendum.typ` (read-only; not edited):

```
  MISS in 'SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA':
    typ: // elide-source: SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.westlaw.txt
    no prefix of this sentence appears in the source

  MISS in 'SECURITIES AND EXCHANGE COMMISSION v. LIFE PARTNERS, INC.':
    typ: // elide-source: SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.westlaw.txt
    no prefix of this sentence appears in the source
```

## The change

`scripts/check-quotes.py` only. `check.sh` is untouched.

A new module-level pattern, applied as the first step of `strip_typ_markup()`:

```python
ELIDE_DIRECTIVE_LINE = re.compile(r"^[ \t]*//[ \t]*elide-.*$", re.MULTILINE)
```

```python
def strip_typ_markup(body: str, skip_editorial: bool = False) -> str:
    if skip_editorial:
        body = drop_editorial_blocks(body)
    body = ELIDE_DIRECTIVE_LINE.sub("", body)
    ...
```

Scoped to the `elide-` namespace deliberately. Stripping every `//` line would eat a `//`
that appears inside quoted court text — a URL in a citation, for instance — silently
dropping real reporter prose, which is precisely the failure this gate exists to catch.

## Tests

Two added to `scripts/check-quotes.test.ts`:

1. **`elide- directive lines are not graded as court text`** — an excerpt carrying the two
   real directive lines above around one genuine sentence. Fails before the change,
   passes after.
2. **`a sentence carrying an inline https:// URL survives the directive stripper`** — the
   narrowness assertion. A sentence containing `https://example.com/whitepaper` must match
   the source intact.

### Before (fix reverted)

```
--- BEFORE (fix reverted) ---
bun test v1.4.0 (34cbb9a40)

check-quotes.test.ts:
181 |     const { code, out } = run(
182 |       "elide-directive",
183 |       reading("SEC v. RIPPLE LABS, INC.", excerpt),
184 |       `${sentence}\n`,
185 |     );
186 |     expect(out).not.toContain("MISS");
                          ^
error: expect(received).not.toContain(expected)

Expected to not contain: "MISS"
Received: "MISS in 'SEC v. RIPPLE LABS, INC.':\n  typ: // elide-source: SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.westlaw.txt\nThe economic reality of the transaction controls, and the label the parties attach to it does not.\n  no prefix of this sentence appears in the source\n\nMISS in 'SEC v. RIPPLE LABS, INC.':\n  typ: // elide-unchecked: reading 4 is declared unchecked in the plan\n  no prefix of this sentence appears in the source\n\n2 sentences checked, 2 not found\nNOTE: a bracketed [ ] span is tried both ways — dropped (an editorial insertion) and kept without its brackets (a case change, `[T]he`); a sentence matching under either reading is counted as found.\n"

      at <anonymous> (/home/eh/projects/workflows/skills/elide-case/scripts/check-quotes.test.ts:186:21)
(fail) check-quotes.py > elide- directive lines are not graded as court text [29.69ms]

 10 pass
 1 fail
 38 expect() calls
Ran 11 tests across 1 file. [524.00ms]
```

Note that the failure output reproduces both halves of the bug: the directive line is
graded as prose, and it is welded onto the following real sentence, so the genuine
sentence is dragged into the same MISS.

### After (fix restored)

```
--- AFTER (fix restored) ---
bun test v1.4.0 (34cbb9a40)

 11 pass
 0 fail
 42 expect() calls
Ran 11 tests across 1 file. [523.00ms]
```

## Gate output

Run read-only from `/home/eh/areas/secreg`:

```
$ bash /home/eh/projects/workflows/skills/elide-case/scripts/check.sh \
    --addendum addenda/02-addendum.typ --docs docs --plan .claude/plans/addendum-02.md
--- leg plan
LEG plan: PASS — both interview answers recorded in addendum-02.md; 1 non-court reading(s) declared
--- leg compile
LEG compile: PASS — 02-addendum.typ builds to 02-addendum.pdf
--- leg quotes
  reading 1/4 "SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA": PASS [declared] — verbatim against SEC-v-Ripple-682-FSupp3d-308-SDNY-2023.westlaw.txt
    matched across a source gap (likely a footnote block) — verify:
      in 'SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA': §§ 77e(a) and (c). The SEC also alleges that Garlinghouse and Larsen aided and abetted Ripple’s Section 5 violations.
        source gap begins: am compl 9 430 35 ecf no 46 the sec also alleges ...
      in 'SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA': Tcherepnin v. Knight, 389 U.S. 332, 336 (1967); Glen-Arden Commodities, Inc. v. Constantino, 493 F.2d 1027, 1034 (2d Cir. 1974).
        source gap begins: 88 s ct 548 19 l ed 2d 564 1967 glen arden ...
      in 'SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA': In its opposition papers, the SEC pivots and argues instead that the Other Distributions were an indirect public offering because “the parties that received XRP from Ripple, such as an ‘[Xpring] recipient,’ could ‘transfer their XRP (in exchange for units of another currency, goods, or services) to another holder.’” In any event, the SEC does not develop the argument that these secondary market sales were offers or sales of investment contracts, particularly where the payment of money for these XRP sales never traced back to Ripple, and the Court cannot make such a finding.
        source gap begins: sec opp at 26 citation omitted but the sec does not elsewhere ...
  reading 2/4 "SECURITIES AND EXCHANGE COMMISSION v. LIFE PARTNERS, INC.": PASS [declared] — verbatim against SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.westlaw.txt
  reading 3/4 "SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.": PASS [declared] — verbatim against SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.westlaw.txt
    matched across a source gap (likely a footnote block) — verify:
      in 'SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.': Howey, 328 U.S. at 299, 66 S. Ct. at 1103; see also Tcherepnin v. Knight, 389 U.S. 332, 336, 88 S. Ct. 548, 553 (1967) (“[I]n searching for the meaning and scope of the word ‘security’ in the Act[s], form should be disregarded for substance and the emphasis should be on economic reality.”).
        source gap begins: 19 l ed 2d 564 1967 i n searching for the meaning ...
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

All three court readings pass verbatim against their `.westlaw.txt` sources, reading 4
remains DECLARED-UNCHECKED, and no MISS remains. The gapped-match lines are the
pre-existing footnote-block advisory; they print but do not fail the run, and they are
unrelated to this change.

## Not done

`scripts/check.sh` was not modified. `/home/eh/areas/secreg/addenda/02-addendum.typ` was
read only, never edited.
