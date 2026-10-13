package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Vanguard Index Funds 2004 (0000932471-04-001061, 24,050 rows with no series
// on r204; 457,261 across the filer agent's 95 single-fund filings of 2004-06):
// the cover block names the fund as `Fund             VANGUARD TOTAL STOCK
// MARKET INDEX FUND`, a column gap where later years print `FUND:`. The name
// is the filing's one fund and stamps every row.
func TestVanguardFundGapLabel(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "vanguard", "V_fund_gap_label.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "1-800 CONTACTS, INC." {
			continue
		}
		seen++
		if r[colFundName] != "VANGUARD TOTAL STOCK MARKET INDEX FUND" {
			t.Fatalf("1-800 Contacts: fund %q (%s)", r[colFundName], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no 1-800 Contacts rows among %d", len(rows))
	}
}
