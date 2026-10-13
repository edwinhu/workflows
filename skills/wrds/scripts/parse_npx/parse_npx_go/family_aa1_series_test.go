package main

import (
	"path/filepath"
	"testing"
)

// 000136/1365662/0000891804-14-000786.txt: 1-16; 310-340
// (47 verbatim lines). The body drops the declared series' internal
// "Small-Mid Cap" modifier: Guggenheim BRIC ETF versus the dictionary's
// Guggenheim Small-Mid Cap BRIC ETF.
func TestFamilyAA1GuggenheimBRICHeading(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0001365662": {
		{SeriesID: "S000031948", Name: "Guggenheim Small-Mid Cap BRIC ETF"},
		{SeriesID: "S000017279", Name: "Guggenheim S&P Global Water Index ETF"},
	}}}
	seriesMap = nil
	sink := &rowSink{}
	fixture := "guggenheim_bric.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_aa1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "icr" || meta.CIK != "0001365662" || len(sink.buf) != 2 {
		t.Fatalf("fixture/dispatch precondition: CIK=%q layout=%q status=%q rows=%d error=%q", meta.CIK, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	t.Logf("real dispatch: layout=%s rows=%d", meta.Layout, len(sink.buf))
	for _, row := range sink.buf {
		if row.FundName != "Guggenheim  BRIC ETF" || row.CUSIP != "90138A103" || row.MeetingDate != "20140529" {
			t.Fatalf("real heading/meeting precondition: fund=%q CUSIP=%q date=%q", row.FundName, row.CUSIP, row.MeetingDate)
		}
		if row.SeriesID != "S000031948" {
			t.Errorf("item %s under %q: series=%q, want S000031948", row.ItemSeq, row.FundName, row.SeriesID)
		}
	}
}
