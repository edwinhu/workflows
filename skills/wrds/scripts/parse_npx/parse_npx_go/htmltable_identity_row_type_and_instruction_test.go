package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Nomura Partners Funds 2010 (0001193125-10-199355, 3,171 rows with no issuer,
// id or date on r135): the meeting's identity row is `UNIVERSE CO LTD |
// B1VP7B907 | 16-Jul-09 | AGM | Vote For All Proposals | 4,000` under a header
// naming the item columns. The shape reader counted `AGM` and `Vote For All
// Proposals` as issuer names beside the real one and refused the row. A meeting
// type word and a voting instruction are not names.
func TestHTMLTableShapeIdentityRowIgnoresTypeAndInstruction(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H45_identity_row_type_and_instruction.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "UNIVERSE CO LTD" {
			continue
		}
		seen++
		if r[colMeetingDate] != "20090716" || r[colCUSIP] != "B1VP7B907" || r[colHowVoted] != "FOR" {
			t.Fatalf("Universe: date %q cusip %q vote %q, want 20090716 / B1VP7B907 / FOR (%s)", r[colMeetingDate], r[colCUSIP], r[colHowVoted], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no Universe rows among %d", len(rows))
	}
}
