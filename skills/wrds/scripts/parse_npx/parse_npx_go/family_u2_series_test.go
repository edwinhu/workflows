package main

import (
	"path/filepath"
	"testing"
)

func familyU2Rows(t *testing.T, fixture, cik string, decls []SeriesDecl) []VoteRow {
	t.Helper()
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{cik: decls}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_u2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.CIK != cik || len(sink.buf) == 0 {
		t.Fatalf("fixture/dispatch precondition: CIK=%q layout=%q status=%q rows=%d error=%q", meta.CIK, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	wantLayout := "pvtext"
	if fixture == "pacific_growth.txt" {
		wantLayout = "issnpx"
	}
	if meta.Layout != wantLayout {
		t.Fatalf("layout=%q, want %q", meta.Layout, wantLayout)
	}
	t.Logf("real dispatch: layout=%s rows=%d", meta.Layout, len(sink.buf))
	return sink.buf
}

// 000081/813900/0000813900-04-000016.txt: 11-26; 50; 115-137.
func TestFamilyU2PacificGrowthHeading(t *testing.T) {
	rows := familyU2Rows(t, "pacific_growth.txt", "0000813900", []SeriesDecl{
		{SeriesID: "S000026024", Name: "Growth LT Portfolio"},
		{SeriesID: "S000026029", Name: "Mid-Cap Value Portfolio"},
	})
	for _, row := range rows {
		if row.CUSIP != "019589308" || row.MeetingDate != "20031218" {
			t.Fatalf("real meeting precondition: CUSIP=%q date=%q", row.CUSIP, row.MeetingDate)
		}
		if row.SeriesID != "S000026024" {
			t.Errorf("item %s under Pacific Select Fund Growth LT Portfolio: series=%q fund=%q, want S000026024", row.ItemSeq, row.SeriesID, row.FundName)
		}
	}
}

// 000100/1006415/0000950135-04-004123.txt: 11-26; 55-61; 98-109; 1088-1093.
func TestFamilyU2HartfordAccountHeading(t *testing.T) {
	rows := familyU2Rows(t, "hartford_account.txt", "0001006415", []SeriesDecl{
		{SeriesID: "S000003571", Name: "HARTFORD ADVISERS FUND"},
		{SeriesID: "S000003604", Name: "HARTFORD CAPITAL APPRECIATION FUND"},
	})
	seen := map[string]bool{}
	for _, row := range rows {
		want := "S000003571"
		if row.CUSIP == "458727104" {
			want = "S000003604"
		}
		if row.CUSIP == "" || row.MeetingDate == "" {
			t.Fatalf("real meeting precondition: CUSIP=%q date=%q", row.CUSIP, row.MeetingDate)
		}
		seen[want] = true
		if row.SeriesID != want {
			t.Errorf("CUSIP %s item %s under Account Name heading: series=%q fund=%q, want %s", row.CUSIP, row.ItemSeq, row.SeriesID, row.FundName, want)
		}
	}
	if len(seen) != 2 {
		t.Fatalf("fixture must emit rows under both real account headings: %v", seen)
	}
}

// 000089/890453/0000935069-04-001304.txt: 11-26; 62-68;
// 52168-52181; 54062; 55805-55819; 57920.
func TestFamilyU2WilshireGrowthHeading(t *testing.T) {
	rows := familyU2Rows(t, "wilshire_growth.txt", "0000890453", []SeriesDecl{
		{SeriesID: "S000001045", Name: "LARGE COMPANY GROWTH PORTFOLIO"},
		{SeriesID: "S000001046", Name: "LARGE COMPANY VALUE PORTFOLIO"},
		{SeriesID: "S000001049", Name: "DOW JONES WILSHIRE 5000 INDEX PORTFOLIO"},
	})
	if len(rows) != 14 {
		t.Fatalf("got %d real proposals, want 7 in each of two sections", len(rows))
	}
	for i, row := range rows {
		if row.CUSIP != "88579Y101" || row.MeetingDate != "20040511" {
			t.Fatalf("real meeting precondition: CUSIP=%q date=%q", row.CUSIP, row.MeetingDate)
		}
		want := "S000001045"
		if i >= 7 {
			want = "S000001046"
		}
		if row.SeriesID != want {
			t.Errorf("row %d item %s under dated portfolio heading: series=%q fund=%q, want %s", i, row.ItemSeq, row.SeriesID, row.FundName, want)
		}
	}
}
