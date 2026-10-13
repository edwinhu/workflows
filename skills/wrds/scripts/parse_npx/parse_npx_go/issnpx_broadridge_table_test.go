package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestISSNPXDoesNotClaimTheBroadridgeTable is the FOURTH foreign grammar this
// layout must decline, after the shares table (8e0fc1fd), the HTML summary
// table (3e8aabb9) and the pvtext column order (0bc2d90e).
//
//	                                                       FOR/AGAINST
//	ITEM   PROPOSAL              TYPE          VOTE        MANAGEMENT
//	 01    DIRECTOR              Management
//	       1    LINDA G. ALVARADO              For         For
//
// The TYPE column carries the sponsor and sits BEFORE the votes, and a director
// slate puts it on the slate's own line while each nominee carries votes alone.
// issPeelColumns needs a sponsor at the right edge, so every nominee row fails
// the peel and lands in the proposal text with a blank vote.
//
// 0000950152-06-007352.txt mixes both grammars -- 247 ISS sections and 366 of
// these -- and 4,061 of its 6,500 rows are blank because of it. That column
// order is the broadridge layout's, and broadridge reads it correctly.
func TestISSNPXDoesNotClaimTheBroadridgeTable(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "DK_broadridge_table.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))

	for _, r := range rows {
		if strings.Contains(r[colVoteDescription], "ALVARADO") ||
			strings.Contains(r[colVoteDescription], "LIDDY") {
			t.Errorf("emitted %q vote=%q -- a nominee of the broadridge-format slate",
				r[colVoteDescription], r[colHowVoted])
		}
	}

	// The ISS section above it must still be read.
	var seen bool
	for _, r := range rows {
		if r[colVoteDescription] == "Elect Director Terry S. Semel" && r[colHowVoted] == "For" {
			seen = true
		}
	}
	if !seen {
		t.Errorf("the ISS section above the foreign table was lost; got %d rows", len(rows))
	}
}
