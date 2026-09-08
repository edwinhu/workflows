package main

import (
	"path/filepath"
	"testing"
)

// 000121/1214511/0001193125-04-149507.txt: 11-26, 39-46, 87-88,
// 15223-15238, 31735-31745 (53 verbatim lines).
func TestFamilyBB2MunderAdjacentFundBanners(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0001214511": {
		{SeriesID: "S000002741", Name: "Institutional Money Market Fund"},
		{SeriesID: "S000002744", Name: "Munder Intermediate Bond Fund"},
		{SeriesID: "S000002746", Name: "Munder International Equity Fund"},
		{SeriesID: "S000002740", Name: "Liquidity Money Market Fund"},
		{SeriesID: "S000002727", Name: "Munder Michigan Tax-Free Bond Fund"},
		{SeriesID: "S000002728", Name: "Munder Micro-Cap Equity Fund"},
	}}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile("munder_adjacent.txt", filepath.Join("testdata", "family_bb2", "munder_adjacent.txt"), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" || len(sink.buf) != 5 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	for _, r := range sink.buf {
		want, date := "S000002746", "20040430"
		if r.CUSIP == "00086T103" {
			want, date = "S000002728", "20040618"
		} else if r.CUSIP != "00709P108" {
			t.Fatalf("unexpected CUSIP %q", r.CUSIP)
		}
		if r.MeetingDate != date {
			t.Fatalf("date=%q want %s", r.MeetingDate, date)
		}
		if r.SeriesID != want {
			t.Errorf("CUSIP=%s item=%s fund=%q: series=%q want %s", r.CUSIP, r.ItemSeq, r.FundName, r.SeriesID, want)
		}
	}
}

// 000091/915092/0001193125-04-149378.txt: 11-26, 48-54, 91-95,
// 52494-52505, 128273-128284 (52 verbatim lines).
func TestFamilyBB2MIPMasterPortfolioHeadings(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0000915092": {
		{SeriesID: "S000004290", Name: "LifePath 2010 Master Portfolio"},
		{SeriesID: "S000004285", Name: "S&P 500 Index Master Portfolio"},
		{SeriesID: "S000033547", Name: "LifePath Index 2020 Master Portfolio"},
		{SeriesID: "S000004291", Name: "LifePath 2020 Master Portfolio"},
	}}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile("mip_master.txt", filepath.Join("testdata", "family_bb2", "mip_master.txt"), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" || len(sink.buf) != 4 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	for _, r := range sink.buf {
		want, date := "S000004290", "20040415"
		if r.CUSIP == "88579Y101" {
			want, date = "S000004285", "20040511"
		} else if r.CUSIP != "055622104" {
			t.Fatalf("unexpected CUSIP %q", r.CUSIP)
		}
		if r.MeetingDate != date {
			t.Fatalf("date=%q want %s", r.MeetingDate, date)
		}
		if r.SeriesID != want {
			t.Errorf("CUSIP=%s item=%s fund=%q: series=%q want %s", r.CUSIP, r.ItemSeq, r.FundName, r.SeriesID, want)
		}
	}
}
