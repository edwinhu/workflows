package main

import (
	"os"
	"path/filepath"
	"testing"
)

// O'Shares / FQF Trust 2018: `... | Proposal Text | Vote Instruction | Voted |
// Vote Against Management | ...`. "Voted" answers WHETHER the fund cast a ballot
// (Yes/No); the vote is the "Vote Instruction" column. The layout took "Voted" as
// the vote and emitted "Yes" as how_voted on 103,215 matched rows, 4,759 of them
// against an ISS vote of AGAINST -- a Yes/No flag can never be the vote when the
// same header names the instruction itself.
func TestHTMLTableVotedFlagBesideVoteInstruction(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H22_voted_flag_column.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) != 6 {
		t.Fatalf("rows = %d, want 6", len(rows))
	}
	for _, r := range rows {
		if r[colHowVoted] != "For" {
			t.Errorf("how_voted %q, want the Vote Instruction cell \"For\" (issuer %q, desc %q)", r[colHowVoted], r[colIssuerName], r[colVoteDescription])
		}
		if r[colIssuerName] != "Johnson Electric Holdings Ltd." || r[colCUSIP] != "G5150J140" || r[colMeetingDate] != "20170712" {
			t.Errorf("issuer %q cusip %q date %q", r[colIssuerName], r[colCUSIP], r[colMeetingDate])
		}
	}
}
