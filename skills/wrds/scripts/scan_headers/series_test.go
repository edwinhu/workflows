package main

import (
	"os"
	"path/filepath"
	"testing"
)

func fixture(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "npx_2007_header.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return b
}

func TestScanTop(t *testing.T) {
	acc, form, filed := scanTop(fixture(t))
	if acc != "0001104659-07-066582" {
		t.Errorf("accession = %q", acc)
	}
	if form != "N-PX" {
		t.Errorf("form = %q", form)
	}
	if filed != "20070831" {
		t.Errorf("filed = %q", filed)
	}
}

func TestParseSeriesBlock(t *testing.T) {
	rows := parseSeriesBlock(fixture(t), "p.txt", "acc", "N-PX", "20070831")

	// 1 class + 2 classes + 1 classless series = 4 rows.
	if len(rows) != 4 {
		t.Fatalf("rows = %d, want 4: %+v", len(rows), rows)
	}

	// Every triple is kept — a first-match regex would return one.
	sids := map[string]int{}
	for _, r := range rows {
		sids[r.seriesID]++
		if r.ownerCIK != "0001209466" {
			t.Errorf("ownerCIK = %q on %+v", r.ownerCIK, r)
		}
	}
	if sids["S000003023"] != 1 || sids["S000003024"] != 2 || sids["S000003030"] != 1 {
		t.Errorf("series row counts = %v", sids)
	}

	if rows[0].classID != "C000008290" || rows[0].classTicker != "PWC" {
		t.Errorf("row 0 = %+v", rows[0])
	}
	if rows[0].seriesName != "PowerShares Dynamic Market Portfolio" {
		t.Errorf("row 0 seriesName = %q", rows[0].seriesName)
	}

	// A class with no ticker keeps the class and leaves the ticker empty; it
	// must not inherit the previous class's ticker.
	if rows[2].classID != "C000008299" || rows[2].classTicker != "" {
		t.Errorf("row 2 = %+v", rows[2])
	}

	// A series with no class contract still emits, with class fields empty.
	last := rows[3]
	if last.seriesID != "S000003030" || last.classID != "" {
		t.Errorf("classless series row = %+v", last)
	}
}

func TestScrubStripsDelimiters(t *testing.T) {
	if got := scrub(" a\tb\r\n "); got != "a b" {
		t.Errorf("scrub = %q", got)
	}
}
