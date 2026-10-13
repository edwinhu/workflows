package main

import (
	"path/filepath"
	"testing"
)

// 000081/814679/0000067590-16-002828.txt: 1-2; 15-16; 57-58;
// 66-67; 75-76; 84-85; 93-99; 195; 197; 199-200; 203-208;
// 210-239; 332 (60 lines). Excerpts retain all four declared series, none
// of which is the Franklin Templeton fund named above the first table.
func TestFamilyT2HTMLDictionaryHeadingOutsideDeclaredSeries(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0000814679": {
		{SeriesID: "S000036493", Name: "AST Franklin Templeton Founding Funds Allocation Portfolio"},
		{SeriesID: "S000036492", Name: "AST New Discovery Asset Allocation Portfolio"},
		{SeriesID: "S000019377", Name: "AST RCM World Trends Portfolio"},
		{SeriesID: "S000019376", Name: "AST SCHRODERS GLOBAL TACTICAL PORTFOLIO"},
		{SeriesID: "S000006796", Name: "AST PRUDENTIAL GROWTH ALLOCATION PORTFOLIO"},
	}}}
	seriesMap = nil
	fixture := "ast_undeclared_dictionary_heading.txt"
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_t2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || meta.CIK != "0000814679" || len(sink.buf) != 3 {
		t.Fatalf("fixture/dispatch precondition: CIK=%q layout=%q status=%q rows=%d error=%q", meta.CIK, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	row := sink.buf[0]
	if row.IssuerName != "ACE LIMITED" || row.CUSIP != "H0023R105" || row.MeetingDate != "20130516" || row.HowVoted != "For" || row.VoteDescription != "Elect Robert M. Hernandez as Director" {
		t.Fatalf("real proposal precondition: issuer=%q CUSIP=%q date=%q vote=%q description=%q", row.IssuerName, row.CUSIP, row.MeetingDate, row.HowVoted, row.VoteDescription)
	}
	for _, row := range sink.buf {
		if row.SeriesID != "S000036493" {
			t.Errorf("htmltable item %s under AST Franklin Templeton Founding Funds Allocation Portfolio - Sub-Adviser: Franklin Templeton: series=%q fund=%q, want S000036493", row.ItemSeq, row.SeriesID, row.FundName)
		}
	}
}
