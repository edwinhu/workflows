package main

import (
	"path/filepath"
	"testing"
)

// familyNS26Dispatch runs the real dispatch on a family NS26 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS26Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns26", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns26", fixture), sink, make([]byte, headBytes))
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

// 000080/809593/0000809593-05-000020.txt: verbatim source lines 11-29 (the SEC
// document opener through the registrant's FISCAL YEAR END), 59-65 (the header
// closer and the document opener through `<TEXT>`), 96-98 (`ITEM 1. PROXY
// VOTING RECORD.` with its surrounding blanks) and 2286-2315 (the EMERGING
// MARKETS ruled banner and the whole ABB LTD. block under it), then the
// filing's own last five lines. Every byte is verbatim.
// Dispatches to `issnpx` (the precondition asserts it).
//
// American Beacon Funds, period 20050630, `issnpx`. Measured on the current
// tree with the full 41,139-row dictionary:
//
//	=== 000080/809593/0000809593-05-000020.txt layout=issnpx status=ok rows=1867 blank=1867
//	    1867 blank      ""
//
// Every row of the filing is blank AND carries no fund name at all -- the fund
// heading is never read. The filing names 18 funds, each in a three-line ruled
// sandwich: a bare 79-column rule, the fund on its own unruled line, a second
// bare rule. Source lines 99-101 and 2286-2288 verbatim:
//
//	===============================================================================
//	                      AMERICAN BEACON BALANCED FUND
//	===============================================================================
//
//	===============================================================================
//	                  AMERICAN BEACON EMERGING MARKETS FUND
//	===============================================================================
//
// The filing is mixed-vendor: only the EMERGING MARKETS section prints the ISS
// `#  Proposal  Mgt Rec  Vote Cast  Sponsor` grammar (source lines 2298-9940),
// and it is the only section `parseISSNPX` reads rows out of -- which is why
// all 1,867 rows belong to that one banner, S000001826.
//
// `issFundSeparator` reads each bare rule as a boundary WITH NO NAME, and every
// reader that could pick the name up wants the name on a ruled line:
// `issBannerWithTail` needs text after a closing '=', `issOpenBanner` needs the
// name after the OPENING '=' run, and the bare-paragraph branch needs the line
// after the name to be blank -- here it is the closing rule. So the name line
// is read as prose and the fund is lost.
//
// PROBED, not judged by eye, against this filing's own index (76
// dictionary-backfilled decls; the 2005 filing declares no `<SERIES>` blocks).
// ALL EIGHTEEN banners resolve exactly, so nothing is guessed by fixing the
// attribution -- the names were already answerable and were simply never handed
// over:
//
//	icrResolveFundShared(ix, "AMERICAN BEACON EMERGING MARKETS FUND") -> "S000001826"
//	icrResolveFundShared(ix, "AMERICAN BEACON BALANCED FUND")         -> "S000000718"
//	icrResolveFundShared(ix, "AMERICAN BEACON SMALL CAP VALUE FUND")  -> "S000001818"
//	... and fifteen more, every banner the filing prints.
//
// Fix location: `layout_issnpx.go`, the banner chain in `parseISSNPX` at :507
// -- alongside `issOpenBanner` (:7357), a reader for the sandwich shape: a bare
// rule whose next non-blank line holds no '=' and whose following non-blank
// line is another bare rule names that text as the fund.
func TestFamilyNS26AmericanBeaconRuledSandwichBanner(t *testing.T) {
	rows := familyNS26Dispatch(t, "american_beacon_ruled_sandwich_banner.txt", "american_beacon_dict.tsv", "issnpx", 6)
	for _, r := range rows {
		if r.SeriesID != "S000001826" {
			t.Errorf("a fund named in a three-line ruled sandwich is never read, so the row carries no fund and no series: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want S000001826",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
