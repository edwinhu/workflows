package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXVoteCellWrapsBelow pins a Vote Cast cell that wraps onto the
// lines BELOW its row, in its own column, with nothing else on them:
//
//	1     Election of Directors                   For       No shares    Management
//	                                                        held on
//	                                                        record
//	1     Non-Voting Meeting Note                 None      DNV (do not  Management
//	                                                        vote)
//
// The cell is `No shares held on record` (81 rows, two filings) and
// `DNV (do not vote)` (68 rows, one filing). issJoinWrappedVote reunites a
// head with ONE continuation; the first shape needs two. how_voted is what
// the cell printed, across however many lines the column width forced.
func TestISSNPXVoteCellWrapsBelow(t *testing.T) {
	cases := []struct{ fixture, item, want, mgmt, desc string }{
		{"EI_no_shares_wrapped.txt", "1", "No shares held on record", "For", "Election of Directors"},
		{"EJ_dnv_paren_wrapped.txt", "1", "DNV (do not vote)", "None", "Non-Voting Meeting Note"},
	}
	for _, c := range cases {
		b, err := os.ReadFile(filepath.Join("testdata", "issnpx", c.fixture))
		if err != nil {
			t.Fatalf("read fixture: %v", err)
		}
		rows := runISSNPXDoc(t, string(b))
		if len(rows) != 2 {
			t.Errorf("%s: got %d rows, want 2", c.fixture, len(rows))
			continue
		}
		r := rows[0]
		if v := r[colHowVoted]; v != c.want {
			t.Errorf("%s: how_voted = %q, want %q", c.fixture, v, c.want)
		}
		if v := r[colMgmtRec]; v != c.mgmt {
			t.Errorf("%s: management_recommendation = %q, want %q", c.fixture, v, c.mgmt)
		}
		if v := r[colVoteDescription]; v != c.desc {
			t.Errorf("%s: description = %q, want %q", c.fixture, v, c.desc)
		}
	}
}
