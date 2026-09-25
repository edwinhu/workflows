# NS-TDAX-crossCIK-fragment — crossCIK matched on prose, not a banner

Verdict: **the evidence holds.** The defect reproduces on the real bytes, the fixture reproduces
it end to end through `processFile`, and the failing test is
`family_ns_tdax_crosscik_fragment_test.go`. This file records the measurement so the numbers in
the test's docstring can be re-derived rather than trusted.

## What was run

The parser was built from this worktree's HEAD to a scratch path (`go build -o /tmp/.../parse_probe .`
— the tracked binary was never rewritten) and run against the real filing and the real corpus
dictionary, both copied byte-for-byte off WRDS:

- filing: `/wrds/sec/archives/000138/1385533/0000891092-09-003339.txt` (22,810,377 bytes, 1,354,164 lines)
- dictionary: `/scratch/nyu/eddyhu/npx-reconcile-corpus/cik_series.tsv` (2026-09-22)
- overlay: `/scratch/nyu/eddyhu/npx-reconcile-corpus/series_map_applied.tsv` (2026-09-22)

## The filing

```
accession 0000891092-09-003339   cik 0001385533   period 20090630   filed 20090825
registrant TDX Independence Funds, Inc.   layout htmltable   status ok   rows 8242
```

Header-declared series (source lines 53-97), all five:

```
S000016521 TDX Independence 2010 Exchange-Traded Fund
S000016522 TDX Independence 2020 Exchange-Traded Fund
S000016523 TDX Independence 2030 Exchange-Traded Fund
S000016524 TDX Independence 2040 Exchange-Traded Fund
S000016525 TDX Independence In-Target Exchange-Traded Fund
```

## Measured output — the whole filing

Without `-series-map`:

```
   3625  S000008807  fund_name "global"
   3381  S000008807  fund_name "the global"
   1236  (blank)     fund_name ""
```

With `-series-map series_map_applied.tsv`: byte-identical. The overlay changes nothing here.

7,006 of 8,242 rows (85.0%) carry S000008807, which belongs to **CIK 0000088525** (Guggenheim).
**Zero** rows carry any of the filer's own five declared series.

## Where the text comes from

`grep -n -i global` on the filing returns 39 hits, all of them ordinary prose inside ISS vote
rationales. The two that resolve are word-wrapped sentence fragments. Source lines 754291-754319
are one such table row — every sibling cell is `&nbsp;`, and the one filled cell holds the
sentence `... the context of the global economic downturn.` split one fragment per inline element:

```html
  <tr valign="bottom">
    <td align=left>&nbsp;
        </td>
    <td align=left>&nbsp;
        </td>
    <td align=left colspan="10">
 &nbsp; &nbsp; &nbsp;<i><font size=2>the</font></i>

<i><font size=2>context of</font></i>

<i><font size=2>the</font></i>

<i><font size=2>global</font></i>

<i><font size=2>economic</font></i>
        </td>
```

The real banners look nothing like it — source line 215, inside a `colspan=3` cell, bolded:

```html
<B><FONT size=2>TDAX Independence 2010 ETF Composite</FONT></B>
```

## The route, probed rather than eyeballed

A throwaway instrumented copy of the package (outside the tree; no production file was edited)
printed every `curFund` assignment and every `htmlBareFundLine` return whose name contained
`global`. Only one call site fires — `layout_htmltable.go:437`, the one-filled-cell heading path —
and `htmlBareFundLine` has already resolved the id by the time it returns:

```
DBG bareFund pre="\n…\nthe\n\ncontext of\n\nthe\n\nglobal\n\neconomic\n\n\n"  -> name="global"     id="S000008807" ok=true
DBG bareFund pre="\n…\nthe\n\ncontext of\n\nthe global\n\neconomic\n\n\n"     -> name="the global" id="S000008807" ok=true
DBG dictFund cand="the four other global oil majors, is an area of"           -> ""
DBG dictFund cand="substantial global consensus among institutional"          -> ""
DBG dictFund cand="fundamentalism\" for the current global economic"          -> ""
```

`htmlDictionaryFund` (the registrant-scoped route) refuses everything, as it should. The id comes
from `issResolveFund` → `issResolveFundUncached`'s sibling-registrant rung at
**`layout_issnpx.go:2849-2853`**, which calls `cikSeries.crossCIK(ix.cik, banner, ix.period,
ix.registrantKey)` on the banner as printed. `normalizeSeriesName` folds both `global` and
`the global` to `global`.

## Why every shipped guard passes

Dictionary rows for the matched key:

```
0000088525  S000008807  GLOBAL                             20060630
0000088525  S000008807  Global                             20100630
0000088525  S000008807  MSCI EAFE Equal Weight             20110630
0000088525  S000008807  Guggenheim MSCI EAFE Equal Weight Fund  20130630
0000088525  S000008807  Guggenheim World Equity Income Fund     20140630
```

| guard | result | why |
|---|---|---|
| future vintage (`decl.DeclDate > period`) | passes | 20060630 ≤ 20090630 |
| `abandonedByPeriod` | passes | next differently-named redeclaration is 20110630, **after** the 20090630 period |
| corpus uniqueness (`byNameAll`) | passes | only CIK 88525 spells `global` anywhere in the dictionary |
| `ownBrandInfix` | passes | no declaration of CIK 1385533 spells `global` at any vintage |

This is the crucial contrast with the already-shipped Syntax ETF fix. That case was a 2023 filing
whose matched name had been renamed in 2010 and 2013 — *before* the period — so
`abandonedByPeriod` refuses it. Here the period is 20090630 and the name was genuinely live, so
the abandonment guard is silent and correct to be silent. The defect is upstream of every guard:
the input was never a banner.

## Blast radius

Same filer, all nine of its N-PX filings parsed together (with the overlay applied):

```
101,652 rows total
 14,012 rows S000008807 off a prose fragment  (13.8%)
   7,006  0000891092-09-003339  period 20090630
   7,006  0000891092-10-000935  period 20090630   (duplicate report of the same period)
```

The other seven filings resolve correctly to S000016521..S000016525 — the defect is confined to
the vintage that word-wraps rationale prose this way.

Reachable vocabulary, computed over the whole corpus dictionary (corpus-unique = one series of one
registrant answering the normalised key):

- **18** single-token names: `balanced common equity fedfund genomicsfund global institutional
  municash munifund s000002337 s000004928 s000004929 s000010077 s000010078 s000010079 shelby
  tempcash tempfund`
- **370** one-or-two-token names

So `balanced`, `equity` and `common` are each one wrapped sentence away from the same stamp. A
corpus-wide row count needs a full parse and is **not** claimed here; 14,012 is a floor measured
on one registrant.

## Fixture

`tdax_prose_fragment_global.txt` — 1,471 lines, verbatim source lines 1-1215, 754291-754319,
1216-1437, 2148 and 1354161-1354164. The only edit is the splice, which brings the filing's own
prose row up beside the filing's own first meeting so one small fixture carries a section read
before the fragment and a section read after it. Dispatch reproduces the defect exactly:

```
layout htmltable   status ok   rows 3
  (blank)     ""        Greenlight Capital Re, Ltd.  RATIFY AUDITORS
  (blank)     ""        Greenlight Capital Re, Ltd.  RATIFY AUDITORS
  S000008807  "global"  BT Group plc                 Approve Remuneration Report
```

`tdax_crosscik_dict.tsv` — the 20 real dictionary rows of CIK 1385533 and the 8 real rows of
CIK 0000088525's S000008805/S000008807, copied verbatim from `cik_series.tsv`.

## Why the test asserts blank on both sides

`TDAX Independence 2010 ETF Composite` names no declared series of this filer at any vintage — the
header spells `TDX`, not `TDAX`, and `Exchange-Traded Fund`, not `ETF Composite`. Nothing in the
chain can reach S000016521 from it, so asserting the filer's own id would be asserting a
production change rather than a defect. A wrong link key is worse than a missing one. The contrast
is carried by the fund NAME instead: the section before the fragment keeps the blank it honestly
has, and the section after it must not have been renamed to a fragment of English prose.
