package main

import (
	"path/filepath"
	"testing"
)

func familyV1Rows(t *testing.T, fixture, cik string, count int, decls []SeriesDecl) []VoteRow {
	t.Helper()
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{cik: decls}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_v1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	return sink.buf
}

// 000093/934563/0000950152-06-007339.txt: 25-26; 11151-11152;
// 11155; 11176-11209; 11216-11270. Dictionary IDs are from cik_series.tsv.
func TestFamilyV1HirtleAccountSuffix(t *testing.T) {
	rows := familyV1Rows(t, "hirtle.txt", "0000934563", 2, []SeriesDecl{
		{SeriesID: "S000009379", Name: "The Growth Equity Portfolio"},
		{SeriesID: "S000009378", Name: "The Value Equity Portfolio"},
	})
	for _, r := range rows {
		if r.CUSIP != "88579Y101" || r.MeetingDate != "20060509" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000009379" {
			t.Errorf("3M CO under Hirtle Callaghan Trust Growth Equity — 11VB: fund=%q series=%q, want S000009379", r.FundName, r.SeriesID)
		}
	}
}

// 000089/895414/0001104659-04-026139.txt: 25-26; 155275-155319;
// 155354-155469. Keep the verbose HTML rows verbatim.
func TestFamilyV1NicholasBareStrategy(t *testing.T) {
	rows := familyV1Rows(t, "nicholas.txt", "0000895414", 3, []SeriesDecl{
		{SeriesID: "S000006948", Name: "Nicholas Applegate U.S. Systematic Large Cap Growth Fund"},
		{SeriesID: "S000006950", Name: "Nicholas Applegate U.S. Micro Cap Fund"},
	})
	for _, r := range rows {
		if r.CUSIP != "00846U101" || r.MeetingDate != "20040302" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000006948" {
			t.Errorf("AGILENT TECHNOLOGIES INC. under U.S. SYSTEMATIC LARGE CAP GROWTH: fund=%q series=%q, want S000006948", r.FundName, r.SeriesID)
		}
	}
}
