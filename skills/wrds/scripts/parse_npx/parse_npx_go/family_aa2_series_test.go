package main

import (
	"path/filepath"
	"testing"
)

// 000116/1160167/0001193125-04-146426.txt: 11-26; 40-46; 89-100;
// 16339-16350; 23558-23569 (59 verbatim lines). The filing's AXA PREMIER
// headings use historical predecessors of the dictionary's AXA Enterprise
// Multimanager names, including the Large Cap and Small/Mid Cap variants.
func TestFamilyAA2AXAPremierHistoricalBrand(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0001160167": {
		{SeriesID: "S000008169", Name: "AXA Enterprise Multimanager Health Care Fund"},
		{SeriesID: "S000008157", Name: "AXA Enterprise Multimanager Growth Fund"},
		{SeriesID: "S000008165", Name: "AXA Enterprise Multimanager Mid Cap Growth Fund"},
	}}}
	seriesMap = nil
	sink := &rowSink{}
	fixture := "axa_premier.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_aa2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" || meta.CIK != "0001160167" || len(sink.buf) != 6 {
		t.Fatalf("fixture/dispatch precondition: CIK=%q layout=%q status=%q rows=%d error=%q", meta.CIK, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	t.Logf("real dispatch: layout=%s rows=%d", meta.Layout, len(sink.buf))
	want := map[string]struct{ series, cusip, date string }{
		"AXA PREMIER HEALTH CARE FUND":          {"S000008169", "002824100", "20040423"},
		"AXA PREMIER LARGE CAP GROWTH FUND":     {"S000008157", "88579Y101", "20040511"},
		"AXA PREMIER SMALL/MID CAP GROWTH FUND": {"S000008165", "281760108", "20040624"},
	}
	for i, row := range sink.buf {
		w, ok := want[row.FundName]
		if !ok || row.CUSIP != w.cusip || row.MeetingDate != w.date {
			t.Fatalf("row %d real section precondition: fund=%q CUSIP=%q date=%q", i, row.FundName, row.CUSIP, row.MeetingDate)
		}
		if row.SeriesID != w.series {
			t.Errorf("item %s under %q: series=%q, want %s", row.ItemSeq, row.FundName, row.SeriesID, w.series)
		}
	}
}
