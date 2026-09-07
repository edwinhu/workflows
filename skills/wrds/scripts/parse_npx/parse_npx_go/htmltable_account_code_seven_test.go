package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Federated Index Trust 2005 (0001318148-05-000481, 19,872 rows with no fund
// on r208): the section heading is `Account Number: 997RK13 Federated Mid-Cap
// Index Fund`, a seven-character account code before the name. The code rule
// stopped at six, so the heading resolved to nothing and no row got a fund.
func TestHTMLTableAccountCodeSevenChars(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H77_account_code_seven_chars.txt"))
	if err != nil {
		t.Fatal(err)
	}
	meta := FilingMeta{SeriesDecls: []SeriesDecl{{SeriesID: "S000009098", Name: "Federated Mid-Cap Index Fund"}, {SeriesID: "S000009099", Name: "Federated Mini-Cap Index Fund"}}}
	rows, err := parseHTMLTableRaw(raw, "", meta)
	if err != nil {
		t.Fatal(err)
	}
	seen := 0
	for _, r := range rows {
		if r.IssuerName != "3Com Corp" {
			continue
		}
		seen++
		if r.SeriesID != "S000009098" {
			t.Fatalf("3Com: fund %q series %q, want S000009098 (%s)", r.FundName, r.SeriesID, r.VoteDescription)
		}
	}
	if seen == 0 {
		t.Fatalf("no 3Com rows among %d", len(rows))
	}
}
