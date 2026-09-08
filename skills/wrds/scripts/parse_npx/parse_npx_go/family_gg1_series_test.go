package main

import (
	"path/filepath"
	"testing"
)

func familyGG1Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_gg1", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_gg1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000155/1552947/0001580642-22-004070.txt: 15-16, 684-695, 732-778, 11447.
func TestFamilyGG1RegistrantInHTMLCell(t *testing.T) {
	rows := familyGG1Dispatch(t, "apex_registrant_cell.txt", "htmltable", 3)
	for _, r := range rows {
		if r.CUSIP != "G210A7101" || r.MeetingDate != "20210930" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000072783" {
			t.Errorf("Registrant: APEX HealthCare ETF: fund=%q series=%q want S000072783", r.FundName, r.SeriesID)
		}
	}
}
