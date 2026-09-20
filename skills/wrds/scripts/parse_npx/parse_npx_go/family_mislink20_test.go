package main

import (
	"path/filepath"
	"testing"
)

// familyMislink20Dispatch runs the real dispatch on a family MISLINK20 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyMislink20Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink20", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink20", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	return rows
}

// 000080/802716/0001683863-21-004726.txt: verbatim source lines 1-2, 4-7,
// 14-16, 43-44, then the six four-line `<SERIES>`/`<OWNER-CIK>`/`<SERIES-ID>`/
// `<SERIES-NAME>` runs at 625-628, 650-653, 675-678, 705-708, 735-738 and
// 860-863, then 884, 1198-1200, 56718-56750, one `</table>` to close the table
// the line-range cut opened, and the filing's own last five lines
// (100926-100930). The single `</table>` is the only byte sequence in the
// fixture that is not a cut of the source. Dispatches to `htmltable` (the
// precondition asserts it).
//
// SIX declarations, not two: the declared SET is the resolver's evidence, and
// the registrant-scoped rung that produces the wrong id needs it. Measured by
// greedy minimisation over the filing's own 43 declarations -- every proper
// subset of these six puts the correct S000053590 on the row, and all six put
// S000053572 on it. Shortening the header changes the answer rather than the
// fixture, so the five siblings (`Victory RS Partners Fund`, `Victory RS Value
// Fund`, `Victory RS Global Fund`, `Victory RS International Fund`, `Victory
// Sophus Emerging Markets Fund`) stay.
//
// VICTORY PORTFOLIOS, CIK 802716, period 20210630. The filing reports for its
// own 43 declared retail series AND for six VIP sleeves of its sibling
// registrant Victory Variable Insurance Funds, CIK 1068663 -- the sanctioned
// cross-CIK case family NS9 admitted and family NS17 measured. Five of those six
// sections resolve correctly through `cikSeries.crossCIK` (6,098 rows
// S000053591, 1,686 S000053587, 1,435 S000053586, 780 S000053584, 643
// S000053585). FOUR do not, and each takes an id of the FILER's own CIK whose
// name the bytes never print. Measured on the whole filing with the whole
// 41,139-row corpus dictionary loaded:
//
//	heading printed                                   stamped                             the exact sibling row
//	Victory High Yield VIP Series                     S000053572 Victory High Yield Fund   S000053590 (CIK 1068663)   23 rows
//	Victory INCORE Low Duration Bond VIP Series        S000053571 ...Low Duration Bond Fund S000053589 (CIK 1068663)    1 row
//	Victory INCORE Investment Quality Bond VIP Series  S000053569 ...Quality Bond Fund      S000053588 (CIK 1068663)    1 row
//	VVI Diversified Stock Fund                        S000000787 Victory Diversified Stock  S000000823 Victory Variable
//	                                                                                        Insurance Diversified
//	                                                                                        Stock Fund (CIK 1068663) 101 rows
//
// 126 rows of a sibling registrant's VIP sleeves filed under the filer's own
// retail funds -- a wrong link key, not a missing one.
//
// THE BYTES. Source line 56719, the banner, verbatim:
//
//	<br style='page-break-after:always;'><p align='center'>Victory High Yield VIP Series</p>
//
// and source lines 862-863, the filer's own header declaration the heading is
// matched against, verbatim:
//
//	<SERIES-ID>S000053572
//	<SERIES-NAME>Victory High Yield Fund
//
// The printed heading and the stamped declaration differ in their last two
// words: `VIP Series` against `Fund`. Those are the words that distinguish a
// registered VIP sleeve from the retail fund of the same strategy, and the
// corpus dictionary spells the sleeve exactly once, at the sibling:
//
//	0001068663	S000053590	Victory High Yield VIP Series	20170630
//
// WHY THE ORDERING IS THE DEFECT. `crossCIK` (cik_series.go:169) is consulted
// only after every registrant-scoped rung has refused -- at the tail of
// `issResolveFund` (layout_issnpx.go:2603) and of `icrResolveFundShared`
// (layout_icr.go:796), and last in `dictFallback.apply` (cik_series.go:500).
// That ordering is right when the own-CIK answer is EXACT: a same-CIK exact hit
// must beat a sibling's. It is wrong here, because the own-CIK answer is a
// TOLERANCE hit -- the heading is not a declared name, it is a declared name
// with two words traded away -- while the sibling's is the heading spelled
// character for character, corpus-unique and contemporaneous (20170630 precedes
// the 20210630 period). The rung that would have answered correctly is never
// reached, so the filing resolves the same naming convention two ways depending
// only on whether a tolerance rung happens to bite first. This is the mirror of
// family MISLINK7, where crossCIK wrongly beat the filer's own sleeve and the
// fix was the `ownBrandInfix` refusal; here the filer's own sleeve wrongly beats
// an exact sibling.
//
// Fix location: `layout_issnpx.go`, `issResolveFund` (`:2575`) -- the cross-CIK
// consultation at `:2603` must also run when the registrant-scoped chain
// answered INEXACTLY, and an EXACT, corpus-unique, contemporaneous sibling hit
// must outrank a same-CIK tolerance hit. The same precedence belongs at
// `icrResolveFundShared` (layout_icr.go:786) and at the tail of
// `dictFallback.apply` (cik_series.go:411). The exact/inexact distinction is
// already computable: `seriesByName` / `lookupSeriesEntry` is the exact route
// every tolerance rung runs after.
//
// This test asserts the row is NOT the filer's own retail id. A wrong series is
// worse than a blank one, so either blank or the exact sibling S000053590 --
// whose name the bytes print verbatim -- passes; only the retail id fails. It
// does not assert S000053590 alone, because refusing the tolerance hit without
// admitting the sibling is a legitimate repair too.
func TestFamilyMislink20VictoryVIPSleeveTakesFilerRetailSeries(t *testing.T) {
	rows := familyMislink20Dispatch(t, "victory_high_yield_vip_sibling.txt", "victory_vip_sibling_dict.tsv", "htmltable", 1)
	for _, r := range rows {
		if r.FundName != "Victory High Yield VIP Series" {
			t.Fatalf("fixture heading not read as printed: fund=%q", r.FundName)
		}
		if r.SeriesID != "" && r.SeriesID != "S000053590" {
			t.Errorf("a sibling registrant's VIP sleeve was stamped with the FILER's own retail series: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want \"\" or S000053590 (`Victory High Yield VIP Series`, CIK 1068663, declared 20170630); S000053572 is `Victory High Yield Fund` of the filer's own CIK 802716 and the bytes never print that name",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
