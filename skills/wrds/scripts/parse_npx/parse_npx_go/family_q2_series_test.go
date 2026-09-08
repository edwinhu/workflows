package main

import (
	"path/filepath"
	"testing"
)

// 000083/836487/0001104659-04-026017.txt: 25-26; 423-427; 431-468;
// 481; 485-556; 703, concatenated without changing the filing bytes.
// Three complete proposals are required by htmlHeaderConfirm. Both declarations
// come from this CIK's cik_series.tsv entries; the 2004 header has no series.
func TestFamilyQ2HTMLMultilinePortfolioHeading(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{
		"0000836487": {
			{SeriesID: "S000002820", Name: "ACTIVE INTERNATIONAL ALLOCATION PORTFOLIO"},
			{SeriesID: "S000002825", Name: "SMALL COMPANY GROWTH PORTFOLIO"},
		},
	}}
	seriesMap = nil
	sink := &rowSink{}
	fixture := "morgan_multiline_portfolio.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_q2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || meta.CIK != "0000836487" || len(sink.buf) != 3 {
		t.Fatalf("fixture/dispatch precondition: CIK=%q layout=%q status=%q rows=%d error=%q", meta.CIK, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	for i, row := range sink.buf {
		if row.IssuerName != "3I GROUP PLC (FORMERLY INVESTORS IN INDUSTRY)" || row.ISIN != "GB0008886938" || row.MeetingDate != "20040707" || row.HowVoted != "For" {
			t.Fatalf("real proposal %d identity/vote precondition: issuer=%q ISIN=%q date=%q vote=%q", i+1, row.IssuerName, row.ISIN, row.MeetingDate, row.HowVoted)
		}
	}
	for _, row := range sink.buf {
		if row.SeriesID != "S000002820" {
			t.Errorf("htmltable item %s: split ACTIVE / INTERNATIONAL ALLOCATION PORTFOLIO heading: fund=%q series=%q, want S000002820", row.ItemSeq, row.FundName, row.SeriesID)
		}
	}
}
