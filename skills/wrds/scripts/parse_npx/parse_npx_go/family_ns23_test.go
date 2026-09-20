package main

import (
	"path/filepath"
	"testing"
)

// familyNS23Dispatch runs the real dispatch on a family NS23 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS23Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns23", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns23", fixture), sink, make([]byte, headBytes))
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

// 000108/1081402/0001081400-10-000103.txt: verbatim source lines 1-30 (the SEC
// header through the CIK), 50-55 and 60 (the series-data openers and the
// `S000007215` `<SERIES>` block, trimmed to its id/name lines and its closer),
// 97-100 and 105 (the `S000007222` `<SERIES>` block, same trim), 151-167 (the
// header closers and the document opener through `<body>`), 50893-50924 (the
// `Wells Fargo Advantage VT International Core Fund` banner and the ABB LTD.
// block that follows it) and the filing's own last four lines. Every byte is
// verbatim. Dispatches to `labelvalue` (the precondition asserts it).
//
// Wells Fargo Variable Trust, period 20100826, `labelvalue`. Measured on the
// current tree with the full 41,139-row dictionary:
//
//	=== 000108/1081402/0001081400-10-000103.txt layout=labelvalue status=ok rows=13057 blank=2212
//	    2212 blank      "Wells Fargo Advantage VT International Core Fund"
//	     982 S000007221 "Wells Fargo Advantage VT Equity Income Fund"
//
// The banner is attributed correctly -- every one of the 2,212 blank rows
// carries the string the bytes print -- and the sibling banners around it
// resolve. The gap is a NAMING one. Source lines 50893-50894, verbatim:
//
//	    <div ... align="left"><font ...>===============
//	Wells Fargo Advantage VT International Core Fund ===============</font></div>
//
// against source line 8857-8858, the sibling that resolves:
//
//	    <div ... align="left"><font ...>=================
//	Wells Fargo Advantage VT Equity Income Fund ==================</font></div>
//
// The two banners are byte-identical in shape; only the fund name differs. The
// filing's own SGML header declares eleven series, source lines 99-100
// verbatim:
//
//	<SERIES-ID>S000007222
//	<SERIES-NAME>VT International Equity Fund
//
// -- the 2010 name. The body prints the fund's EARLIER name, `VT International
// Core Fund`, which `cik_series.tsv` records for the SAME series id at the SAME
// CIK:
//
//	0001081402	S000007222	VT International Core Fund	20060630
//	0001081402	S000007222	VT International Equity Fund	20110630
//
// PROBED, not judged by eye. The filing index is built from the HEADER
// declarations, and against that index every rung refuses the heading:
//
//	icrResolveFundShared(headerIx, "Wells Fargo Advantage VT International Core Fund") -> ""
//	issDistinctivePairDecl / issDistinctiveTokenDecl / issDistinctiveStemDecl
//	issAbbrevStemDecl / issWidthTruncatedDecl / issNearMissDecl / crossCIK      -> nil
//
// Handed this CIK's own dictionary rows as declarations, the SAME chain answers
// it exactly, with no new rung and no guess:
//
//	icrResolveFundShared(dictIx, "Wells Fargo Advantage VT International Core Fund") -> "S000007222"
//	icrResolveFundShared(dictIx, "Wells Fargo Advantage VT Equity Income Fund")      -> "S000007221"
//
// so the brand-prefix handling that already resolves the sibling resolves this
// banner too once the historical alias is in the index.
//
// Fix location: `layout_issnpx.go`, `issFilingIndex` -- when a filing's header
// declares series, the index must also carry this CIK's dictionary names for
// THOSE SAME series ids (a registrant renames a sleeve; the body keeps printing
// the old name). No wrong series can be introduced, because every id folded in
// is already declared by the filing's own header.
func TestFamilyNS23WFVTInternationalCoreHistoricalAlias(t *testing.T) {
	rows := familyNS23Dispatch(t, "wfvt_international_core_alias.txt", "wfvt_dict.tsv", "labelvalue", 1)
	for _, r := range rows {
		if r.SeriesID != "S000007222" {
			t.Errorf("the banner prints the series' earlier declared name and every rung refuses it: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want S000007222",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
