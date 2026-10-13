package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Filer agent 1580642's second export shape (0001580642-23-004388, Blue Current
// Global Dividend Fund; 13,177 of the filing's 15,706 rows had no date on run71):
// `Company Name | Primary Ticker Symbol | Security ID | Meeting Date | Proposal
// Long Text | Proposal Short Text | For/Against Recommended Vote | Proposed By |
// Director Name | Vote | Voted Shares | Ballot Shares`, dates as `06-Jul-2022`,
// votes as single letters.
func TestHTMLTableTwelveColumnExport(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H26_twelve_column_export.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) < 2 {
		t.Fatalf("rows = %d, want at least 2", len(rows))
	}
	for _, r := range rows[:2] {
		if r[colIssuerName] != "GSK PLC" || r[colCUSIP] != "37733W105" || r[colMeetingDate] != "20220706" {
			t.Errorf("issuer %q cusip %q date %q (%s)", r[colIssuerName], r[colCUSIP], r[colMeetingDate], r[colVoteDescription])
		}
		if r[colHowVoted] != "F" {
			t.Errorf("how_voted %q, want the verbatim F", r[colHowVoted])
		}
	}
}
