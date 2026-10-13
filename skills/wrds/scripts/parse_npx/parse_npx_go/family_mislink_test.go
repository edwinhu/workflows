package main

import (
	"path/filepath"
	"testing"
)

// familyMislinkDispatch runs the real dispatch on a family MISLINK fixture with
// the named dictionary rows loaded, and asserts the fixture's own preconditions
// -- status, layout and row count -- so a failure below is an assertion about
// the series id and never a broken fixture.
func familyMislinkDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink", fixture), sink, make([]byte, headBytes))
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

// 000089/895430/0000950153-05-003259.txt: verbatim source lines 11-26, 57-63,
// 3201-3213, 5207-5228 and the filing's own last four lines. Dispatches to
// `issnpx` (the precondition asserts it).
//
// ING Mutual Funds, 2005. This is a WRONG-SERIES defect, not a blank one: three
// ISSUER blocks are promoted to fund headings and carry away the votes of the
// fund whose section they sit in. Measured on the real filing with this CIK's 64
// dictionary rows loaded and seriesMap nil:
//
//	2399 fund="CANADIAN NATURAL RESOURCES LTD."  series=S000008522
//	 910 fund="ESSILOR INTERNATIONAL"            series=S000009809
//	 207 fund="TCL INTERNATIONAL"                series=S000009809
//	 598 fund="ING FOREIGN FUND"                 series=S000008524
//
// CANADIAN NATURAL RESOURCES sits inside the ING FOREIGN FUND section (banner
// at source line 3201), so its 2,399 rows belong to S000008524, which is
// separately stamped for only 598 rows in the same filing. ESSILOR (22643) and
// TCL (25483) sit inside the ING INTERNATIONAL SMALLCAP GROWTH FUND section
// (banner 21480, blank -- that name is tagged nowhere in the corpus), so their
// 910 + 207 = 1,117 rows should be BLANK and carry S000009809 instead.
//
// The bytes of the promoted line are an ordinary issuer block -- a ruled
// divider, the issuer, then the ballot's identity lines (source lines 5207-5212
// verbatim):
//
//   - ----------------------------------------------------------------------
//
//     CANADIAN NATURAL RESOURCES LTD.
//
//     Ticker:       CNQ.           Security ID:  136385101
//     Meeting Date: MAY 6, 2004    Meeting Type: Annual/Special
//
// A genuine fund banner in the same filing is a RULED banner and is followed by
// an issuer, never by an identity line (source line 3201 verbatim):
//
//	=========================== ING FOREIGN FUND ===========================
//
// parseISSNPX promotes a bare line to a heading when the dictionary answers to
// it (layout_issnpx.go:479-492, issPlainHeadingSeries). The registrant declares
// no <SERIES-ID>, so cikDict.exactFallback's fuzzy rungs are the whole
// vocabulary, and they answer an ISSUER name with a fund of the same CIK:
// `ING Global Natural Resources Fund` S000008522 for the first, `ING
// International Fund` S000009809 for the other two.
//
// Fix in layout_issnpx.go, parseISSNPX at :479-492: a bare line whose next
// non-blank lines open the ballot's identity block (`Ticker:` / `Security ID:` /
// `Meeting Date:`) is the issuer and can never be a fund heading, whatever the
// dictionary says about it; and/or only an EXACT declared or dictionary-exact
// hit may promote a bare line, never a fuzzy rung.
func TestFamilyMislinkINGIssuerBlockPromotedToFundHeading(t *testing.T) {
	rows := familyMislinkDispatch(t, "ing_issuer_block_promoted_to_fund_heading.txt", "ing_dict.tsv", "issnpx", 6)
	for _, r := range rows {
		if r.SeriesID != "S000008524" || r.FundName != "ING FOREIGN FUND" {
			t.Errorf("an issuer block was promoted to a fund heading: fund=%q series=%q issuer=%q cusip=%q item=%q desc=%.40q want fund=\"ING FOREIGN FUND\" series=S000008524", r.FundName, r.SeriesID, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription)
		}
		if r.SeriesID == "S000008522" || r.SeriesID == "S000009809" {
			t.Errorf("row carries a series the issuer name resolved to through a fuzzy dictionary rung: fund=%q series=%q issuer=%q item=%q", r.FundName, r.SeriesID, r.IssuerName, r.ItemSeq)
		}
	}
}
