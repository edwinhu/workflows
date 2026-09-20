package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// familyNS5BDispatch runs the real dispatch on a family NS5b fixture.
func familyNS5BDispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns5b", fixture), sink, make([]byte, headBytes))
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

// 000112/1126087/0001193125-12-373551.txt: 1-23, 38-43, 1056-1060, 1224-1237,
// 1316-1741, 91305-91553, 1418154-1418157. Met Investors Series Trust, 2012,
// layout `htmltable`, filer agent Donnelley (d394482dnpx.htm). 16,087 of the
// filing's 43,049 rows carry no series on the current binary, and 15,285 of
// them carry this fund_name:
//
//	"Institutional Account(s): US Mid-Cap - 3619770182, 3609770181, ..."
//
// plus 418 more on "Vote Summary Report". Every one of those rows belongs to a
// single portfolio: scanning the filing for the last bold heading before each
// `Institutional Account(s):` line returns 1,092 hits, all
// "AllianceBernstein Global Dynamic Allocation Portfolio, a series of Met
// Investors Series Trust", which the header declares verbatim at lines
// 1059-1060 as S000032435.
//
// The report prints the portfolio name in bold ONCE, on its first page
// (line 1320), above three report-preamble paragraphs:
//
//	<B>Vote Summary Report </B>
//	Report was run from: 7/1/11 to 6/30/12
//	Institutional Account(s): US Mid-Cap - 3619770182, 3609770181, ...
//
// Each of the 1,091 continuation pages opens with a page break and repeats the
// same preamble WITHOUT the portfolio name (lines 91305-91310 here, the page
// this fixture carries second):
//
//	<p Style='page-break-before:always'>
//	<HR  SIZE="3" style="COLOR:#999999" WIDTH="100%" ALIGN="CENTER">
//	 ... <B>Vote Summary Report </B> ... Report was run from: 7/1/11 to 6/30/12
//	... Institutional Account(s): US Mid-Cap - 3619770182, ...
//
// So the fund-heading adoption path does two wrong things at once: it adopts
// the `Institutional Account(s):` paragraph as a fund heading, and it drops the
// portfolio resolved on the page before instead of carrying it across a page
// break whose preamble names no portfolio. The first page of this fixture
// stamps S000032435 correctly, which is why the defect is the carry and not the
// resolver.
//
// Rows reached: 15,285 (+418) in this filing, 5,134 more across eight siblings.
//
// Fix in layout_htmltable.go, the fund-heading adoption path: refuse a
// candidate heading that is one of the report-preamble labels
// (`Institutional Account(s):`, `Vote Summary Report`, `Report was run from:`),
// and carry the last resolved fund across a page break whose preamble names no
// portfolio -- the same carry SKIP6b shipped for headerless continuation
// tables, one layout over.
func TestFamilyNS5bMetInvestorsPreambleIsNotAFundAndTheCarrySurvivesThePageBreak(t *testing.T) {
	const (
		wantSeries = "S000032435"
		wantFund   = "AllianceBernstein Global Dynamic Allocation Portfolio, a series of Met Investors Series Trust"
	)
	preambles := []string{"Institutional Account(s):", "Vote Summary Report", "Report was run from:"}
	rows := familyNS5BDispatch(t, "met_ab_two_pages.txt", "htmltable", 14)
	for _, r := range rows {
		for _, p := range preambles {
			if strings.Contains(r.FundName, p) {
				t.Errorf("report preamble adopted as the fund: fund=%q issuer=%q cusip=%q item=%q series=%q", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.SeriesID)
			}
		}
		if r.FundName != wantFund || r.SeriesID != wantSeries {
			t.Errorf("continuation page lost the fund of the page before: fund=%q series=%q issuer=%q cusip=%q item=%q want fund=%q series=%s", r.FundName, r.SeriesID, r.IssuerName, r.CUSIP, r.ItemSeq, wantFund, wantSeries)
		}
	}
}
