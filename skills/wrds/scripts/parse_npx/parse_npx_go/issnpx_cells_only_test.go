package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXCellsOnlyContinuation pins a continuation line carrying ONLY the
// trailing cells.
//
// EDGAR wraps this vintage's paragraphs, so a row arrives split:
//
//	1.1  Elect Director R.J. Alpern  For
//	For  Management
//
// The first line ends after the Mgt Rec cell; the second carries Vote Cast and
// Sponsor and nothing else. issPeelColumns refuses any line of fewer than three
// tokens -- "one proposal-text token, the Vote Cast cell and the Sponsor cell
// are the fewest a row can carry" -- which is true of a ROW and false of a
// CONTINUATION, whose text already sits on the line above. So the peel returned
// the whole line as text and the cells were appended to the description:
//
//	vote_description = "Elect Director R.J. Alpern  For For  Management"
//	how_voted        = ""
//
// Measured 2026-09-01, this filing alone emits 14,711 blank votes of 16,056 rows
// (91.6%), and three of the six worst issnpx filings by blank votes are this
// shape.
func TestISSNPXCellsOnlyContinuation(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "D8_cells_only_continuation.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))

	want := map[string]string{
		"Elect Director R.J. Alpern": "For",
		"Elect Director R.S. Austin": "For",
	}
	got := map[string][]string{}
	for _, r := range rows {
		got[r[colVoteDescription]] = r
	}
	for desc, vote := range want {
		r, ok := got[desc]
		if !ok {
			t.Errorf("row %q missing -- got %d rows", desc, len(rows))
			continue
		}
		if r[colHowVoted] != vote {
			t.Errorf("%q: how_voted = %q, want %q", desc, r[colHowVoted], vote)
		}
		if r[colVoteSource] != "Management" {
			t.Errorf("%q: sponsor = %q, want %q", desc, r[colVoteSource], "Management")
		}
	}
}
