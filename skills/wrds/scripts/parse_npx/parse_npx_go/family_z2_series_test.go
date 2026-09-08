package main

import (
	"path/filepath"
	"testing"
)

// 000092/927413/0000950116-06-000724.txt: 11-26; 474-480; 569-573;
// 31501-31513; 33334-33346 (54 verbatim lines). The two body headings
// substitute PORTFOLIO for the dictionary's terminal FUND.
func TestFamilyZ2WilmingtonPortfolioHeading(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0000927413": {
		{SeriesID: "S000001320", Name: "WILMINGTON LARGE CAP CORE FUND"},
		{SeriesID: "S000001319", Name: "WILMINGTON LARGE-CAP GROWTH FUND"},
	}}}
	seriesMap = nil
	sink := &rowSink{}
	fixture := "wilmington_portfolio.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_z2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" || meta.CIK != "0000927413" || len(sink.buf) != 6 {
		t.Fatalf("fixture/dispatch precondition: CIK=%q layout=%q status=%q rows=%d error=%q", meta.CIK, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	t.Logf("real dispatch: layout=%s rows=%d", meta.Layout, len(sink.buf))
	for i, row := range sink.buf {
		if row.CUSIP != "88579Y101" || row.MeetingDate != "20050510" {
			t.Fatalf("row %d real meeting precondition: CUSIP=%q date=%q", i, row.CUSIP, row.MeetingDate)
		}
		want := "S000001320"
		if i >= 3 {
			want = "S000001319"
		}
		if row.SeriesID != want {
			t.Errorf("item %s under %q: series=%q, want %s", row.ItemSeq, row.FundName, row.SeriesID, want)
		}
	}
}

// 000079/792359/0000950123-04-010355.txt: 11-26; 53-60; 126-131;
// 40602-40619; 41461-41472 (60 verbatim lines). The dictionary omits the
// internal TRUST in NORTHERN TRUST, not just the terminal type word SERIES.
func TestFamilyZ2PhoenixNorthernTrustHeading(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0000792359": {
		{SeriesID: "S000001955", Name: "PHOENIX-NORTHERN DOW 30"},
		{SeriesID: "S000001956", Name: "PHOENIX-NORTHERN NASDAQ-100 INDEX"},
	}}}
	seriesMap = nil
	sink := &rowSink{}
	fixture := "phoenix_northern_trust.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_z2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" || meta.CIK != "0000792359" || len(sink.buf) != 9 {
		t.Fatalf("fixture/dispatch precondition: CIK=%q layout=%q status=%q rows=%d error=%q", meta.CIK, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	t.Logf("real dispatch: layout=%s rows=%d", meta.Layout, len(sink.buf))
	for i, row := range sink.buf {
		wantID, wantCUSIP, wantDate := "S000001955", "88579Y101", "20040511"
		if i >= 7 {
			wantID, wantCUSIP, wantDate = "S000001956", "00724F101", "20040428"
		}
		if row.CUSIP != wantCUSIP || row.MeetingDate != wantDate {
			t.Fatalf("row %d real meeting precondition: CUSIP=%q date=%q, want %s/%s", i, row.CUSIP, row.MeetingDate, wantCUSIP, wantDate)
		}
		if row.SeriesID != wantID {
			t.Errorf("CUSIP %s item %s under %q: series=%q, want %s", row.CUSIP, row.ItemSeq, row.FundName, row.SeriesID, wantID)
		}
	}
}
