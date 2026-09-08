package main

import (
	"path/filepath"
	"testing"
)

// 000150/1503123/0000088053-22-000873.txt: 15-16; 575-580;
// 598-614; 52305-52317. Verbatim source lines; real cik_series.tsv IDs.
func TestFamilyQ1ISSMultilineFormerName(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0001503123": {
		{SeriesID: "S000060056", Name: "Xtrackers Emerging Markets Carbon Reduction and Climate Improvers ETF"},
		{SeriesID: "S000060056", Name: "Xtrackers MSCI ACWI ex USA ESG Leaders Equity ETF"},
		{SeriesID: "S000050121", Name: "Xtrackers Eurozone Equity ETF"},
	}}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile("Q1503123.txt", filepath.Join("testdata", "family_q1", "Q1503123.txt"), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" || len(sink.buf) != 3 {
		t.Fatalf("fixture/dispatch: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	for _, r := range sink.buf {
		want := "S000060056"
		switch r.IssuerName {
		case "360 SECURITY TECHNOLOGY, INC.":
			if r.CUSIP != "Y444T7106" || r.MeetingDate != "20211015" {
				t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
			}
		case "A2A SPA":
			want = "S000050121"
		default:
			t.Fatalf("unexpected real issuer %q", r.IssuerName)
		}
		t.Logf("layout=%s issuer=%q fund=%q series=%q", meta.Layout, r.IssuerName, r.FundName, r.SeriesID)
		if r.SeriesID != want {
			t.Errorf("issuer %q: series=%q, want %s under printed fund heading", r.IssuerName, r.SeriesID, want)
		}
	}
}
