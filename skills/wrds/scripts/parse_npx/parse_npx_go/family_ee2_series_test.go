package main

import (
	"path/filepath"
	"testing"
)

func familyEE2DispatchRow(t *testing.T, fixture, layout, cusip, date string, rows int) VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ee2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ee2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != rows {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	r := sink.buf[0]
	if r.CUSIP != cusip || r.MeetingDate != date || r.HowVoted != "For" {
		t.Fatalf("identity/vote precondition: CUSIP=%q date=%q vote=%q", r.CUSIP, r.MeetingDate, r.HowVoted)
	}
	return r
}

// 000086/868307/0000950123-05-010511.txt: 25-26, 116-135 (22 verbatim lines).
func TestFamilyEE2MainstayFKAHeading(t *testing.T) {
	r := familyEE2DispatchRow(t, "mainstay_fka.txt", "issnpx", "002824PPH", "20050422", 1)
	if r.SeriesID != "S000010101" {
		t.Errorf("MainStay All Cap Value FKA Eclipse Value Equity: fund=%q series=%q want S000010101", r.FundName, r.SeriesID)
	}
}

// 000086/864508/0001534424-16-000897.txt: 15-16, 48-51, 62-66, 82,
// 256, 357, 404-405, 444-463, 484-523, 95454 (77 verbatim lines).
// Three intact vote rows satisfy htmlHeaderConfirm without inventing a header.
// Two declared siblings preserve the full filing's dictionary-only Balanced Fund.
func TestFamilyEE2HTMLCellDictionaryHeading(t *testing.T) {
	r := familyEE2DispatchRow(t, "cavanal_cell_dictionary.txt", "htmltable", "88579Y101", "20160510", 3)
	if r.SeriesID != "S000008937" {
		t.Errorf("Cavanal Hill Balanced Fund cell: fund=%q series=%q want S000008937", r.FundName, r.SeriesID)
	}
}
