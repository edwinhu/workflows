package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Brown Capital Management Mutual Funds 2014 (0001209286-14-000432; 1,575
// rows, none dated, on r160b): the identity is two stacked label rows --
// `Ticker | Security ID: | Meeting Date | Meeting Status` over `AKAM | CUSIP
// 00971T101 | 05/14/2014 | | Voted` -- and the CUSIP is read but the date
// beside it is not.
func TestHTMLTableStackedPairsWithSpacer(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H59_stacked_pairs_spacer.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "Akamai Technologies, Inc." {
			continue
		}
		seen++
		if r[colMeetingDate] != "20140514" || r[colCUSIP] != "00971T101" || r[colHowVoted] == "" {
			t.Fatalf("Akamai: date %q cusip %q vote %q (%s)", r[colMeetingDate], r[colCUSIP], r[colHowVoted], r[colVoteDescription])
		}
	}
	if seen < 3 {
		t.Fatalf("%d Akamai rows among %d", seen, len(rows))
	}
}
