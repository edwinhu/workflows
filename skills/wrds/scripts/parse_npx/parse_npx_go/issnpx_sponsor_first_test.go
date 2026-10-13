package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXSponsorColumnFirst pins the vintage that prints Sponsor BEFORE the
// proposal.
//
//	#     Sponsor        Proposal                        Vote Cast  For/Against
//	01.1  Management     DIRECTOR - ROBERT L. BAGBY      For        For
//
// This header starts with `#` and names `Proposal`, so it is issTableHeader's
// own -- it is not a foreign grammar to decline, and declining would cost every
// row in the filing rather than recovering anything. The columns are simply in a
// different order: the sponsor is the SECOND field, not the last, so peeling it
// from the right finds a vote and abandons the line.
//
// The header states the order, so the fix is to read it. Measured 2026-09-01,
// 0000715165-07-000018.txt is 3,980 blank of 3,982 rows -- effectively all of
// them -- and two sibling filings from the same registrant carry 2,371 and
// 2,300.
func TestISSNPXSponsorColumnFirst(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "DO_sponsor_column_first.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))

	var got []string
	for _, r := range rows {
		if r[colItemSeq] == "01.1" {
			got = r
		}
	}
	if got == nil {
		t.Fatalf("item 01.1 missing; got %d rows", len(rows))
	}
	if got[colVoteDescription] != "DIRECTOR - ROBERT L. BAGBY" {
		t.Errorf("description = %q, want %q", got[colVoteDescription], "DIRECTOR - ROBERT L. BAGBY")
	}
	if got[colVoteSource] != "Management" {
		t.Errorf("sponsor = %q, want %q", got[colVoteSource], "Management")
	}
	if got[colHowVoted] != "For" {
		t.Errorf("how_voted = %q, want %q", got[colHowVoted], "For")
	}
}
