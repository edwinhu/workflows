package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXEchoBare pins the family that prints `Echo` as the whole cell:
//
//	1A    Miscellaneous Corporate Governance        For       Echo       Management
//	1B    Miscellaneous Corporate Governance        For       Echo       Management
//
// Nothing wraps; the next line is the next row. `echo` was kept out of the
// vocabulary so that the OTHER family's `Echo` / `Vote` would be reunited by
// issJoinWrappedVote rather than reported as a fragment. Admitting it moves
// that duty to the row loop, which extends a vote by a continuation that
// completes a longer value -- TestISSNPXEchoVote guards that side. 598 rows
// corpus-wide, 2026-09-01.
func TestISSNPXEchoBare(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "E5_echo_bare.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) != 3 {
		t.Fatalf("got %d rows, want 3", len(rows))
	}
	for _, r := range rows {
		if v := r[colHowVoted]; v != "Echo" {
			t.Errorf("item %s: how_voted = %q, want Echo", r[colItemSeq], v)
		}
		if v := r[colMgmtRec]; v != "For" {
			t.Errorf("item %s: management_recommendation = %q, want For", r[colItemSeq], v)
		}
	}
}
