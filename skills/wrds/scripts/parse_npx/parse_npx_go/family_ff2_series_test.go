package main

import (
	"path/filepath"
	"testing"
)

// 000153/1535538/0001535538-20-000028.txt: 15-16, 168-170,
// 349-433, 809-829 (111 verbatim lines). Three intact vote rows are required
// by htmlHeaderConfirm; blank lines and HTML cells are preserved.
func TestFamilyFF2FranklinMasterHeading(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0001535538": {
		{SeriesID: "S000036064", Name: "Franklin Pelagos Commodities Strategy Fund"},
		{SeriesID: "S000042023", Name: "Franklin K2 Alternative Strategies Fund"},
		{SeriesID: "S000049976", Name: "Franklin K2 Long Short Credit Fund"},
		{SeriesID: "S000054086", Name: "Franklin K2 Global Macro Opportunities Fund"},
	}}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile("franklin_master.txt", filepath.Join("testdata", "family_ff2", "franklin_master.txt"), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || len(sink.buf) != 3 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	r := sink.buf[0]
	if r.CUSIP != "002824100" || r.MeetingDate != "20200424" || r.HowVoted != "For" {
		t.Fatalf("identity/vote precondition: CUSIP=%q date=%q vote=%q", r.CUSIP, r.MeetingDate, r.HowVoted)
	}
	if r.SeriesID != "S000042023" {
		t.Errorf("Franklin K2 Alternative Strategies Fund-Master: fund=%q series=%q want S000042023", r.FundName, r.SeriesID)
	}
}
