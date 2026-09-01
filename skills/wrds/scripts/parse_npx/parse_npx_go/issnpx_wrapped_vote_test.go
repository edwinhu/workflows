package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestISSNPXWrappedVoteCell pins a VOTE CELL that wraps.
//
// The proposal text is not the only column that runs onto a second physical
// line -- the vote does too, and `Did Not Vote` is printed as `Did Not` above
// `Vote`:
//
//	1     Accept 2005 Operating Results and    For      Did Not    Management
//	      Financial Statements                          Vote
//
// Read one line at a time the vote is `Did Not`, which is in no vocabulary, so
// the row emits a BLANK how_voted and the whole trailing cell block stays in the
// proposal text: `Accept 2005 Operating Results and  For  Did Not  Management`.
//
// Measured 2026-09-01 on two filings of this family, 961 of 14,680 rows (6.55%)
// are blank this way, and issnpx carries 2,275,259 blank votes corpus-wide
// against 166,403,081 rows. The value is not rare: `Did Not Vote` is what a fund
// reports when it held the security but the ballot never reached it.
func TestISSNPXWrappedVoteCell(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "D4_wrapped_vote_cell.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))

	var got []string
	for _, r := range rows {
		if strings.HasPrefix(r[colVoteDescription], "Accept 2005 Operating Results") {
			got = r
		}
	}
	if got == nil {
		t.Fatalf("the Accept 2005 Operating Results row is missing; got %d rows", len(rows))
	}
	if v := got[colHowVoted]; v != "Did Not Vote" {
		t.Errorf("how_voted = %q, want %q", v, "Did Not Vote")
	}
	if d := got[colVoteDescription]; strings.Contains(d, "Did Not") || strings.Contains(d, "Management") {
		t.Errorf("description %q still carries the trailing cells", d)
	}
}
