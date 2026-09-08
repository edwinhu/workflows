package main

import (
	"path/filepath"
	"testing"
)

// 000106/1066980/0000950133-05-003960.txt: 1-18412, verbatim.
// Keep the first labelvalue header beyond issnpx's 128 KiB match window.
func TestFamilyZ1VantagepointMixedLayoutFund(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict, seriesMap = nil, nil
	sink := &rowSink{}
	meta := processFile("vantagepoint_mixed.txt", filepath.Join("testdata", "family_z1", "vantagepoint_mixed.txt"), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "labelvalue" || meta.CIK != "0001066980" || len(sink.buf) != 14 {
		t.Fatalf("dispatch precondition: status=%s layout=%s CIK=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, meta.CIK, len(sink.buf), meta.ErrorMsg)
	}
	for _, r := range sink.buf {
		if r.CUSIP != "020002101" || r.MeetingDate != "20050517" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.FundName != "Vantagepoint Equity Income Fund" {
			t.Fatalf("labelvalue item %s: fund=%q, want Vantagepoint Equity Income Fund printed above ALLSTATE", r.ItemSeq, r.FundName)
		}
	}
}

// 000138/1385533/0001193125-12-332271.txt: 1-113; 361152-361155;
// 361170-361181; 361184-361196; 361215; 361228-361243; 361249-361256;
// 361262-361269; 361582. Same body as family X1, plus the real SEC header.
func TestFamilyZ1TDAXDeclaredHeaderSeries(t *testing.T) {
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
	meta := processFile("tdax_declared.txt", filepath.Join("testdata", "family_z1", "tdax_declared.txt"), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || meta.CIK != "0001385533" || len(sink.buf) != 3 {
		t.Fatalf("dispatch precondition: status=%s layout=%s CIK=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, meta.CIK, len(sink.buf), meta.ErrorMsg)
	}
	for _, r := range sink.buf {
		if r.IssuerName != "Tesco plc" || r.CUSIP != "G87621101" || r.MeetingDate != "20110701" {
			t.Fatalf("identity precondition: issuer=%q CUSIP=%q date=%q", r.IssuerName, r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000016525" {
			t.Fatalf("TDAX declared-header item %s: fund=%q series=%q, want S000016525", r.ItemSeq, r.FundName, r.SeriesID)
		}
	}
}
