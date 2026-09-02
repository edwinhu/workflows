package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXSingleLetterVoteS pins a one-letter Vote Cast cell the vocabulary
// did not hold.
//
//	#     Proposal                                Mgt Rec   Vote Cast    Sponsor
//	2.    Ratify Appointment of Independent       F         S            Management
//	      Auditors
//	1.    Approve Reorganization Plan             F         S            Management
//
// The filer prints Mgt Rec as `F` and the vote as `S`, and the same report
// prints `N` and `S` on its shareholder proposals. The vocabulary already
// accepts the letters F, A, N and D, so the row with `S` was the only one in
// this table that emitted a blank how_voted -- measured 2026-09-01: 244 rows in
// this filing, 289 corpus-wide as `F | S | Management`. how_voted is verbatim;
// the parser reports `S` because that is what was printed.
func TestISSNPXSingleLetterVoteS(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "E1_single_letter_s.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(rows))
	}
	for _, r := range rows {
		if v := r[colHowVoted]; v != "S" {
			t.Errorf("item %s: how_voted = %q, want %q", r[colItemSeq], v, "S")
		}
		if v := r[colMgmtRec]; v != "F" {
			t.Errorf("item %s: management_recommendation = %q, want %q", r[colItemSeq], v, "F")
		}
	}
}
