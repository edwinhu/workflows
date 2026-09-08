package main

import (
	"path/filepath"
	"testing"
)

func familyRISSReconcileRows(t *testing.T, fixture, cik, layout string, decls []SeriesDecl) []VoteRow {
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

// 000005/53192/0001193125-11-229467.txt: 1; 15-16; 275-279;
// 302-397. Verbatim source lines; the dictionary IDs are this CIK's real
// cik_series.tsv declarations. The body wraps the declared name in the filing
// agent's NPF- prefix and A/C JND1 account suffix.
func TestFamilyRHTMLTableNPFAccountHeading(t *testing.T) {
	rows := familyRISSReconcileRows(t, "R53192_npf_account_heading.txt", "0000053192", "htmltable", []SeriesDecl{
		{SeriesID: "S000009778", Name: "THE JAPAN FUND, INC."},
		{SeriesID: "S000024534", Name: "ASIA PACIFIC EX JAPAN FUND"},
	})
	if len(rows) != 3 {
		t.Fatalf("got %d real proposals, want 3", len(rows))
	}
	for _, row := range rows {
		if row.IssuerName != "ASKUL CORP" || row.CUSIP != "629449901" || row.MeetingDate != "20100804" || row.HowVoted != "FOR" {
			t.Fatalf("real proposal precondition: issuer=%q CUSIP=%q date=%q vote=%q", row.IssuerName, row.CUSIP, row.MeetingDate, row.HowVoted)
		}
		if row.SeriesID != "S000009778" {
			t.Errorf("htmltable item %s under heading %q: series=%q, want S000009778 (THE JAPAN FUND, INC.)", row.ItemSeq, row.FundName, row.SeriesID)
		}
	}
}

// 000002/22370/0001438934-23-000218.txt: 1; 15-16; 603-630.
// Verbatim source lines; the dictionary IDs are this CIK's real cik_series.tsv
// declarations. The filing agent abbreviates John Hancock Funds as JHF after a
// four-character account code, while the dictionary carries John Hancock.
func TestFamilyRBroadridgeJHFHeading(t *testing.T) {
	rows := familyRISSReconcileRows(t, "R22370_jhf_heading.txt", "0000022370", "broadridge", []SeriesDecl{
		{SeriesID: "S000072133", Name: "John Hancock Mid Cap Growth Fund"},
		{SeriesID: "S000076681", Name: "John Hancock Fundamental Equity Income Fund"},
	})
	if len(rows) != 7 {
		t.Fatalf("got %d real proposals, want 7", len(rows))
	}
	for _, row := range rows {
		if row.IssuerName != "JOHN HANCOCK COLLATERAL TRUST" || row.CUSIP != "926EMC902" || row.MeetingDate != "20220909" || row.HowVoted != "For" {
			t.Fatalf("real proposal precondition: issuer=%q CUSIP=%q date=%q vote=%q", row.IssuerName, row.CUSIP, row.MeetingDate, row.HowVoted)
		}
		if row.SeriesID != "S000072133" {
			t.Errorf("broadridge item %s under heading %q: series=%q, want S000072133 (John Hancock Mid Cap Growth Fund)", row.ItemSeq, row.FundName, row.SeriesID)
		}
	}
}
