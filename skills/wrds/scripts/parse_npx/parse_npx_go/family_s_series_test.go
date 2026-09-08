package main

import (
	"path/filepath"
	"testing"
)

func familySRows(t *testing.T, fixture, cik string, decls []SeriesDecl) []VoteRow {
	t.Helper()
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{cik: decls}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_s", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" || meta.CIK != cik || len(sink.buf) == 0 {
		t.Fatalf("fixture/dispatch precondition: CIK=%q layout=%q status=%q rows=%d error=%q", meta.CIK, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	return sink.buf
}

// 000088/883939/0000950152-04-006569.txt: 11-26; 49-55; 121-153
// (56 lines). Verbatim source bytes; the filing prints EQUITY where the CIK's
// real historical dictionary declaration uses STOCK.
func TestFamilySISSNPXEquityForStockHeading(t *testing.T) {
	rows := familySRows(t, "S883939_equity_for_stock.txt", "0000883939", []SeriesDecl{
		{SeriesID: "S000004673", Name: "STI Classic Aggressive Growth Stock Fund"},
		{SeriesID: "S000004641", Name: "STI Classic Balanced Fund"},
	})
	if len(rows) != 9 {
		t.Fatalf("got %d real proposals, want 9", len(rows))
	}
	for _, row := range rows {
		if row.IssuerName != "ALIGN TECHNOLOGY, INC." || row.CUSIP != "016255101" || row.MeetingDate != "20040519" || row.FundName != "STI CLASSIC AGGRESSIVE GROWTH EQUITY FUND" {
			t.Fatalf("real proposal precondition: issuer=%q CUSIP=%q date=%q fund=%q", row.IssuerName, row.CUSIP, row.MeetingDate, row.FundName)
		}
		if row.SeriesID != "S000004673" {
			t.Errorf("issnpx item %s under heading %q: series=%q, want S000004673 (STI Classic Aggressive Growth Stock Fund)", row.ItemSeq, row.FundName, row.SeriesID)
		}
	}
}

// 000102/1027263/0001193125-04-149076.txt: 11-27; 52-60;
// 98518-98531 (40 lines). Verbatim source bytes; ALLAIANCE is the filing's
// typo for the real dictionary name EQ/Alliance International Portfolio.
func TestFamilySISSNPXAllianceTypoHeading(t *testing.T) {
	rows := familySRows(t, "S1027263_allaiance_typo.txt", "0001027263", []SeriesDecl{
		{SeriesID: "S000009053", Name: "EQ/Alliance International Portfolio"},
		{SeriesID: "S000009043", Name: "EQ/Alliance Growth and Income Portfolio"},
	})
	if len(rows) != 3 {
		t.Fatalf("got %d real proposals, want 3", len(rows))
	}
	for _, row := range rows {
		if row.IssuerName != "ABBEY NATIONAL PLC" || row.CUSIP != "GB0000044551" || row.MeetingDate != "20040422" || row.FundName != "EQ/ALLAIANCE INTERNATIONAL PORTFOLIO" || row.HowVoted != "Not Voted" {
			t.Fatalf("real proposal precondition: issuer=%q CUSIP=%q date=%q fund=%q vote=%q", row.IssuerName, row.CUSIP, row.MeetingDate, row.FundName, row.HowVoted)
		}
		if row.SeriesID != "S000009053" {
			t.Errorf("issnpx item %s under heading %q: series=%q, want S000009053 (EQ/Alliance International Portfolio)", row.ItemSeq, row.FundName, row.SeriesID)
		}
	}
}

// 000101/1018170/0001144204-08-050244.txt: 25-26; 311; 342-347;
// 356; 416-419; 421-423; 452; 480-483; 502-503; 505-506; 528-535;
// 540-545; 559; 574-580; 585-590; 604; 619-625; 630-635; 649
// (60 lines). The section is a one-cell prose row whose fund name uses the
// filing's HLF abbreviation and omits the dictionary's terminal Portfolio.
func TestFamilySHTMLTableHLFProseHeading(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0001018170": {
		{SeriesID: "S000004199", Name: "Harding Loevner International Equity Portfolio"},
		{SeriesID: "S000004200", Name: "Harding Loevner Global Equity Portfolio"},
	}}}
	seriesMap = nil

	fixture := "harding_loevner_hlf_heading.txt"
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_s", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || meta.CIK != "0001018170" {
		t.Fatalf("fixture/dispatch precondition: CIK=%q layout=%q status=%q rows=%d error=%q", meta.CIK, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	if len(sink.buf) != 3 {
		t.Fatalf("got %d real proposals, want 3", len(sink.buf))
	}
	for _, row := range sink.buf {
		if row.MeetingDate != "20070726" || row.VoteDescription == "" {
			t.Fatalf("real proposal precondition: date=%q description=%q", row.MeetingDate, row.VoteDescription)
		}
		if row.SeriesID != "S000004199" {
			t.Errorf("htmltable item %s under HLF INTERNATIONAL EQUITY heading: series=%q fund=%q, want S000004199", row.ItemSeq, row.SeriesID, row.FundName)
		}
	}
}
