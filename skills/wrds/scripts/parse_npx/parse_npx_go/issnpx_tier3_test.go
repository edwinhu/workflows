package main

import (
	"strings"
	"testing"
)

// Three more Vote Cast forms, from the ranking on the 27-commit build.
//
//	1     Approve Individual and Consolidated  For  Did Note Vote  Management
//	1.1   Elect  Director Richard L. Clemmer   For  Not Cast       Management
//
// `Did Note Vote` is the filing's own typo for `Did Not Vote`, and how_voted is
// verbatim, so the spelling is recorded as printed rather than corrected. `Not
// Cast` was simply missing. Measured: 1,264 rows and 463.
//
// A THIRD class from the same ranking is deliberately absent. 4,052 rows print
//
//	                                            Vote Cast
//	                                Mgt    ------------------
//	#     Proposal                  Rec    For       Withhold      Sponsor
//	1.01  Elect Nominee             For    100.000%  0.000%        Management
//
// where Vote Cast spans TWO sub-columns and the vote is a distribution, not a
// choice. No single cell is the vote, so recording either percentage as
// how_voted would invent a value the filing never printed there.
func TestISSNPXDidNoteVoteTypo(t *testing.T) {
	rows := loadSpellingFixture(t, "DR_did_note_vote.txt")
	got := findRow(rows, "Approve Individual and Consolidated")
	if got == nil {
		t.Fatalf("row missing; got %d rows", len(rows))
	}
	if got[colHowVoted] != "Did Note Vote" {
		t.Errorf("how_voted = %q, want %q -- the filing's own spelling", got[colHowVoted], "Did Note Vote")
	}
}

func TestISSNPXNotCast(t *testing.T) {
	rows := loadSpellingFixture(t, "DS_not_cast.txt")
	var got []string
	for _, r := range rows {
		if strings.Contains(r[colVoteDescription], "Richard L. Clemmer") {
			got = r
		}
	}
	if got == nil {
		t.Fatalf("row missing; got %d rows", len(rows))
	}
	if got[colHowVoted] != "Not Cast" {
		t.Errorf("how_voted = %q, want %q", got[colHowVoted], "Not Cast")
	}
}
