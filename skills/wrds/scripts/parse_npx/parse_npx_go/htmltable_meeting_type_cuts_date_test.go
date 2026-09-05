package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Keeley Funds 2019 (0001144204-19-036120, 3,017 rows with no date on r133):
// the block row prints `Meeting Date: JUL 25, 2018 Meeting Type: Annual`, and
// `Meeting Type:` was not a label the reader cut a value at, so the date value
// ran to the end of the line and parsed as nothing. The type label ends the
// date; it is never read as context of its own.
func TestHTMLTableMeetingTypeLabelCutsTheDate(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H44_meeting_type_cuts_date.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "HILLTOP HOLDINGS INC." {
			continue
		}
		seen++
		if r[colMeetingDate] != "20180725" || r[colCUSIP] != "432748101" {
			t.Fatalf("Hilltop: date %q cusip %q vote %q, want 20180725 / 432748101 (%s)", r[colMeetingDate], r[colCUSIP], r[colHowVoted], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no Hilltop rows among %d", len(rows))
	}
}
