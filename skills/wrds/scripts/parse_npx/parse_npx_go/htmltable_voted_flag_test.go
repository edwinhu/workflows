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

// The 2005 `Proposal Type | Voted | Vote | For/Agnst Mgmt` export: once "Vote"
// holds the vote, "Voted" is the did-vote flag. A row the fund did NOT vote
// prints Voted=NO with an empty Vote cell; it is a real agenda item, not table
// furniture, and it stays as a row with an empty vote and the flag recorded --
// on run65 the flag WAS the vote ("YES"/"NO"), and dropping the flag alone cost
// 59,588 rows on the htmltable-scoped run s72.
func TestHTMLTableVotedFlagKeepsUnvotedRows(t *testing.T) {
	mapping := htmlMapFields([]string{"Proposal Type", "Voted", "Vote", "For/Agnst Mgmt"})
	if mapping[htmlFieldVote] != 2 {
		t.Fatalf("vote column = %d, want 2 (Vote), mapping %v", mapping[htmlFieldVote], mapping)
	}
	r, ok := htmlDataRow([]string{"Elect Vance D. Coffman", "YES", "FOR", "FOR"}, mapping, 4, htmlContext{})
	if !ok || r.HowVoted != "FOR" {
		t.Fatalf("voted row: ok %v how_voted %q, want FOR", ok, r.HowVoted)
	}
	r, ok = htmlDataRow([]string{"Elect Vance D. Coffman", "NO", "", "FOR"}, mapping, 4, htmlContext{})
	if !ok || r.HowVoted != "" || r.VoteOtherInfo != "Voted: NO" {
		t.Fatalf("unvoted row: ok %v how_voted %q other %q, want kept with empty vote and 'Voted: NO'", ok, r.HowVoted, r.VoteOtherInfo)
	}
	// Furniture stays furniture: no flag value, no vote, no row.
	if _, ok := htmlDataRow([]string{"", "", "", ""}, mapping, 4, htmlContext{}); ok {
		t.Fatal("an empty row was emitted")
	}
}
