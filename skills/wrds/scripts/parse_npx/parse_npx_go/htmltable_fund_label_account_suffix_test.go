package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Prudential Investment Portfolios 2004 (0001193125-04-144839, 5,658 rows with
// no fund and no series on this run): each section opens with a three-line
// bold cover block printed between the tables --
//
//	Trust: The Prudential Investment Portfolios, Inc.
//	Manager: Prudential
//	Fund: Jennison Growth Fund #19F2
//
// htmlFundLabelled does not list `fund`, so htmlFundHeading reads nothing, and
// htmlBareFundLine's bare `fund:` branch only records a value that RESOLVES --
// which `Jennison Growth Fund #19F2` does not, because of the trailing `#19F2`
// account code. The declared series is spelled without it.
func TestHTMLTableFundLabelAccountSuffix(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H78_fund_label_account_suffix.txt"))
	if err != nil {
		t.Fatal(err)
	}
	meta := FilingMeta{CompanyName: "PRUDENTIAL INVESTMENT PORTFOLIOS INC", SeriesDecls: []SeriesDecl{
		{SeriesID: "S000004632", Name: "DRYDEN ACTIVE ALLOCATION FUND"},
		{SeriesID: "S000004633", Name: "JENNISON GROWTH FUND"},
		{SeriesID: "S000004634", Name: "JENNISON EQUITY OPPORTUNITY FUND"},
	}}
	rows, err := parseHTMLTableRaw(raw, "", meta)
	if err != nil {
		t.Fatal(err)
	}
	// This grammar leaves the issuer on its own bold row, which this layout does
	// not attach either, so the vote is named by its description.
	seen := 0
	for _, r := range rows {
		if r.VoteDescription != "1.01 Elect James G. Cullen" {
			continue
		}
		seen++
		if r.SeriesID != "S000004633" {
			t.Fatalf("Agilent Technologies 1.01: fund %q series %q, want S000004633 (%s)", r.FundName, r.SeriesID, r.VoteDescription)
		}
	}
	if seen == 0 {
		t.Fatalf("no Agilent Technologies 1.01 row among %d", len(rows))
	}
}
