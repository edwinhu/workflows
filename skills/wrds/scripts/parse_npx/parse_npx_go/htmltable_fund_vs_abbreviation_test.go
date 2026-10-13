package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Columbia Funds Variable Insurance Trust 2007 (0001104659-07-066494, 9,934
// rows with no series on this run): the heading is a `Fund Name :` label whose
// value WRAPS onto the next line --
//
//	Fund Name :
//	Columbia International Fund, VS
//
// icrFundName reads the label line alone and returns an empty value, so
// htmlFundHeading clears the fund; and htmlBareFundLine's wrap join does not
// record it either, because the trust abbreviates `Variable Series` to `VS`
// while every declared series spells it out, so the joined name resolves to
// nothing.
func TestHTMLTableFundVSAbbreviation(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H79_fund_vs_abbreviation.txt"))
	if err != nil {
		t.Fatal(err)
	}
	meta := FilingMeta{CompanyName: "COLUMBIA FUNDS VARIABLE INSURANCE TRUST", SeriesDecls: []SeriesDecl{
		{SeriesID: "S000012559", Name: "Columbia International Fund, Variable Series"},
		{SeriesID: "S000012561", Name: "Columbia Small Cap Value Fund, Variable Series"},
		{SeriesID: "S000012563", Name: "Columbia S&P 500 Index Fund, Variable Series"},
	}}
	rows, err := parseHTMLTableRaw(raw, "", meta)
	if err != nil {
		t.Fatal(err)
	}
	seen := 0
	for _, r := range rows {
		if r.IssuerName != "Astrazeneca PLC" {
			continue
		}
		seen++
		if r.SeriesID != "S000012559" {
			t.Fatalf("Astrazeneca PLC: fund %q series %q, want S000012559 (%s)", r.FundName, r.SeriesID, r.VoteDescription)
		}
	}
	if seen == 0 {
		t.Fatalf("no Astrazeneca PLC rows among %d", len(rows))
	}
}
