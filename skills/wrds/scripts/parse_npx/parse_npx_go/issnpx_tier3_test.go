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

// Frequency votes spelled with a hyphen -- from the ranking on the 31-commit
// build, ~780 rows across two filings:
//
//	ADVISORY APPROVAL OF THE FREQUENCY OF   1 - Year   1 - Year   Management
//	Say When on Pay - An advisory vote on   1-Year     1-Year     Management
//
// `one year`, `1 year` and `1 yr` were already carried; the hyphenated forms
// were not. Counted in the two filings: `1 - Year` 394, `3 - Year` 16,
// `1-Year` 422, `3-Years` 15. No 2-year form appears and none is admitted.
func TestISSNPXHyphenatedFrequencyVote(t *testing.T) {
	for _, c := range []struct{ fixture, prefix, want string }{
		{"DW_spaced_hyphen_year.txt", "ADVISORY APPROVAL OF THE FREQUENCY", "1 - Year"},
		{"DX_hyphen_year.txt", "Say When on Pay", "1-Year"},
	} {
		rows := loadSpellingFixture(t, c.fixture)
		got := findRow(rows, c.prefix)
		if got == nil {
			t.Errorf("%s: row %q missing; got %d rows", c.fixture, c.prefix, len(rows))
			continue
		}
		if got[colHowVoted] != c.want {
			t.Errorf("%s: how_voted = %q, want %q", c.fixture, got[colHowVoted], c.want)
		}
	}
}
