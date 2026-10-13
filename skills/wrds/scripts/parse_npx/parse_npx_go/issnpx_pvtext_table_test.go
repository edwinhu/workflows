package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestISSNPXDoesNotClaimThePVTextTable is the third foreign grammar this layout
// must decline, after the shares table (8e0fc1fd) and the HTML summary table
// (3e8aabb9).
//
//	ISSUER NAME              TICKER    CUSIP     MTG DATE   MTG TYPE
//	                                             PROPOSAL TYPE  VOTED?  VOTE  FOR/AGNST MGMT
//	3M CO                    MMM       88579Y101 5/10/05    ANNUAL
//	    1.01  Elect Vance D. Coffman                MGMT      YES     FOR   FOR
//
// The proponent comes FIRST and a VOTED? column follows it, so the sponsor is
// not at the right edge where issPeelColumns looks. The peel fails on every row
// and the whole line becomes proposal text with a blank vote. That column order
// is the pvtext layout's, and pvtext reads it correctly -- 0000935069-05-002185
// carries 121 ISS sections and 5 of these, so the filing is claimed here and
// these sections are the part this layout cannot read.
func TestISSNPXDoesNotClaimThePVTextTable(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "DB_pvtext_table.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	for _, r := range runISSNPXDoc(t, string(b)) {
		if strings.Contains(r[colVoteDescription], "MGMT") ||
			strings.Contains(r[colVoteDescription], "SHLDR") {
			t.Errorf("emitted %q with vote %q -- the cells are inside the proposal text",
				r[colVoteDescription], r[colHowVoted])
		}
	}
}
