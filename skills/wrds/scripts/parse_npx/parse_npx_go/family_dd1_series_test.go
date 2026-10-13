package main

import (
	"path/filepath"
	"testing"
)

// 000000/4123/0000950144-04-008544.txt: 11-18, 25-26, 55-61,
// 125-129, 8791-8808, 14486-14500 (55 verbatim lines).
func TestFamilyDD1EnterpriseEGFBrand(t *testing.T) {
	savedD, savedM := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedD, savedM })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0000004123": {
		{SeriesID: "S000008135", Name: "AXA Enterprise Mergers and Acquisitions Fund"},
		{SeriesID: "S000008146", Name: "AXA Enterprise Growth Fund"},
	}}}
	seriesMap = nil
	sink := &rowSink{}
	m := processFile("enterprise.txt", filepath.Join("testdata", "family_dd1", "enterprise.txt"), sink, make([]byte, headBytes))
	if m.ParseStatus != "ok" || m.Layout != "issnpx" || len(sink.buf) != 6 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", m.ParseStatus, m.Layout, len(sink.buf), m.ErrorMsg)
	}
	for _, r := range sink.buf {
		want := map[string]string{"EGF GROWTH": "S000008146", "EGF MERGERS & ACQUISITIONS": "S000008135"}[r.FundName]
		if want == "" || r.Ticker == "" || r.MeetingDate == "" {
			t.Fatalf("fixture missing heading, identifier or date: %+v", r)
		}
		if r.SeriesID != want {
			t.Errorf("fund=%q ticker=%s series=%q want %s", r.FundName, r.Ticker, r.SeriesID, want)
		}
	}
}
