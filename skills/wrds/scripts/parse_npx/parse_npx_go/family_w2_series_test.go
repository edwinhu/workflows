package main

import (
	"path/filepath"
	"testing"
)

// 000088/881466/0001169232-05-004255.txt: 11-26; 58-65; 103-113; 1610-1621.
func TestFamilyW2SeligmanHeadings(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0000881466": {
		{SeriesID: "S000009654", Name: "EMERGING MARKETS FUND"},
		{SeriesID: "S000009656", Name: "GLOBAL SMALLER COMPANIES FUND"},
		{SeriesID: "S000009655", Name: "GLOBAL GROWTH FUND"},
		{SeriesID: "S000009657", Name: "INTERNATIONAL GROWTH FUND"},
		{SeriesID: "S000009658", Name: "GLOBAL TECHNOLOGY FUND"},
	}}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile("seligman.txt", filepath.Join("testdata", "family_w2", "seligman.txt"), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "pvtext" || len(sink.buf) != 7 {
		t.Fatalf("dispatch precondition: %+v rows=%d", meta, len(sink.buf))
	}
	t.Logf("layout=%s rows=%d", meta.Layout, len(sink.buf))
	for i, row := range sink.buf {
		want, cusip, date := "S000009654", "Y0014U183", "20050330"
		if i >= 3 {
			want, cusip, date = "S000009656", "681977104", "20050520"
		}
		if row.CUSIP != cusip || row.MeetingDate != date {
			t.Fatalf("meeting precondition: row=%d CUSIP=%q date=%q", i, row.CUSIP, row.MeetingDate)
		}
		if row.SeriesID != want {
			t.Errorf("row %d cusip=%s date=%s fund=%q series=%q want=%s", i, row.CUSIP, row.MeetingDate, row.FundName, row.SeriesID, want)
		}
	}
}

// 000088/886048/0000352564-05-000021.txt: 11-26; 50-58; 90-101; 1411-1420.
func TestFamilyW2FirstInvestorsHeadings(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0000886048": {
		{SeriesID: "S000010584", Name: "FIRST INVESTORS MID-CAP OPPORTUNITY FUND"},
		{SeriesID: "S000010586", Name: "FIRST INVESTORS VALUE FUND"},
	}}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile("first_investors.txt", filepath.Join("testdata", "family_w2", "first_investors.txt"), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "pvtext" || len(sink.buf) != 8 {
		t.Fatalf("dispatch precondition: %+v rows=%d", meta, len(sink.buf))
	}
	t.Logf("layout=%s rows=%d", meta.Layout, len(sink.buf))
	for i, row := range sink.buf {
		want, cusip, date := "S000010584", "00437V104", "20041122"
		if i >= 5 {
			want, cusip, date = "S000010586", "002824100", "20050422"
		}
		if row.CUSIP != cusip || row.MeetingDate != date {
			t.Fatalf("meeting precondition: row=%d CUSIP=%q date=%q", i, row.CUSIP, row.MeetingDate)
		}
		if row.SeriesID != want {
			t.Errorf("row %d cusip=%s date=%s fund=%q series=%q want=%s", i, row.CUSIP, row.MeetingDate, row.FundName, row.SeriesID, want)
		}
	}
}
