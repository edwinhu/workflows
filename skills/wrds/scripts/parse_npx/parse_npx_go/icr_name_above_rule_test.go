package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestICRNameAboveUnderscoreRule pins the icr vintage that names the fund on
// a bare line above a rule of underscores:
//
//	Equity Index 500 Fund
//	________________________________________________________________________
//	3M Company
//
// The line is taken only when it resolves to a declared series (here
// through the registrant-brand rule: `T. Rowe Price Equity Index 500 Fund`),
// so an issuer name above the same rule is never mistaken for a fund.
func TestICRNameAboveUnderscoreRule(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "icr", "I11_trowe_name_above_rule.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if v := r[colSeriesID]; v != "S000002089" {
			t.Errorf("%s: series_id = %q, want S000002089", r[colIssuerName], v)
		}
	}
}

func TestICRFundNameLabelPortfolio(t *testing.T) {
	if name, ok := icrFundName("Portfolio Name: ON AB Small Cap Portfolio"); !ok || name != "ON AB Small Cap Portfolio" {
		t.Errorf("got %q,%v", name, ok)
	}
}
