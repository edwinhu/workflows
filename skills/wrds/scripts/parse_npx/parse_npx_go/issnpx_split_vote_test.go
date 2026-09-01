package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXSplitVote pins the `Split Vote` spelling.
//
//	1.1   Elect Director Benjamin J. Hindson   For   Split Vote   Management
//
// issVoteValues carried `split` but not `split vote`, and issPeelCell matches a
// WHOLE cell rather than a prefix, so all three lengths missed: `For Split
// Vote`, `Split Vote`, `Vote`. The peel then abandoned the line, leaving every
// cell in the proposal text with a blank vote.
//
// A fund reporting `Split Vote` held the security across several accounts that
// voted differently -- it is a real outcome, not an absence, and reporting it
// blank loses that. Measured 2026-09-01 this single filing emits 20,808 blank
// votes of 21,480 rows (96.9%), the largest remaining block in issnpx.
func TestISSNPXSplitVote(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "D9_split_vote.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))

	var seen int
	for _, r := range rows {
		if r[colVoteDescription] == "Elect Director Benjamin J. Hindson" ||
			r[colVoteDescription] == "Elect Director Serge Saxonov" {
			seen++
			if r[colHowVoted] != "Split Vote" {
				t.Errorf("%q: how_voted = %q, want %q",
					r[colVoteDescription], r[colHowVoted], "Split Vote")
			}
			if r[colMgmtRec] != "For" {
				t.Errorf("%q: mgmt_rec = %q, want %q", r[colVoteDescription], r[colMgmtRec], "For")
			}
		}
	}
	if seen != 2 {
		t.Fatalf("found %d of the 2 director rows in %d parsed", seen, len(rows))
	}
}
