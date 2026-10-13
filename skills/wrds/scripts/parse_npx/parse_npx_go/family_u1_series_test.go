package main

import (
	"path/filepath"
	"testing"
)

func familyU1Rows(t *testing.T, fixture, cik string, decls []SeriesDecl) []VoteRow {
	t.Helper()
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{cik: decls}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_u1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || len(sink.buf) == 0 || meta.CIK != cik {
		t.Fatalf("dispatch precondition: CIK=%q layout=%q status=%q rows=%d error=%q", meta.CIK, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	t.Logf("dispatch layout=%s rows=%d", meta.Layout, len(sink.buf))
	return sink.buf
}

// 000106/1066980/0000950133-05-003960.txt: 11-26; 45-51;
// 135-153; 10941-10959. Verbatim, including the different subadviser grammar.
func TestFamilyU1VantagepointBareFundBeforeAccount(t *testing.T) {
	rows := familyU1Rows(t, "vantagepoint.txt", "0001066980", []SeriesDecl{
		{SeriesID: "S000008131", Name: "Vantagepoint Growth & Income Fund"},
		{SeriesID: "S000008118", Name: "Vantagepoint Aggressive Opportunities Fund"},
	})
	seen := 0
	for _, row := range rows {
		if row.CUSIP != "88579Y101" || row.MeetingDate != "20050510" {
			continue
		}
		seen++
		if row.SeriesID != "S000008131" {
			t.Errorf("item %s under Vantagepoint Growth & Income Fund: series=%q fund=%q, want S000008131", row.ItemSeq, row.SeriesID, row.FundName)
		}
	}
	if seen != 7 {
		t.Fatalf("real 3M proposal precondition: got %d, want 7", seen)
	}
}

// 000105/1053425/0000950135-05-004942.txt: 11-26; 53-59;
// 98-111; 1136-1150. Verbatim Account Name sections, not Account Number.
func TestFamilyU1HartfordAccountNameSeries(t *testing.T) {
	rows := familyU1Rows(t, "hartford.txt", "0001053425", []SeriesDecl{
		{SeriesID: "S000003205", Name: "HARTFORD ADVISERS HLS FUND"},
		{SeriesID: "S000003216", Name: "HARTFORD CAPITAL APPRECIATION HLS FUND"},
	})
	seen := map[string]int{}
	for _, row := range rows {
		want := ""
		switch row.CUSIP {
		case "88579Y101":
			want = "S000003205"
		case "G0070K103", "Y002A6104":
			want = "S000003216"
		default:
			t.Fatalf("unexpected fixture issuer CUSIP=%q", row.CUSIP)
		}
		seen[want]++
		if row.SeriesID != want {
			t.Errorf("item %s CUSIP=%s under Account Name: series=%q fund=%q, want %s", row.ItemSeq, row.CUSIP, row.SeriesID, row.FundName, want)
		}
	}
	if seen["S000003205"] != 7 || seen["S000003216"] != 7 {
		t.Fatalf("real proposal precondition: got %v, want 7 per section", seen)
	}
}
