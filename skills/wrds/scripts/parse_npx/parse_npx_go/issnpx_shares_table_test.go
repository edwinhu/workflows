package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXDoesNotClaimTheSharesTable pins a table this layout must NOT read.
//
// One registrant files two grammars in one document. The ISS one this layout
// owns:
//
//	#      Proposal                          Mgt Rec   Vote Cast   Sponsor
//
// and, further down, another administrator's, whose identity columns live in a
// PARALLEL table to the left and whose own header is:
//
//	   Shares
//	Available              Item                          Management     Vote
//	  to Vote Proponet     Number Proposal               Recommendation Instruction
//	     1965 Management   1.1    Elect Director M. Jay Allison    For     For
//
// issTableHeader only recognises a line starting with `#`, so the second header
// does not close the first table. The rows are then read with issnpx's own
// column order: the SHARE COUNT becomes the item number and the whole row lands
// in the proposal text -- and, because the meeting is still the one the `#`
// section set, NRG Energy's votes are filed under Wyeth's CUSIP and meeting
// date. A wrong issuer, not a missing one.
//
// Measured 2026-09-01: 14,471 rows across 74 filings carry this signature.
// Reading the grammar correctly needs the parallel identity table, which is the
// splittable layout's job; what this layout owes is to stop claiming it.
func TestISSNPXDoesNotClaimTheSharesTable(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "D6_shares_table_wrong_meeting.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	for _, r := range runISSNPXDoc(t, string(b)) {
		item := r[colItemSeq]
		if len(item) >= 3 && item[0] >= '1' && item[0] <= '9' && issAllDigits(item) {
			t.Errorf("emitted item %q (cusip %q, %q) -- that is a SHARE COUNT read as an"+
				" item number, and the meeting is the previous section's",
				item, r[colCUSIP], r[colVoteDescription])
		}
	}
}

func issAllDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return len(s) > 0
}
