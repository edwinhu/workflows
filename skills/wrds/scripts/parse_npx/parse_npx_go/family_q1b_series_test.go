package main

import (
	"path/filepath"
	"testing"
)

func familyQ1bRows(t *testing.T, path, cik, layout string, decls []SeriesDecl) []VoteRow {
	t.Helper()
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{cik: decls}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(filepath.Base(path), path, sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || meta.CIK != cik || len(sink.buf) == 0 {
		t.Fatalf("fixture/dispatch precondition: CIK=%q layout=%q status=%q rows=%d error=%q", meta.CIK, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	t.Logf("real dispatch: CIK=%s layout=%s rows=%d", meta.CIK, meta.Layout, len(sink.buf))
	return sink.buf
}

// Original 000121/1214511/0001193125-04-149507.txt, verbatim ranges
// 25-26; 37913-37924; 42648-42665 (32 lines). Both dictionary names are
// real cik_series.tsv declarations; /R/ is the filing's registration mark.
func TestFamilyQ1bISSSlashRegistrationMark(t *testing.T) {
	rows := familyQ1bRows(t, filepath.Join("testdata", "family_q1b", "1214511.txt"), "0001214511", "issnpx", []SeriesDecl{
		{SeriesID: "S000002732", Name: "Munder S&P MidCap Index Equity Fund"},
		{SeriesID: "S000002733", Name: "Munder S&P SmallCap Index Equity Fund"},
	})
	if len(rows) != 16 {
		t.Fatalf("got %d real proposals, want 5 MidCap and 11 SmallCap", len(rows))
	}
	for _, c := range []struct {
		start, end        int
		issuer, cusip, id string
	}{
		{0, 5, "3COM CORP.", "885535104", "S000002732"},
		{5, 16, "A. M. CASTLE & CO.", "148411101", "S000002733"},
	} {
		bad := 0
		for _, r := range rows[c.start:c.end] {
			if r.IssuerName != c.issuer || r.CUSIP != c.cusip {
				t.Fatalf("real block identity: issuer=%q cusip=%q", r.IssuerName, r.CUSIP)
			}
			if r.SeriesID != c.id {
				bad++
			}
		}
		if bad != 0 {
			r := rows[c.start]
			t.Errorf("heading %q: %d/%d proposals missing %s; first item=%q series=%q", r.FundName, bad, c.end-c.start, c.id, r.ItemSeq, r.SeriesID)
		}
	}
}
