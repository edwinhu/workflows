package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestICRBareNameBeforeReport pins the icr vintage that names each fund on a
// bare line immediately above its `Investment Company Report` line:
//
//	The Hartford Advisers Fund
//	Investment Company Report
//	07/01/10 - 06/30/11
//
// No label, no banner, so these filings stamped no series (Hartford Mutual
// Funds, three filings, ~180k rows, 2026-09-02). The report line is the
// structural marker; the line above it is resolved like any other heading.
func TestICRBareNameBeforeReport(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "icr", "I10_hartford_bare_name.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows; the first fund's blocks must parse")
	}
	for _, r := range rows[:min(len(rows), 20)] {
		if v := r[colSeriesID]; v != "S000003571" {
			t.Errorf("item %s (%s): series_id = %q, want S000003571 (Hartford Advisers Fund)", r[colItemSeq], r[colIssuerName], v)
		}
	}
}
