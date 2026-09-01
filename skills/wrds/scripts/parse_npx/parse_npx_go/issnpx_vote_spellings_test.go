package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Three more Vote Cast spellings, each a real outcome the vocabulary did not
// carry. issPeelCell matches a WHOLE cell, so a value it does not know makes the
// peel fail at the right edge and every cell stays in the proposal text with a
// blank vote -- the same failure shape as `Split Vote` (f3642c56).
//
//	Sold shares   the fund sold the position before the meeting
//	F=85.71%      a proportional vote, reported as a percentage breakdown
//	DNV           did not vote
//
// Measured 2026-09-01 against the ranking, on the 15-fix build: 5,794 blank of
// 22,297 rows, 5,966 of 23,702, and 6,937 of 67,741 respectively.
func TestISSNPXSoldShares(t *testing.T) {
	rows := loadSpellingFixture(t, "DC_sold_shares.txt")
	got := findRow(rows, "ELECTION OF DIRECTOR: MAURA C. BREEN")
	if got == nil {
		t.Fatalf("row missing; got %d rows", len(rows))
	}
	if got[colHowVoted] != "Sold shares" {
		t.Errorf("how_voted = %q, want %q", got[colHowVoted], "Sold shares")
	}
	if got[colMgmtRec] != "Sold" {
		t.Errorf("mgmt_rec = %q, want %q", got[colMgmtRec], "Sold")
	}
}

func TestISSNPXPercentVote(t *testing.T) {
	rows := loadSpellingFixture(t, "DD_percent_vote.txt")
	got := findRow(rows, "Approve Investment Advisory Agreement")
	if got == nil {
		t.Fatalf("row missing; got %d rows", len(rows))
	}
	if got[colHowVoted] != "F=85.71%" {
		t.Errorf("how_voted = %q, want %q", got[colHowVoted], "F=85.71%")
	}
}

func TestISSNPXDNV(t *testing.T) {
	rows := loadSpellingFixture(t, "DE_dnv.txt")
	got := findRow(rows, "Elect Dissident Nominee Matthew J. Hart")
	if got == nil {
		t.Fatalf("row missing; got %d rows", len(rows))
	}
	if got[colHowVoted] != "DNV" {
		t.Errorf("how_voted = %q, want %q", got[colHowVoted], "DNV")
	}
}

func loadSpellingFixture(t *testing.T, name string) [][]string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return runISSNPXDoc(t, string(b))
}

func findRow(rows [][]string, descPrefix string) []string {
	for _, r := range rows {
		if strings.HasPrefix(r[colVoteDescription], descPrefix) {
			return r
		}
	}
	return nil
}

// TestISSNPXLetterVote pins the single-letter Vote Cast.
//
//	3   Management Proposal   F   F   Management
//
// One vintage abbreviates the choice to a letter in both the Mgt Rec and Vote
// Cast columns. Counted in that filing's own bytes: F appears 5,637 times, A 59,
// N 9 and D 7 in those two columns; W does not appear and is not admitted.
//
// It is the same choice-letter alphabet the percentage form uses (F=85.71%), and
// without it the peel failed at the right edge, leaving 5,630 of the filing's
// 22,297 rows with every cell inside the proposal text and a blank vote.
func TestISSNPXLetterVote(t *testing.T) {
	rows := loadSpellingFixture(t, "DF_letter_vote.txt")
	got := findRow(rows, "Management Proposal")
	if got == nil {
		t.Fatalf("row missing; got %d rows", len(rows))
	}
	if got[colHowVoted] != "F" {
		t.Errorf("how_voted = %q, want %q", got[colHowVoted], "F")
	}
	if got[colMgmtRec] != "F" {
		t.Errorf("mgmt_rec = %q, want %q", got[colMgmtRec], "F")
	}
}

// TestISSNPXNoVoteCell pins `No` in the Vote Cast column.
//
//		3   RATIFICATION OF THE APPOINTMENT OF   For   No   Management
//	       ERNST & YOUNG LLP AS THE COMPANY'S ...
//
// The cells sit at the right edge and the description wraps below them, so this
// is not a layout problem -- issVoteValues simply did not carry `no`, and
// issPeelCell matches a whole cell, so the peel failed and the row's own line
// became proposal text with the continuations appended after it.
//
// The shared howVotedVocabulary already recognised NO, so the two lists had
// drifted: one filing prints it on 5,941 rows.
func TestISSNPXNoVoteCell(t *testing.T) {
	rows := loadSpellingFixture(t, "DG_no_vote_cell.txt")
	got := findRow(rows, "RATIFICATION OF THE APPOINTMENT OF")
	if got == nil {
		t.Fatalf("row missing; got %d rows", len(rows))
	}
	if got[colHowVoted] != "No" {
		t.Errorf("how_voted = %q, want %q", got[colHowVoted], "No")
	}
	if strings.Contains(got[colVoteDescription], "Management") {
		t.Errorf("description %q still carries the cells", got[colVoteDescription])
	}
}

// TestISSNPXWrapAfterSponsor pins the proposal text that resumes AFTER the
// sponsor, on the same line.
//
//	1  Accept Financial Statements and  For  For  Management Statutory Reports
//
// The proposal is "Accept Financial Statements and Statutory Reports" and the
// cells sit in the MIDDLE of it. issPeelColumns peels from the right, finds
// "Reports" in no vocabulary, and abandons the line.
//
// The column boundary survives normalisation: cells are separated by TWO spaces
// and the wrapped tail is glued to the sponsor by ONE. That is the same fact
// icrPeelProponent and lvPeelProponent already use, and it is what makes this
// recoverable rather than a guess.
func TestISSNPXWrapAfterSponsor(t *testing.T) {
	rows := loadSpellingFixture(t, "DH_wrap_after_sponsor.txt")
	got := findRow(rows, "Accept Financial Statements")
	if got == nil {
		t.Fatalf("row missing; got %d rows", len(rows))
	}
	if got[colHowVoted] != "For" {
		t.Errorf("how_voted = %q, want %q", got[colHowVoted], "For")
	}
	if got[colVoteSource] != "Management" {
		t.Errorf("sponsor = %q, want %q", got[colVoteSource], "Management")
	}
	if want := "Accept Financial Statements and Statutory Reports"; got[colVoteDescription] != want {
		t.Errorf("description = %q, want %q", got[colVoteDescription], want)
	}
}

// TestISSNPXNotVoted pins `Not voted`, and `No Vote` alongside it.
//
//	1  Accounts and Reports  For  Not voted  Management
//
// issVoteValues carried `unvoted`, `did not vote` and `do not vote` but not
// `not voted`, so the peel failed and the row's cells stayed in the proposal
// text. In the filing that prints it, `Not voted` is 1,713 of the 1,744 blank
// votes remaining after every other fix today -- essentially all of them.
//
// `no vote` is added with it: the shared howVotedVocabulary has carried NO VOTE
// all along, so this is the same drift between two lists of one fact that
// 7838452e records.
func TestISSNPXNotVoted(t *testing.T) {
	rows := loadSpellingFixture(t, "DI_not_voted.txt")
	got := findRow(rows, "Accounts and Reports")
	if got == nil {
		t.Fatalf("row missing; got %d rows", len(rows))
	}
	if got[colHowVoted] != "Not voted" {
		t.Errorf("how_voted = %q, want %q", got[colHowVoted], "Not voted")
	}
	if got[colVoteSource] != "Management" {
		t.Errorf("sponsor = %q, want %q", got[colVoteSource], "Management")
	}
}

// TestISSNPXDidNotVote pins `DidNot Vote` and the `Null` recommendation.
//
//	1.1  Receive Report on 2004 Business Operation  Null  DidNot  Management
//	     Results                                          Vote
//
// The vote is `DidNot Vote` -- one value, spelled without the space and split
// across the wrap -- and the Mgt Rec cell reads `Null`. Neither was in the
// vocabulary, so the peel failed and every cell stayed in the proposal text.
// One filing prints it on 2,670 rows.
func TestISSNPXDidNotVote(t *testing.T) {
	rows := loadSpellingFixture(t, "DL_didnot.txt")
	got := findRow(rows, "Receive Report on 2004 Business Operation")
	if got == nil {
		t.Fatalf("row missing; got %d rows", len(rows))
	}
	if got[colHowVoted] != "DidNot Vote" {
		t.Errorf("how_voted = %q, want %q", got[colHowVoted], "DidNot Vote")
	}
	if got[colMgmtRec] != "Null" {
		t.Errorf("mgmt_rec = %q, want %q", got[colMgmtRec], "Null")
	}
}
