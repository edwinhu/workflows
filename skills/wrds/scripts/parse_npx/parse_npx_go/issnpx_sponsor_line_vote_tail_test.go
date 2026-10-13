package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXSponsorLineThenVoteTail pins the vintage that prints Sponsor on
// its own line below the row, when the vote ALSO wraps:
//
//	1     Open Meeting                              Null      Did Not
//	Management
//	                                                          Vote
//
// The look-back join anchors on the line whose tail is a sponsor; here that
// line holds nothing else, and the vote's head is the line above it. 213
// rows in the corpus's largest ISS filing, 2026-09-02.
func TestISSNPXSponsorLineThenVoteTail(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "ER_sponsor_line_then_vote_tail.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) < 3 {
		t.Fatalf("got %d rows, want at least 3 -- item lines ending in the head of a wrapped vote must open rows", len(rows))
	}
	r := rows[0]
	if v := r[colHowVoted]; v != "Did Not Vote" {
		t.Errorf("item 1: how_voted = %q, want %q", v, "Did Not Vote")
	}
	if v := r[colMgmtRec]; v != "Null" {
		t.Errorf("item 1: management_recommendation = %q, want Null", v)
	}
	if v := r[colVoteSource]; v != "Management" {
		t.Errorf("item 1: sponsor = %q, want Management", v)
	}
	if v := r[colVoteDescription]; v != "Open Meeting" {
		t.Errorf("item 1: description = %q, want %q", v, "Open Meeting")
	}
	for i := 1; i < 3; i++ {
		if v := rows[i][colHowVoted]; v != "Did Not Vote" {
			t.Errorf("row %d: how_voted = %q, want %q", i, v, "Did Not Vote")
		}
	}
	if v := rows[1][colVoteDescription]; v != "Elect Georg Ehrnrooth as Chairman of Meeting" {
		t.Errorf("item 2: description = %q", v)
	}
}
