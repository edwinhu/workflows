package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestHTMLTableNameAboveBanner pins the vintage that prints the fund's name
// ABOVE the banner and the reporting period under it:
//
//	IVY FUNDS VIP ASSET STRATEGY
//	Proxy Voting Record
//	Vote Summary Report
//	Reporting Period: 07/01/2014 to 06/30/2015
//
// The banner's positional reading took the period as the fund (~500k rows
// named `Reporting Period: ...`, 2026-09-02). A line that resolves to a
// declared series is read first.
func TestHTMLTableNameAboveBanner(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H16_ivy_name_above_banner.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if v := r[colSeriesID]; v != "S000006224" {
			t.Errorf("%s: series_id = %q, want S000006224 (Ivy Funds VIP Asset Strategy)", r[colIssuerName], v)
		}
		// Two printed forms name this fund: the line above the banner and
		// the Institution Account(s) field nearer the table; either is the
		// filing's own text.
		if v := r[colFundName]; v != "IVY FUNDS VIP ASSET STRATEGY" && v != "90 Ivy Funds VIP Asset Strategy" {
			t.Errorf("%s: fund_name = %q", r[colIssuerName], v)
		}
	}
}

// TestHTMLLabelledCells pins the labelled heading printed as two cells of a
// table row, `Fund Name :` | `Putnam Absolute Return 100 Fund` (Putnam, ~1M
// rows with no fund read on 2026-09-02). The whole fund is one 724 KB table
// in the filing, so the reader is pinned here on the cells themselves.
func TestHTMLLabelledCells(t *testing.T) {
	label, value, ok := htmlLabelledCells([]string{" ", "Fund Name :", " Putnam Absolute Return 100 Fund", ""})
	if !ok || label != "Fund Name :" || value != "Putnam Absolute Return 100 Fund" {
		t.Errorf("got %q, %q, %v", label, value, ok)
	}
	if _, _, ok := htmlLabelledCells([]string{"1", "Elect Jaime Ardila", "Mgmt", "For", "For"}); ok {
		t.Error("a vote row is not a labelled pair")
	}
	if _, _, ok := htmlLabelledCells([]string{"Putnam Absolute Return 100 Fund"}); ok {
		t.Error("a single cell is not a labelled pair")
	}
}
