package main

import (
	"path/filepath"
	"testing"
)

func familyX2Rows(t *testing.T, fixture, cik, layout string, decls []SeriesDecl) []VoteRow {
	t.Helper()
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{cik: decls}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_x2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) == 0 {
		t.Fatalf("fixture/dispatch: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	t.Logf("dispatch layout=%s rows=%d", meta.Layout, len(sink.buf))
	return sink.buf
}

// 000107/1070222/0000950152-05-007320.txt: 25-26, 84-109.
func TestFamilyX2NewCovenantAlphanumericAccount(t *testing.T) {
	rows := familyX2Rows(t, "new_covenant.txt", "0001070222", "pvtext", []SeriesDecl{
		{SeriesID: "S000005023", Name: "New Covenant Balanced Growth Fund"},
		{SeriesID: "S000024940", Name: "New Covenant Balanced Income Fund"},
		{SeriesID: "S000024941", Name: "New Covenant Growth Fund"},
		{SeriesID: "S000024942", Name: "New Covenant Income Fund"},
	})
	if len(rows) != 14 {
		t.Fatalf("expected 14 ABN Amro votes, got %d", len(rows))
	}
	for _, r := range rows {
		if r.CUSIP != "N0030P459" || r.MeetingDate != "20050425" {
			t.Fatalf("identity precondition: %+v", r)
		}
		if r.SeriesID != "S000024941" {
			t.Errorf("fund=%q CUSIP=%s series=%q, want S000024941", r.FundName, r.CUSIP, r.SeriesID)
		}
	}
}

// 000148/1487592/0000894189-11-003893.txt: 15-16, 146-176, 4052-4075.
func TestFamilyX2IronBridgePeriodAfterHeading(t *testing.T) {
	rows := familyX2Rows(t, "ironbridge.txt", "0001487592", "broadridge", []SeriesDecl{
		{SeriesID: "S000029166", Name: "IronBridge Global Fund"},
		{SeriesID: "S000029167", Name: "IronBridge SMID Cap Fund"},
		{SeriesID: "S000029168", Name: "IronBridge Small Cap Fund"},
		{SeriesID: "S000029169", Name: "IronBridge Large Cap Fund"},
		{SeriesID: "S000030486", Name: "IronBridge Horizon Fund"},
		{SeriesID: "S000030487", Name: "IronBridge Skyline Fund"},
	})
	seen := map[string]bool{}
	for _, r := range rows {
		want := "S000029166"
		if r.CUSIP == "831865209" {
			want = "S000030486"
		}
		if r.CUSIP == "" || r.MeetingDate == "" {
			t.Fatalf("identity precondition: %+v", r)
		}
		seen[want] = true
		if r.SeriesID != want {
			t.Errorf("fund=%q CUSIP=%s series=%q, want %s", r.FundName, r.CUSIP, r.SeriesID, want)
		}
	}
	if len(seen) != 2 {
		t.Fatalf("expected both real fund sections, got %v", seen)
	}
}

// 000101/1013881/0001193125-12-372734.txt: 15-16, 471-485, 8639-8665.
func TestFamilyX2NuveenManagerBanner(t *testing.T) {
	rows := familyX2Rows(t, "nuveen.txt", "0001013881", "issnpx", []SeriesDecl{
		{SeriesID: "S000000602", Name: "Nuveen Multi-Manager Large-Cap Value Fund"},
		{SeriesID: "S000000603", Name: "Nuveen Moderate Allocation Fund"},
		{SeriesID: "S000000604", Name: "Nuveen Conservative Allocation Fund"},
		{SeriesID: "S000000605", Name: "Nuveen NWQ Multi-Cap Value Fund"},
	})
	if len(rows) != 5 {
		t.Fatalf("expected five ACE votes, got %d", len(rows))
	}
	for _, r := range rows {
		if r.CUSIP != "H0023R105" || r.MeetingDate == "" {
			t.Fatalf("identity precondition: %+v", r)
		}
		if r.SeriesID != "S000000602" {
			t.Errorf("fund=%q series=%q, want S000000602", r.FundName, r.SeriesID)
		}
	}
}
