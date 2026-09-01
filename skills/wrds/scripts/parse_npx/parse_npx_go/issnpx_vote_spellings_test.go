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
