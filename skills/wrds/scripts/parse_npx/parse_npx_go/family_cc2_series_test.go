package main

import (
	"path/filepath"
	"testing"
)

// 000081/811161/0000897101-11-001512.txt: 15-16, 87, 145, 147,
// 157-164, 173-198, 218-225, 235-242, 281-288 (63 verbatim lines;
// three proposal rows confirm the split header). A labelled registrant cell follows
// the exact series heading; it must not erase that section's attribution.
func TestFamilyCC2ClearwaterRegistrantCellOverFundHeading(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0000811161": {
		{SeriesID: "S000000697", Name: "Clearwater Growth Fund"},
		{SeriesID: "S000000698", Name: "Clearwater Small Cap Fund"},
		{SeriesID: "S000000699", Name: "Clearwater Tax-Exempt Bond Fund"},
		{SeriesID: "S000024756", Name: "CLEARWATER INTERNATIONAL FUND"},
	}}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile("clearwater_registrant_over_fund.txt", filepath.Join("testdata", "family_cc2", "clearwater_registrant_over_fund.txt"), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || len(sink.buf) != 3 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	r := sink.buf[0]
	if r.CUSIP != "151290889" || r.MeetingDate != "20110224" || r.HowVoted != "FOR" {
		t.Fatalf("identity/vote precondition: CUSIP=%q date=%q vote=%q", r.CUSIP, r.MeetingDate, r.HowVoted)
	}
	if r.SeriesID != "S000000697" {
		t.Errorf("CUSIP=%s date=%s fund=%q: series=%q want S000000697 (CLEARWATER GROWTH FUND heading)", r.CUSIP, r.MeetingDate, r.FundName, r.SeriesID)
	}
}
