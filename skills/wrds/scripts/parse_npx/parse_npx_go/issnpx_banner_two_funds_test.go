package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The blank-line bridge must not glue two funds: Russell Investment Co 2008
// (0001193125-08-188611) prints `=== RIC DIVERSIFIED BOND FUND ===`, a fund with
// no votes, then blank lines, then `=== RIC DIVERSIFIED EQUITY FUND ===` and its
// votes. Bridged, the banner read "RIC DIVERSIFIED BOND FUND RIC DIVERSIFIED
// EQUITY FUND" and the equity fund's rows lost their series (17,665 rows). A
// banner that already names a declared series is complete; the blank line
// after it is a section end.
func TestISSNPXBlankLineDoesNotJoinTwoCompleteBanners(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "D7_banner_blank_lines_two_funds.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colFundName] != "RIC DIVERSIFIED EQUITY FUND" || r[colSeriesID] != "S000001568" {
			t.Fatalf("fund %q series %q, want RIC DIVERSIFIED EQUITY FUND / S000001568", r[colFundName], r[colSeriesID])
		}
	}
}
