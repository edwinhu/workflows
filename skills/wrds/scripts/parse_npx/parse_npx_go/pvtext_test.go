package main

import (
	"os"
	"path/filepath"
	"testing"
)

// A shape that had been miscounted as LLM work. It lives in the plain-text bucket
// this project costed for a Gemini batch, and it is entirely regular:
//
//	ISSUER NAME TICKER CUSIP MTG DATE MTG TYPE
//	        Proposal Type Voted? Vote For/Agnst Mgmt
//	Abbott Laboratories ABT  002824100  4/23/04  Annual
//	1.01   Elect Roxanne S. Austin MGMT YES FOR FOR
//
// A two-line wrapped header, then alternating meeting lines and item-numbered vote
// lines. Each vote line is item / description / proponent / voted? / vote /
// vs-management, with the description free text between the item number and the
// proponent token.
//
// MEASURED ACROSS THE WHOLE 13,229-FILING SKIP PILE, not extrapolated from a sample:
// 277 filings carry this header and they hold 520,449 vote-like lines, mean 1,879,
// max 26,384. That is roughly half of all the value left in the residue, and it is
// deterministic parsing rather than an LLM job.
//
// Ground truth below was read off the fixture's own bytes: 70 vote rows over 5
// meetings. The fixture is trimmed to end on a complete vote line so the count is
// unambiguous.
//
// One caution for whoever extends this: the SOURCE FILING MIXES FORMATS. Earlier
// sections of the same document report in a `Mtg Date/Type | Company/Ballot Issues |
// Security | Mgmt Rec | Vote Cast` fixed-width layout under different sub-advisors.
// A layout that assumes one format per filing will mis-read the other sections.

func loadPVText(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "pvtext", "PV1_account_text.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return string(b)
}

// TestPVTextExtractsEveryVoteLine is the coverage assertion.
func TestPVTextExtractsEveryVoteLine(t *testing.T) {
	rows := runISSNPXDoc(t, loadPVText(t))
	if len(rows) != 70 {
		t.Fatalf("got %d rows, want 70 across 5 meetings", len(rows))
	}
	joined := ""
	for _, r := range rows {
		joined += r[colVoteDescription] + "\n"
	}
	for _, w := range []string{
		"Elect Henry B. Schacht", "Adopt Stock Option Plan",
		"Link Executive Pay to Social Criteria", "Review Political Spending",
	} {
		if indexOf(joined, w) < 0 {
			t.Errorf("no extracted row describes %q", w)
		}
	}
}

// TestPVTextKeepsDescriptionAndVoteSeparate guards the split that a whitespace-
// delimited text format makes easy to get wrong: the description is free text and
// runs up to the proponent token, so a naive field split folds the last word of the
// description into the proponent, or the proponent into the description.
func TestPVTextKeepsDescriptionAndVoteSeparate(t *testing.T) {
	rows := runISSNPXDoc(t, loadPVText(t))
	for i, r := range rows {
		d, hv := r[colVoteDescription], r[colHowVoted]
		if d == "" {
			t.Fatalf("row %d has an empty description", i)
		}
		for _, tok := range []string{"MGMT", "SHLDR", " YES", " NO"} {
			if indexOf(d, tok) >= 0 {
				t.Errorf("row %d description %q still carries the %q column", i, d, tok)
			}
		}
		if hv != "FOR" && hv != "AGNST" && hv != "ABSTAIN" && hv != "WITHHELD" {
			t.Errorf("row %d how_voted = %q, not one of the values this filing prints", i, hv)
		}
	}
}

// TestPVTextNeverEmitsAMeetingLineAsAVote is the safety assertion: meeting lines
// carry an issuer, ticker, CUSIP and date, and are not votes.
func TestPVTextNeverEmitsAMeetingLineAsAVote(t *testing.T) {
	for i, r := range runISSNPXDoc(t, loadPVText(t)) {
		for _, bad := range []string{"Allstate Corp ALL", "Altria Group MO", "Annual"} {
			if d := r[colVoteDescription]; d == bad {
				t.Fatalf("row %d description is %q -- a meeting line emitted as a vote", i, d)
			}
		}
	}
}
