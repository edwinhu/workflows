package main

import (
	"path/filepath"
	"testing"
)

// 000106/1064642/0000950135-07-005301.txt: verbatim source lines 1-409,
// 4401-4519 and 66361-66365 (the filing's own tail), three unedited slices of
// the real file. Dispatches to `text`/`votesummary` (the precondition asserts
// it).
//
// SPDR Series Trust (CIK 1064642, formerly streetTRACKS Series Trust), 2007,
// ISS `VOTE SUMMARY REPORT` plaintext. 3,491 of the filing's 4,157 rows carry
// no series id even though the filing's OWN <SEC-HEADER> declares all 32 of its
// series, and every one of the 26 fund banners it prints matches a declared
// <SERIES-NAME> case-insensitively. No dictionary or overlay can reach these
// rows: measured with the audited streetTRACKS-era mapping fed in via
// -cik-series, the 2004, 2005 and 2011 filings of this CIK go to ZERO blank
// rows (15,105 recovered) and this filing's 3,491 do not move at all.
//
// The vendor prints the fund name ONCE, on a cover page of its own, and then
// repeats a nameless banner on every continuation page. Source lines 4401-4414
// and 4463-4474 verbatim:
//
//	<PAGE>
//
//	                               VOTE SUMMARY REPORT
//
//	                          July 01, 2006 - June 30, 2007
//
//	SPDR(R) DJ WILSHIRE LARGE CAP ETF
//
//	<PAGE>
//
//	                               VOTE SUMMARY REPORT
//	                           Jul 01, 2006 - Jun 30, 2007
//
//	<TABLE>
//	...
//	 </TABLE>
//	                                                                           Page 1
//	<PAGE>
//
//	                                VOTE SUMMARY REPORT
//	                            Jul 01, 2006 - Jun 30, 2007
//
//	<TABLE>
//
// The continuation banner spells the period in the abbreviated month form
// (`Jul 01, 2006 - Jun 30, 2007`) and carries no fund name at all.
//
// Where it falls through, in layout_votesummary.go's parseVoteSummary: on a
// column-header match at :336-338 the live fund is overwritten unconditionally
// with `last`, the last text line before the header -- here the date range. The
// labelled-line probe (vsLabelledFund, :339) finds nothing, `resolve(fund)`
// fails on a date range, and the banner lookback at :349 walks `block`, which
// `</TABLE>` cleared at :327. On the fund's FIRST table `block` still holds the
// cover page, so the lookback reaches `SPDR(R) DJ WILSHIRE LARGE CAP ETF` and
// the row resolves; on every table after the first `</TABLE>`, `block` holds
// only `Page 1`, `VOTE SUMMARY REPORT` and the date range, none of which
// resolves within vsBannerLookback (6). The fund established on the cover page
// is never carried across the page break, so the date range itself is stamped
// as the fund heading.
//
// Measured on this fixture: 21 rows carry S000006983, 17 carry no series id and
// the heading `Jul 01, 2006 - Jun 30, 2007`. Both tables belong to the same
// fund -- the fixture contains exactly one fund section.
//
// Rows reached: 3,491 in this filing. The sibling no-series rows of this CIK
// (7,818 in 0000950135-04-004280.txt, 6,490 in 0000950135-05-005079.txt, 797 in
// 0000950123-11-081354.txt) are a DICTIONARY gap, not this bug, and are fully
// recoverable with the audited rename chain -- see
// scratch/diag-1064642-report.md.
func TestFamilyNSStreetTracksContinuationBannerLosesFund(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	dir := filepath.Join("testdata", "family_ns_streettracks_rename")
	fixture := "spdr_series_trust_2007_continuation_banner.txt"
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join(dir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != "votesummary" || len(rows) != 38 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=38 error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	// The fixture is one fund section. Its header declares
	// <SERIES-ID>S000006983 / <SERIES-NAME>SPDR(R) DJ Wilshire Large Cap ETF,
	// and the cover page prints that name, so every row must carry it.
	var blank int
	var firstBad VoteRow
	for _, r := range rows {
		if r.SeriesID != "S000006983" {
			if blank == 0 {
				firstBad = r
			}
			blank++
		}
	}
	if blank != 0 {
		t.Errorf("rows that lost the fund across the continuation banner: %d/%d; first such row: series=%q heading=%q issuer=%q cusip=%q date=%q; want series=%q for every row (the filing's own header declares it and the section's cover page prints the name)",
			blank, len(rows), firstBad.SeriesID, firstBad.FundName, firstBad.IssuerName, firstBad.CUSIP, firstBad.MeetingDate, "S000006983")
	}
}
