package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Tributary Funds 2021 (0001435109-21-000183, 4,426 rows with no date and no
// vote): the date column is headed `Shareholder Meeting Date`, the vote column
// `How Vote was Cast (F=For, ...)` beside a `Did Fund Cast Vote on Matter (Y/N)`
// flag, and a colspan puts the header's spacer blank after the cusip while the
// rows' blank follows the date. The synonyms are known, the flag is a flag, and
// the row is realigned under the header before it is read.
func TestHTMLTableShareholderMeetingDateLabel(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H36_shareholder_meeting_date.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := false
	for _, r := range rows {
		if r[colIssuerName] == "CONSTELLATION BRANDS, INC." {
			seen = true
			if r[colMeetingDate] != "20200721" || r[colHowVoted] != "F" || r[colCUSIP] != "21036P108" {
				t.Fatalf("Constellation: date %q vote %q cusip %q, want 20200721 / F / 21036P108 (%s)", r[colMeetingDate], r[colHowVoted], r[colCUSIP], r[colVoteDescription])
			}
		}
	}
	if !seen {
		t.Fatal("no Constellation rows")
	}
}
