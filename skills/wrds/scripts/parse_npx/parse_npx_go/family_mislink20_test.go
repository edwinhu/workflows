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

// familyMislink20OverlayDispatch runs the real dispatch on a family MISLINK20
// fixture under the real `-series-map` overlay, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture. relPath is passed
// separately from the fixture's path on disk because the overlay is keyed by the
// filing's corpus-relative path: handing processFile the real key lets the
// overlay fixture stay a verbatim cut of series_map_applied.tsv rather than a
// rewritten one. dict "" means no dictionary at all.
func familyMislink20OverlayDispatch(t *testing.T, relPath, fixture, overlay, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	if dict == "" {
		cikDict = nil
	} else {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink20", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	ov, err := loadSeriesOverlay(filepath.Join("testdata", "family_mislink20", overlay))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = ov
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(relPath, filepath.Join("testdata", "family_mislink20", fixture), sink, make([]byte, headBytes))
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

// familyMislink20BannerHolds asserts that no row of the section carries the
// wrong series, and that every row carries the series the banner's own words
// name. Both halves are asserted, because refusing the wrong id and never
// reaching the right one leaves the section blank, which is better but is not
// the answer the filing's own header supports.
func familyMislink20BannerHolds(t *testing.T, rows []VoteRow, wrongSeries, wantFund, wantSeries, wantDeclared string) {
	t.Helper()
	for i, r := range rows {
		if r.SeriesID == wrongSeries {
			t.Errorf("row %d (issuer=%q date=%q desc=%q): fund_name=%q series_id=%q -- %s is a DIFFERENT declared series of this registrant, whose own banner this filing prints nowhere near here; the section is headed %q, which names %s (%q)",
				i+1, r.IssuerName, r.MeetingDate, r.VoteDescription, r.FundName, r.SeriesID, wrongSeries, wantFund, wantSeries, wantDeclared)
		}
	}
	for i, r := range rows {
		if r.FundName != wantFund || r.SeriesID != wantSeries {
			t.Errorf("row %d (issuer=%q date=%q desc=%q): fund_name=%q series_id=%q want %q / %s (%q)",
				i+1, r.IssuerName, r.MeetingDate, r.VoteDescription, r.FundName, r.SeriesID, wantFund, wantSeries, wantDeclared)
		}
	}
}

// 000075/756913/0001438934-14-000466.txt (JOHN HANCOCK VARIABLE INSURANCE
// TRUST, CIK 756913, period 20140630, layout broadridge, 68 MB on
// /wrds/sec/archives): verbatim source lines 1-50 (the SEC header preamble),
// then the 82 `<SERIES>` blocks of source lines 51-1440 cut to
// `<SERIES>`/`<OWNER-CIK>`/`<SERIES-ID>`/`<SERIES-NAME>`/`</SERIES>` -- the
// class-contract detail dropped, the declared SET kept whole, because the
// resolver's collision and ambiguity rules read the set and a two-name header
// would change the answer rather than shorten the fixture -- then verbatim body
// source lines 36190-36235: the tail of the TRW AUTOMOTIVE HOLDINGS CORP.
// 13-May-2014 meeting, the banner at 36208, and the head of the 3I GROUP PLC,
// LONDON 18-Jul-2013 AGM through its first five proposals. The fixture's body
// opens inside the TRW proposal table, below that meeting's masthead, so the
// only rows the dispatch emits are the 3I GROUP rows the banner governs.
// `jhvit2014_series_map.tsv` is lines 1 and 782 of the corpus overlay
// `series_map_applied.tsv`, verbatim, and the test passes processFile the
// filing's real corpus-relative path so that the overlay's `filing` key matches
// as shipped.
//
// THE BYTES. Source line 36208, the banner, verbatim and the only occurrence in
// the filing (`grep -c` = 1):
//
//	2A32 Int'l Equity Index B
//
// It has this vendor's standard section-banner shape -- two blank lines, column-0
// text, then the block rule and the next masthead -- and sits between the close
// of the TRW meeting and the 3I GROUP AGM. `2A32` is a four-character internal
// fund code (header.go:508, internalFundCode), and the remainder abbreviates a
// name the filing's own header declares at source lines 574-575:
//
//	<SERIES-ID>S000008297
//	<SERIES-NAME>International Equity Index Trust B
//
// `International` shortened to `Int'l`, the tier word `Trust` dropped from the
// middle, the `B` sleeve letter kept. The neighbouring banners of the same run
// spell the brand out -- source line 35587 is `2A29 JHVIT Strategic Income
// Opportunities Trust` -- so this one is the abbreviated outlier.
//
// WHAT THE ROWS GET. Measured on the whole filing, real dispatch, corpus
// dictionary and `-series-map` as shipped: every row from the banner onward --
// 3I GROUP and many later meetings, 23,999 rows -- carries the banner text
// verbatim as fund_name and series_id S000029541, whose class contracts
// C000090646;C000090647;C000090648 the row then inherits. S000029541 is source
// lines 1288-1289:
//
//	<SERIES-ID>S000029541
//	<SERIES-NAME>International Growth Stock Trust
//
// a different fund of the same registrant, whose own banner the filing prints
// 700K lines further on, at source line 758694 (`2Y51 John Hancock Trust
// International Growth Stock Trust`, 1,124 rows). A wrong link key, not a
// missing one: 23,999 rows of the International Equity Index B sleeve are filed
// under the International Growth Stock sleeve.
//
// WHERE IT COMES FROM -- READ, NOT ASSUMED. It is not a rung of
// `brResolveHeading` (layout_broadridge.go:824). Dispatching this same fixture
// with the overlay withheld leaves series_id EMPTY on all five rows, so no
// registrant-scoped rung reaches S000029541, and none reaches S000008297 either:
// `normalizeSeriesName` (header.go:262) folds every non-alphanumeric rune to a
// token break, so the printed heading keys as `int l equity index b` against a
// declared `international equity index trust b` -- five tokens each, aligning
// nowhere -- and `lookupSeriesTolerantEntry` (header.go:488) drops the `2A32`
// code and then finds nothing. The id arrives from the audited Gemini overlay,
// `series_map_applied.tsv` line 782, verbatim:
//
//	000075/756913/0001438934-14-000466.txt	2A32 Int'l Equity Index B	S000029541	0.9	17632
//
// `seriesOverlay.apply` (series_overlay.go:65) stamps it because the row's
// series_id is blank, the heading matches as printed, and S000029541 is one the
// filing's own header declares -- every guard the overlay carries is satisfied
// by a map row that is simply wrong. The overlay itself contradicts it: the
// IDENTICAL heading string is mapped to S000008297 for this registrant's other
// filings (lines 772, 775 and 5803 -- the 2006, 2007 and 2008 reports), so one
// heading is read two ways by the same table.
//
// Recommended fix, both halves. (1) header.go, the abbreviation route
// `lookupSeriesTolerantEntry` reaches after the code strip: a printed token that
// is the declared token's leading letters plus an elision mark (`Int'l` for
// `International`) is this vendor's own abbreviation, and with the tier word
// `Trust` already in `brTypeTailWord` (layout_broadridge.go:846) the heading
// resolves to S000008297 from the filing's own header -- at which point
// `seriesOverlay.apply` never fires, since it only fills a BLANK series_id.
// (2) The overlay row is bad data and should be corrected to S000008297 to agree
// with its three siblings; a map that spells one heading two ways for one
// registrant is not audited truth.
//
// This test asserts the rows carry S000008297 and, separately, that none carries
// S000029541, so a repair that only refuses the wrong id is reported distinctly
// from one that also reaches the right one.
func TestFamilyMislink20JHVITIntlEquityIndexBTakesSiblingSeries(t *testing.T) {
	rows := familyMislink20OverlayDispatch(t,
		"000075/756913/0001438934-14-000466.txt",
		"jhvit2014_intl_equity_index_b_banner.txt",
		"jhvit2014_series_map.tsv", "", "broadridge", 5)
	familyMislink20BannerHolds(t, rows,
		"S000029541", "2A32 Int'l Equity Index B",
		"S000008297", "International Equity Index Trust B")
}
