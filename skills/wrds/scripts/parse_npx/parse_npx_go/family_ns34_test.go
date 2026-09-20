package main

import (
	"path/filepath"
	"testing"
)

// familyNS34Dispatch runs the real dispatch on a family NS34 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS34Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns34", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns34", fixture), sink, make([]byte, headBytes))
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

// 000155/1552947/0001580642-21-003998.txt: verbatim source lines 1-16 (the SEC
// document opener through the registrant's conformed name, CIK and IRS number),
// 83-94 (`</SEC-HEADER>` through `<BODY>`), 139-143 (the cover page's agent-for-
// service block, which is where the current tree takes its fund name from),
// 177-237 (the section's own `Registrant:` banner table and the whole
// NOVOLIPETSK STEEL issuer block under it), 240-261 (the proposal table header
// and its first item row) and the filing's own last six lines. Every byte is
// verbatim. Dispatches to `proxyedge` (the precondition asserts it).
//
// The two header `<SERIES>` blocks (source lines 39-82) are cut out and the two
// declarations are supplied through `tworoads_dict.tsv` instead, so the fixture
// stays inside the line budget; the resolver sees the same two ids either way.
//
// Two Roads Shared Trust, CIK 1552947, period 20210630, `proxyedge`. The filing
// is one document holding TWO fund sections, each opened by its own banner.
// Source lines 181 and 31892, verbatim:
//
//	<U>TWO ROADS SHARED TRUST - Conductor Global Equity Fund</U> </FONT></TD>
//	<U>TWO ROADS SHARED TRUST - Conductor International Equity Value Fund</U> </FONT></TD>
//
// The current tree reads neither. It takes the cover page's agent-for-service
// line as the fund name for every row in the filing -- source line 141,
// verbatim:
//
//	<P STYLE="font: 12pt Times New Roman, Times, Serif; margin: 0; text-align: center">The Corporation Trust Company</P>
//
// Measured on the current tree with the full 41,139-row dictionary, the whole
// filing emits 1,685 rows, all 1,685 carrying fund_name "The Corporation Trust
// Company" and a blank series -- the pool's entire charge for this path. "The
// Corporation Trust Company" is CSC's Delaware registered agent, not a fund:
// the fund_name column is wrong as well as the series being blank.
//
// This is an ATTRIBUTION defect, not a naming floor. PROBED, not judged by eye,
// against this filing's own index (the two header declarations, S000043622
// `Conductor Global Equity Value Fund` and S000065356 `Conductor International
// Equity Value Fund`):
//
//	icrResolveFundShared(ix, "The Corporation Trust Company")                               -> ""
//	icrResolveFundShared(ix, "TWO ROADS SHARED TRUST - Conductor Global Equity Fund")       -> "S000043622"
//	icrResolveFundShared(ix, "Conductor Global Equity Fund")                                -> "S000043622"
//	icrResolveFundShared(ix, "TWO ROADS SHARED TRUST - Conductor International Equity Value Fund") -> "S000065356"
//	icrResolveFundShared(ix, "Conductor International Equity Value Fund")                   -> "S000065356"
//	icrResolveFundShared(ix, "Conductor XYZZY Fund")                                        -> ""
//
// So BOTH banners resolve once they are handed to the resolver at all -- the
// second exactly, the first by dropping `Value` against the declared
// `Conductor Global Equity Value Fund` -- and the invented `XYZZY` control
// answers "", so nothing is being read past the brand. No id is guessed: the
// only two ids in play are the two the header itself declares.
//
// Fix location: `layout_proxyedge.go`, the fund-name scan that seeds the
// section's fund before the vote tables are read. A `Registrant:` cell whose
// value is `<REGISTRANT NAME> - <FUND NAME>` opens a section and its right-hand
// side is the fund; a centred cover-page paragraph above `ITEM 1. PROXY VOTING
// RECORD:` is not a fund name and must not be taken as one.
func TestFamilyNS34TwoRoadsRegistrantBanner(t *testing.T) {
	rows := familyNS34Dispatch(t, "tworoads_registrant_banner.txt", "tworoads_dict.tsv", "proxyedge", 1)
	for _, r := range rows {
		if r.SeriesID != "S000043622" {
			t.Errorf("rows under the `Registrant: TWO ROADS SHARED TRUST - Conductor Global Equity Fund` banner are unresolved: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want %q",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID, "S000043622")
		}
	}
}
