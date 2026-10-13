package main

import (
	"path/filepath"
	"testing"
)

func familyGG2Rows(t *testing.T, fixture, layout, cusip, date string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_gg2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_gg2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	for _, r := range sink.buf {
		if r.CUSIP != cusip || r.MeetingDate != date {
			t.Fatalf("identity precondition: cusip=%q date=%q", r.CUSIP, r.MeetingDate)
		}
	}
	return sink.buf
}

// 000131/1312580/0001193125-05-177801.txt: 25-26, 93-118 (28 verbatim lines).
func TestFamilyGG2AXAStarredFormerlyEGF(t *testing.T) {
	rows := familyGG2Rows(t, "axa_formerly.txt", "issnpx", "00751Y106", "20050518", 12)
	for _, r := range rows {
		if r.SeriesID != "S000008257" {
			t.Errorf("star-delimited former brand: fund=%q series=%q want S000008257", r.FundName, r.SeriesID)
			break
		}
	}
}

// 000079/790558/0000950123-10-081544.txt: 25-26, 2897-2942 (48 verbatim lines).
func TestFamilyGG2ICRMergerNoteAboveReport(t *testing.T) {
	rows := familyGG2Rows(t, "hartford_merger.txt", "icr", "01988P108", "20091008", 13)
	for _, r := range rows {
		if r.SeriesID != "S000004106" {
			t.Errorf("merger note displaces source fund: fund=%q series=%q want S000004106 (not successor S000004104)", r.FundName, r.SeriesID)
			break
		}
	}
}
