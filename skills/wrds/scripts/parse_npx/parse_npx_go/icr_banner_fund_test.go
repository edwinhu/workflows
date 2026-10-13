package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestICRBannerFundHeading pins the icr filing that opens each fund section
// with the '=====' banner rule the ISS report uses, not a `Fund Name :` line:
//
//	========================== CREF Bond Market Account ===========================
//	Oi S.A.
//	...
//	1          Accounts and Reports     Mgmt       For        For        For
//
// icrFundName reads only the labelled line, so these filings stamped no
// series: the College Retirement Equities Fund's icr-era reports are 6.2M
// rows with no fund name read (2026-09-02). The banner is a structural
// marker the corpus prints, and its name is resolved like any other.
func TestICRBannerFundHeading(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "icr", "I9_cref_banner.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows; the Oi S.A. block must parse")
	}
	for _, r := range rows {
		if r[colIssuerName] != "Oi S.A." {
			continue
		}
		if v := r[colSeriesID]; v != "S000005084" {
			t.Errorf("item %s: series_id = %q, want S000005084 (Bond Market Account)", r[colItemSeq], v)
		}
		if v := r[colFundName]; v != "CREF Bond Market Account" {
			t.Errorf("item %s: fund_name = %q, want the banner as printed", r[colItemSeq], v)
		}
	}
}
