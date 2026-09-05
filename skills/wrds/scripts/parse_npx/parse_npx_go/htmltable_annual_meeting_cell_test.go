package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Mutual Fund Series Trust 2012 (0000910472-12-002680; two filings, 4,658 rows
// with no date on r154): the identity row is `2 | Royal Dutch Shell | RDS.B |
// 780259206 | 5/22/2012 | Annual Meeting` under a header naming the item
// columns, and the shape reader counted `Annual Meeting` as a second name. A
// meeting-type phrase is not a name.
func TestHTMLTableAnnualMeetingCellIsNotAName(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H51_annual_meeting_cell.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "Royal Dutch Shell" {
			continue
		}
		seen++
		if r[colMeetingDate] != "20120522" || r[colCUSIP] != "780259206" {
			t.Fatalf("Shell: date %q cusip %q (%s)", r[colMeetingDate], r[colCUSIP], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no Royal Dutch Shell rows among %d", len(rows))
	}
}
