package main

import (
	"os"
	"path/filepath"
	"testing"
)

// colOtherInfo is vote_other_info, column 30 of votes.tsv.
const colOtherInfo = 29

// TestISSNPXColonVoteWithNominee pins a Vote Cast cell printed as the vote,
// a colon and the nominee, wrapping in its own column while the proposal
// wraps in its own:
//
//  1. ELECTION OF DIRECTORS: DAVID W.         FOR       FOR: DAVID   Management
//     BERNAUER                                          W. BERNAUER
//  1. ELECTION OF DIRECTORS: RICHARD W.       FOR       FOR:         Management
//     DREILING                                          RICHARD W.
//     DREILING
//
// The vote is the word before the colon; the nominee restates the proposal
// and is carried in vote_other_info, the field the VOTED column already
// uses. 227 rows in two filings of one registrant, 2026-09-02.
func TestISSNPXColonVoteWithNominee(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "EM_colon_vote_nominee.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	nominees := []string{"RAUL ALVAREZ", "DAVID W. BERNAUER", "ANGELA F. BRALY", "LAURIE Z. DOUGLAS",
		"RICHARD W. DREILING", "ROBERT L. JOHNSON", "MARSHALL O. LARSEN", "RICHARD K. LOCHRIDGE",
		"JAMES H. MORGAN", "ROBERT A. NIBLOCK", "ERIC C. WISEMAN"}
	if len(rows) < len(nominees)+2 {
		t.Fatalf("got %d rows, want at least %d", len(rows), len(nominees)+2)
	}
	for i, n := range nominees {
		r := rows[i]
		if v := r[colHowVoted]; v != "FOR" {
			t.Errorf("row %d: how_voted = %q, want FOR", i, v)
		}
		if v := r[colMgmtRec]; v != "FOR" {
			t.Errorf("row %d: management_recommendation = %q, want FOR", i, v)
		}
		if v := r[colVoteDescription]; v != "ELECTION OF DIRECTORS: "+n {
			t.Errorf("row %d: description = %q, want %q", i, v, "ELECTION OF DIRECTORS: "+n)
		}
		if v := r[colOtherInfo]; v != n {
			t.Errorf("row %d: vote_other_info = %q, want %q", i, v, n)
		}
	}
	r := rows[len(nominees)]
	if v := r[colHowVoted]; v != "FOR" {
		t.Errorf("item 2: how_voted = %q, want FOR", v)
	}
	if v := r[colVoteDescription]; v != "ADVISORY APPROVAL OF LOWES NAMED EXECUTIVE OFFICER COMPENSATION." {
		t.Errorf("item 2: description = %q", v)
	}
}
