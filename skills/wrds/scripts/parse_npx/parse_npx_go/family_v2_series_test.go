package main

import (
	"path/filepath"
	"testing"
)

// 000077/770906/0000352564-05-000017.txt: 11-26; 50-58; 90-99; 115-124.
func TestFamilyV2FirstInvestorsRegistrantFundHeading(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0000770906": {
		{SeriesID: "S000010198", Name: "FIRST INVESTORS LIFE SERIES HIGH YIELD FUND"},
		{SeriesID: "S000010190", Name: "FIRST INVESTORS LIFE SERIES DISCOVERY FUND"},
	}}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile("first_investors.txt", filepath.Join("testdata", "family_v2", "first_investors.txt"), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "pvtext" || len(sink.buf) != 4 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	t.Logf("real dispatch: layout=%s rows=%d", meta.Layout, len(sink.buf))
	for i, row := range sink.buf {
		want, cusip, date := "S000010198", "457030104", "20050329"
		if i >= 2 {
			want, cusip, date = "S000010190", "007903SMH", "20050428"
		}
		if row.CUSIP != cusip || row.MeetingDate != date {
			t.Fatalf("meeting precondition: row=%d CUSIP=%q date=%q", i, row.CUSIP, row.MeetingDate)
		}
		if row.SeriesID != want {
			t.Errorf("row %d item %s: series=%q fund=%q, want %s from registrant Fund - subfund heading", i, row.ItemSeq, row.SeriesID, row.FundName, want)
		}
	}
}
