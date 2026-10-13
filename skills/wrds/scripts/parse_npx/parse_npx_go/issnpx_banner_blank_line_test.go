package main

import (
	"os"
	"path/filepath"
	"testing"
)

// An HTML report renders every line as its own block, so a fund name that wraps
// onto a second banner rule arrives with a WHITESPACE line between the two rules:
//
//	========== Wells Fargo Advantage Diversified Stock Portfolio (Master ===========
//
//	==========                          Trust)                           ===========
//
// (Wells Fargo Master Trust 2010, 0001140361-10-035306 and -035309: 109,230 rows
// under the fund heading "Trust)" on run71). The blank line is not a section
// boundary; the second rule continues the first, and the rows below belong to
// the joined name. A bare rule, or any line of text, still closes the banner.
func TestISSNPXBannerJoinsAcrossABlankLine(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "D6_banner_across_blank_line.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	want := "Wells Fargo Advantage Diversified Stock Portfolio (Master Trust)"
	for _, r := range rows {
		if r[colFundName] != want {
			t.Fatalf("fund name %q, want %q", r[colFundName], want)
		}
	}
}
