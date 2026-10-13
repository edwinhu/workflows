package main

import (
	"path/filepath"
	"testing"
)

// familyNS11Dispatch runs the real dispatch on a family NS11 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS11Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns11", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns11", fixture), sink, make([]byte, headBytes))
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

// 000073/732697/0001209286-04-000022.txt: verbatim source lines 11-27, 29-36,
// 48-57, 11943-12000 and the filing's own last four lines. Dispatches to
// `votesummary` (the precondition asserts it).
//
// Ultra Series Fund, 2004. 5,853 of 5,853 rows carry no series, and the
// fund_name emitted on 5,497 of them is a DATE RANGE. The vendor opens every
// page with three centred lines -- the fund, the report title, the period --
// and the fund is the FIRST of the three (source lines 11946-11948 verbatim):
//
//	ULTRA SERIES GLOBAL SECURITIES FUND
//	    Proxy Voting Summary Report
//	   July 01, 2003 - June 30, 2004
//
// parseVoteSummaryRaw (layout_votesummary.go:205) takes the banner to be `last`
// -- the last text line before the column-header pair -- which in this vendor is
// the reporting period, never the fund. The registrant declares no <SERIES-ID>
// (grep -c = 0), so cikDict.exactFallback supplies its 27 dictionary rows, and
// the heading resolves the moment it is handed over -- measured through
// issPlainHeadingSeries on this filing's own index plus that dictionary:
//
//	"ULTRA SERIES GLOBAL SECURITIES FUND"    => S000019985
//	"ULTRA SERIES INTERNATIONAL STOCK FUND"  => S000019977
//	"ULTRA SERIES MONEY MARKET FUND"         => S000019976
//	"ULTRA SERIES BOND FUND"                 => S000019978
//	"ULTRA SERIES HIGH INCOME FUND"          => S000019979
//	"July 01, 2003 - June 30, 2004"          => ""
//
// (BALANCED, MID-CAP STOCK, GROWTH AND INCOME STOCK and CAPITAL APPRECIATION
// STOCK match no dictionary name at this CIK and are a floor of their own.)
//
// Rows reached: the INTERNATIONAL STOCK and GLOBAL SECURITIES sections are
// 3,874 of the filing's 6,638 ballot-item lines, ~3,400 of its 5,853 rows;
// the family is 3 filings and 10,468 pool rows.
//
// Fix in layout_votesummary.go, parseVoteSummaryRaw: when `last` resolves to
// nothing, walk back over the page's report-title and reporting-period lines to
// the nearest preceding text line that does resolve, and take THAT as the
// banner.
func TestFamilyNS11UltraSeriesDateLineTakenForTheFundHeading(t *testing.T) {
	rows := familyNS11Dispatch(t, "ultra_series_date_line_taken_for_heading.txt", "ultra_series_dict.tsv", "votesummary", 26)
	for _, r := range rows {
		if r.SeriesID != "S000019985" {
			t.Errorf("the reporting-period line was taken for the fund heading: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000019985", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
