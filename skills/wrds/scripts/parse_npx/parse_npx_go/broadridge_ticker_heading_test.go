package main

import (
	"os"
	"path/filepath"
	"testing"
)

// RevenueShares ETF Trust 2012 (0001438934-12-000438, 18,687 rows with no
// series): each fund's section is headed by its class TICKER alone (`RWL`), which
// the SGML header declares under the series. A heading that is exactly one
// declared ticker names that series; a ticker two series share names nothing.
func TestBroadridgeTickerHeading(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "broadridge", "B_ticker_heading.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colFundName] != "RWL" || r[colSeriesID] != "S000015929" {
			t.Fatalf("fund %q series %q, want RWL / S000015929 (%s)", r[colFundName], r[colSeriesID], r[colIssuerName])
		}
	}
}
