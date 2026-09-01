package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXVotedColumn pins the vintage whose header declares a VOTED column
// between the sponsor and the vote:
//
//	#   Proposal                    Proposal By        Voted   Vote Cast   Management
//	                             Issuer/Stockholder                        Recommendation
//	1   Elect director Jeffrey P. Bezos   Issuer   Yes   For   For
//
// The header starts with `#` and names `Proposal`, so issTableHeader claims it
// -- correctly: nothing else in the registry reads this document, which has no
// other table grammar at all, so declining would turn 247 blank rows into zero
// rows. The columns are simply the vanguard set in issnpx's clothing: sponsor
// SECOND, then Voted (Yes/No), then Vote Cast, then the recommendation.
// Peeling a sponsor off the right finds `For` and abandons every line.
//
// The header states the order, so it is read. Measured 2026-09-01: 247 of 247
// rows blank in this filing, ~660 across the registrant's three.
func TestISSNPXVotedColumn(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "DV_voted_column.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	got := findRow(rows, "Elect director Jeffrey P. Bezos")
	if got == nil {
		t.Fatalf("row missing; got %d rows", len(rows))
	}
	if got[colHowVoted] != "For" {
		t.Errorf("how_voted = %q, want %q", got[colHowVoted], "For")
	}
	if got[colMgmtRec] != "For" {
		t.Errorf("mgmt_rec = %q, want %q", got[colMgmtRec], "For")
	}
	if got[colVoteSource] != "Issuer" {
		t.Errorf("sponsor = %q, want %q", got[colVoteSource], "Issuer")
	}
	if got[colVoteOtherInfo] != "Yes" {
		t.Errorf("voted? = %q, want %q", got[colVoteOtherInfo], "Yes")
	}
}
