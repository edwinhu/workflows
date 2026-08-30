package main

import (
	"strings"
	"testing"
)

// Wrapped vote lines. This rendering is narrow enough that the VOTE VALUE itself
// wraps, and a description fragment can follow on a line carrying no item number:
//
//	7.00   Elect Supervisory Board/Corporate Assembly MGMT NO TAKE NO
//	ACTION
//	    Amend Board/Supervisory Board Size
//	8.00   Amend Board Powers/Procedures/Qualifications MGMT NO TAKE NO
//	ACTION
//
// The layout currently reads line one and stops, so `7.00` either vanishes or would
// be stamped `TAKE NO` -- a value the filing never printed, since the word it wraps
// to is part of it. `how_voted` is verbatim by contract, and a TRUNCATED value is
// the worst failure of the three: it is neither the filing's text nor absent, and it
// looks plausible in aggregate.
//
// The fixture is one contiguous slice beginning at an `ISSUER NAME` header and
// holding 100 item-numbered lines, two of which wrap their vote onto a bare `ACTION`.
//
// WHAT THIS TEST DELIBERATELY DOES NOT ASSERT: how the trailing description fragment
// (`Amend Board/Supervisory Board Size`) should be joined. Whether it belongs to item
// 7.00's description or is a second agenda line is not decidable from these bytes,
// and asserting a guess would pin a wrong answer. The row count and the vote values
// are decidable, so those are what this pins.

func TestPVTextWrappedVoteIsNotTruncated(t *testing.T) {
	rows := runISSNPXDoc(t, loadPVFixture(t, "PV4_wrapped_votes.txt"))
	if len(rows) != 100 {
		t.Fatalf("got %d rows, want 100 -- one per item-numbered line in the fixture", len(rows))
	}
	for i, r := range rows {
		hv := strings.ToUpper(strings.TrimSpace(r[colHowVoted]))
		if hv == "TAKE NO" || hv == "TAKE" {
			t.Fatalf("row %d (%q) has how_voted %q -- the value wrapped onto the next"+
				" line and was truncated; the filing printed `TAKE NO ACTION`",
				i, r[colVoteDescription], r[colHowVoted])
		}
		switch hv {
		case "FOR", "AGNST", "ABSTAIN", "WITHHELD", "TAKE NO ACTION",
			"DID NOT VOTE", "NOT VOTED", "NONE", "NON-VOTING":
		default:
			t.Errorf("row %d (%q) has how_voted %q, which this filing does not print",
				i, r[colVoteDescription], r[colHowVoted])
		}
	}
}

// TestPVTextWrapTailIsNeverARow guards the other direction: the bare `ACTION` line
// and the unnumbered description fragment are continuations, not votes.
func TestPVTextWrapTailIsNeverARow(t *testing.T) {
	for i, r := range runISSNPXDoc(t, loadPVFixture(t, "PV4_wrapped_votes.txt")) {
		d := strings.TrimSpace(r[colVoteDescription])
		if d == "ACTION" || d == "" {
			t.Fatalf("row %d has description %q -- a wrap continuation emitted as a vote", i, d)
		}
	}
}
