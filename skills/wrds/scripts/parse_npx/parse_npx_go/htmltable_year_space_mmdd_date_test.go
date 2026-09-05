package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Heritage Series Trust 2006 (0000898432-06-000742, 3,481 rows with no date on
// r133): the Meeting Date column prints `2005 0715`, the year and the month-day
// with a space between. Read as the date it spells; nothing else in the row is
// date-shaped.
func TestHTMLTableYearSpaceMonthDayDate(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H43_year_space_mmdd_date.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "Dell Inc." {
			continue
		}
		seen++
		if r[colMeetingDate] != "20050715" || r[colCUSIP] != "24702R101" || r[colHowVoted] == "Yes" {
			t.Fatalf("Dell: date %q cusip %q vote %q, want 20050715 / 24702R101 / not the flag (%s)", r[colMeetingDate], r[colCUSIP], r[colHowVoted], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no Dell rows among %d", len(rows))
	}
}
