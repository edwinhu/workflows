package main

import (
	"path/filepath"
	"testing"
)

// familyNS30Dispatch runs the real dispatch on a family NS30 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS30Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns30", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns30", fixture), sink, make([]byte, headBytes))
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

// 000083/836267/0001003715-05-000231.txt: verbatim source lines 11-55 (the SEC
// document opener through `</SEC-HEADER>`, including the registrant's conformed
// name and its two FORMER CONFORMED NAMEs), 56-88 (the document opener, the
// EDGARIZER html head and the cover through the registrant line and its
// address), 108-136 (the fiscal-year and reporting-period lines, `ITEM 1.
// PROXY VOTING RECORD` and the whole ACER INC. block under it) and the filing's
// own last twelve lines. Every byte is verbatim. Dispatches to `issnpx` (the
// precondition asserts it).
//
// Taiwan Greater China Fund, period 20050630, `issnpx`. A closed-end,
// single-fund registrant: the registrant IS the fund, so the report prints NO
// fund heading anywhere -- `ITEM 1. PROXY VOTING RECORD` is followed directly
// by the first issuer. The fund's name is printed once, on the cover, as the
// registrant (source line 86, verbatim):
//
//	<strong>TAIWAN GREATER CHINA FUND</strong>
//
// Measured on the current tree with the full 41,139-row dictionary, all 757
// rows of the whole filing carry `fund_name=""` and `series_id=""`. The
// chassis already owns this shape -- `processFile`'s registrantSeries block
// (main.go:365-386), "a single-fund registrant whose 2005 filing prints no fund
// heading at all" -- but that block is an EXACT dictionary-name lookup, and
// this registrant was renamed before it ever declared a series id.
//
// The rename is byte evidence, not a guess. The same CIK 836267 under the same
// SEC file number 811-05617 filed 000083/836267/0001003715-11-000434.txt for
// period 20110630, whose header reads:
//
//	COMPANY CONFORMED NAME:			SHELTON GREATER CHINA FUND
//	SEC FILE NUMBER:	811-05617
//	FORMER CONFORMED NAME:	TAIWAN GREATER CHINA FUND
//	FORMER CONFORMED NAME:	R O C TAIWAN FUND
//	<SERIES-ID>S000034279
//	<SERIES-NAME>SHELTON GREATER CHINA FUND
//
// so S000034279 is this very fund's id, declared under the name it carried six
// years later. PROBED, not judged by eye, against this filing's own index (15
// dictionary-backfilled decls, earliest vintage 20110630; the 2005 filing
// declares no `<SERIES>` blocks), with the header's former names loaded:
//
//	icrResolveFundShared(ix, "TAIWAN GREATER CHINA FUND") -> ""
//	icrResolveFundShared(ix, "GREATER CHINA FUND")        -> "S000034279"
//	icrResolveFundShared(ix, "SHELTON GREATER CHINA FUND")-> "S000034279"
//	icrResolveFundShared(ix, "R O C TAIWAN FUND")         -> ""
//	icrResolveFundShared(ix, "TAIWAN XYZZY FUND")         -> ""
//
// The transformation needed is the lead-brand-token swap the chain ALREADY
// accepts for headings -- measured in this same batch at CIK 912035, where the
// heading `MGIT International Select Equity Fund` reaches S000006060, declared
// as `DWS International Select Equity Fund`. The distinctive phrase `GREATER
// CHINA FUND` survives whole and only the brand token differs; the invented
// `TAIWAN XYZZY FUND` probe answers "" , so nothing is being read past the
// brand. `GREATER CHINA` names exactly one declaration at this CIK and the
// registrant has no sibling series of this vintage, so there is nothing to
// choose between.
//
// Fix location: `main.go`, `processFile`, the registrantSeries block at
// :365-386. It compares `normalizeSeriesName(h.CompanyName)` to each
// declaration name for equality; a registrant that renamed itself before its
// first declaration never matches. The registrant's own name must reach the
// same resolver the headings reach, under the same collision refusal (two
// series answering to it refuse).
func TestFamilyNS30TaiwanGreaterChinaRegistrantIsTheFund(t *testing.T) {
	rows := familyNS30Dispatch(t, "taiwan_greater_china_no_heading.txt", "taiwan_dict.tsv", "issnpx", 8)
	for _, r := range rows {
		if r.SeriesID != "S000034279" {
			t.Errorf("the registrant IS the fund and prints no fund heading; CIK 836267 declares this fund as `SHELTON GREATER CHINA FUND` (S000034279) after renaming itself from `TAIWAN GREATER CHINA FUND` under the same file number 811-05617: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want \"S000034279\"",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
