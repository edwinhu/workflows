package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Mutual Fund Series Trust 2018 (0001580642-18-004117, 1,433 rows with no date
// on r139): the SEC lettered table heads its date column `(d) Shareholder
// Meeting Type & Date` and prints the date alone beneath it. The label names
// the date column.
func TestHTMLTableMeetingTypeAndDateLabel(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H47_meeting_type_and_date_label.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "Vanguard" {
			continue
		}
		seen++
		if r[colMeetingDate] != "20171115" || r[colCUSIP] != "922042858" {
			t.Fatalf("Vanguard: date %q cusip %q vote %q, want 20171115 / 922042858 (%s)", r[colMeetingDate], r[colCUSIP], r[colHowVoted], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no Vanguard rows among %d", len(rows))
	}
}
