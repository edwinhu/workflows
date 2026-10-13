package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Northern Lights Fund Trust III 2023 (0001580642-23-004154; the filer agent's
// 107 filings held 42,450 rows with no date on r132): the SEC lettered table
// prints the meeting date as `ANNUAL: 07/01/2022`, the meeting type before a
// colon. The date after the colon is the date, exactly as it is after the
// semicolon of `Annual; 07/10/2012`.
func TestHTMLTableMeetingTypeColonDate(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H41_type_colon_date.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "PLAYAGS, INC." {
			continue
		}
		seen++
		if r[colMeetingDate] != "20220701" || r[colCUSIP] != "72814N104" {
			t.Fatalf("PlayAGS: date %q cusip %q vote %q, want 20220701 / 72814N104 (%s)", r[colMeetingDate], r[colCUSIP], r[colHowVoted], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no PlayAGS rows among %d", len(rows))
	}
}
