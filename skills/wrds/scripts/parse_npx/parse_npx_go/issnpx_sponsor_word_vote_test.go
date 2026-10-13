package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXSponsorWordAsVote pins the filer that prints the sponsor's name
// in the Vote Cast column to say it voted with that sponsor:
//
//	#     Proposal                                Mgt Rec   Vote Cast    Sponsor
//	1.    Approve Charter Amendment               For       Management   Management
//
// how_voted is verbatim, and the cell says Management. The reading is
// admitted ONLY on a row line that separately carries a vocabulary Mgt Rec
// and a filled Sponsor cell -- three cells -- so the bleed this layout once
// suffered (a sponsor read as the vote of a row that printed none) cannot
// return through it; the two-cell `Management  Management` rows of the same
// filing stay blank because they are that ambiguity. One 2016 filing, about
// 1,000 rows in this form. Decided under the standing goal 2026-09-02 and
// reversible in one commit.
func TestISSNPXSponsorWordAsVote(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "EQ_sponsor_word_as_vote.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) < 3 {
		t.Fatalf("got %d rows, want at least 3", len(rows))
	}
	for _, r := range rows[:3] {
		if v := r[colHowVoted]; v != "Management" {
			t.Errorf("item %s: how_voted = %q, want Management", r[colItemSeq], v)
		}
		if v := r[colMgmtRec]; v != "For" {
			t.Errorf("item %s: management_recommendation = %q, want For", r[colItemSeq], v)
		}
		if v := r[colVoteSource]; v != "Management" {
			t.Errorf("item %s: sponsor = %q, want Management", r[colItemSeq], v)
		}
	}
}
