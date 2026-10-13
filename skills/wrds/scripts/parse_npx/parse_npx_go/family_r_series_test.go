package main

import (
	"path/filepath"
	"testing"
)

// These fixtures retain original filing bytes; the ranges below are one-based,
// inclusive and concatenated in source order. Dictionary declarations are real
// cik_series.tsv entries, supplied separately as on dictionary-backed grid runs.
func familyRRows(t *testing.T, fixture, cik, layout string, decls []SeriesDecl) []VoteRow {
	t.Helper()
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{cik: decls}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_r", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || meta.CIK != cik || len(sink.buf) == 0 {
		t.Fatalf("fixture/dispatch precondition: CIK=%q layout=%q status=%q rows=%d error=%q", meta.CIK, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	return sink.buf
}

// 000079/792359/0000950123-05-010308.txt: 26; 124-130; 20707-20719
// (21 lines). The body appends the type word SERIES to the dictionary name.
func TestFamilyRISSHeadingTerminalSeries(t *testing.T) {
	rows := familyRRows(t, "phoenix_terminal_series.txt", "0000792359", "issnpx", []SeriesDecl{
		{SeriesID: "S000001952", Name: "PHOENIX-KAYNE RISING DIVIDENDS"},
		{SeriesID: "S000002231", Name: "PHOENIX-ABERDEEN INTERNATIONAL SERIES"},
	})
	if len(rows) != 2 {
		t.Fatalf("got %d real proposals, want 2", len(rows))
	}
	for _, row := range rows {
		if row.IssuerName != "AFLAC INCORPORATED" || row.MeetingDate != "20050502" {
			t.Fatalf("identity precondition: issuer=%q date=%q", row.IssuerName, row.MeetingDate)
		}
		if row.SeriesID != "S000001952" {
			t.Errorf("heading PHOENIX-KAYNE RISING DIVIDENDS SERIES: item %s series=%q fund=%q, want S000001952", row.ItemSeq, row.SeriesID, row.FundName)
		}
	}
}

// 000079/792359/0000950123-05-010308.txt: 26; 124-130; 16934-16946
// (21 lines). After the existing trailing-parenthetical cut, SERIES remains
// inserted before the dictionary fund stem instead of at the end.
func TestFamilyRISSInfixSeriesWordOrder(t *testing.T) {
	rows := familyRRows(t, "phoenix_infix_series.txt", "0000792359", "issnpx", []SeriesDecl{
		{SeriesID: "S000001962", Name: "PHOENIX-DUFF & PHELPS REAL ESTATE SECURITIES"},
		{SeriesID: "S000002231", Name: "PHOENIX-ABERDEEN INTERNATIONAL SERIES"},
	})
	if len(rows) != 3 {
		t.Fatalf("got %d real proposals, want 3", len(rows))
	}
	for _, row := range rows {
		if row.IssuerName != "ALEXANDRIA REAL ESTATE EQUITIES, INC." || row.CUSIP != "015271109" || row.MeetingDate != "20050519" {
			t.Fatalf("identity precondition: issuer=%q CUSIP=%q date=%q", row.IssuerName, row.CUSIP, row.MeetingDate)
		}
		if row.SeriesID != "S000001962" {
			t.Errorf("heading PHOENIX-DUFF & PHELPS SERIES REAL ESTATE SECURITIES (CHI): item %s series=%q fund=%q, want S000001962", row.ItemSeq, row.SeriesID, row.FundName)
		}
	}
}

// 000091/916490/0001580642-17-004662.txt: 16; 28122-28128;
// 28153-28194 (50 lines). Registrant: directly names a dictionary fund rather
// than printing a trust name followed by a dash and fund name.
func TestFamilyRHTMLRegistrantHeadingNamesFund(t *testing.T) {
	rows := familyRRows(t, "timothy_registrant_heading.txt", "0000916490", "htmltable", []SeriesDecl{
		{SeriesID: "S000004479", Name: "Timothy Plan Small Cap Value Fund"},
		{SeriesID: "S000004480", Name: "Timothy Plan Large/Mid Cap Value Fund"},
	})
	if len(rows) != 3 {
		t.Fatalf("got %d real proposals, want 3", len(rows))
	}
	for _, row := range rows {
		if row.IssuerName != "CHEMICAL FINANCIAL CORPORATION" || row.CUSIP != "163731102" {
			t.Fatalf("identity precondition: issuer=%q CUSIP=%q", row.IssuerName, row.CUSIP)
		}
		if row.SeriesID != "S000004479" {
			t.Errorf("Registrant: Timothy Plan Small Cap Value Fund: series=%q fund=%q, want S000004479", row.SeriesID, row.FundName)
		}
	}
}

// 000080/804239/0001135428-16-001596.txt: 16; 722; 117324-117338
// (17 lines). The printed U.S. token and the dictionary's US token name the
// same fund; punctuation-created spacing must not make the series unreachable.
func TestFamilyRICRDottedUSHeading(t *testing.T) {
	rows := familyRRows(t, "simt_dotted_us.txt", "0000804239", "icr", []SeriesDecl{
		{SeriesID: "S000006678", Name: "SIMT US MANAGED VOLATILITY FUND"},
		{SeriesID: "S000010830", Name: "SIMT GLOBAL MANAGED VOLATILITY FUND"},
	})
	if len(rows) != 3 {
		t.Fatalf("got %d real proposals, want 3", len(rows))
	}
	for _, row := range rows {
		if row.IssuerName != "Aaron's, Inc." || row.CUSIP != "002535300" || row.MeetingDate != "20160504" {
			t.Fatalf("identity precondition: issuer=%q CUSIP=%q date=%q", row.IssuerName, row.CUSIP, row.MeetingDate)
		}
		if row.SeriesID != "S000006678" {
			t.Errorf("Fund Name : U.S. Managed Volatility Fund: item %s series=%q fund=%q, want S000006678", row.ItemSeq, row.SeriesID, row.FundName)
		}
	}
}
