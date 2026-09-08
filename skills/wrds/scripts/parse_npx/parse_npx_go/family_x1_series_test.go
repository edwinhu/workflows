package main

import (
	"path/filepath"
	"testing"
)

// 000138/1385533/0001193125-12-332271.txt: 15-16; 361152-361155;
// 361170-361181; 361184-361196; 361215; 361228-361243; 361249-361256;
// 361262-361269; 361582. Three proposals confirm the unlabelled description.
func TestFamilyX1TDAXInTargetAccountSeries(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0001385533": {
		{SeriesID: "S000016521", Name: "db-X 2010 Target Date Fund"},
		{SeriesID: "S000016522", Name: "db-X 2020 Target Date Fund"},
		{SeriesID: "S000016523", Name: "db-X 2030 Target Date Fund"},
		{SeriesID: "S000016524", Name: "db-X 2040 Target Date Fund"},
		{SeriesID: "S000016525", Name: "db-X In-Target Date Fund"},
		{SeriesID: "S000016521", Name: "TDX Independence 2010 Exchange-Traded Fund"},
		{SeriesID: "S000016522", Name: "TDX Independence 2020 Exchange-Traded Fund"},
		{SeriesID: "S000016523", Name: "TDX Independence 2030 Exchange-Traded Fund"},
		{SeriesID: "S000016524", Name: "TDX Independence 2040 Exchange-Traded Fund"},
		{SeriesID: "S000016525", Name: "TDX Independence In-Target Exchange-Traded Fund"},
	}}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile("dbx_in_target.txt", filepath.Join("testdata", "family_x1", "dbx_in_target.txt"), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || meta.CIK != "0001385533" || len(sink.buf) != 3 {
		t.Fatalf("fixture/dispatch: status=%s layout=%s CIK=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, meta.CIK, len(sink.buf), meta.ErrorMsg)
	}
	for _, r := range sink.buf {
		if r.IssuerName != "Tesco plc" || r.CUSIP != "G87621101" || r.MeetingDate != "20110701" {
			t.Fatalf("identity precondition: issuer=%q CUSIP=%q date=%q", r.IssuerName, r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000016525" {
			t.Errorf("TDAX Independence In Target - Equity: fund=%q series=%q, want S000016525 (TDX Independence In-Target Exchange-Traded Fund)", r.FundName, r.SeriesID)
		}
	}
}
