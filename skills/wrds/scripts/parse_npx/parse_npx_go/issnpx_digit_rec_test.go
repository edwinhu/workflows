package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXDigitRecommendationLetterVote pins a digit Mgt Rec beside a
// one-letter vote:
//
//  4. Management                              1         F            Management
//
// issDigitCellsAgree refuses a digit recommendation unless the vote is a
// digit too, because `Approve Plan 2  For  Management` would otherwise read
// its `2` as the recommendation. A ONE-LETTER vote code is a different case:
// no proposal text ends in a bare digit followed by a lettered vote and a
// sponsor. 57 rows in two filings of one registrant, 2026-09-02.
func TestISSNPXDigitRecommendationLetterVote(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "EL_digit_rec_letter_vote.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	var got []string
	for _, r := range rows {
		if r[colItemSeq] == "4" {
			got = r
		}
	}
	if got == nil {
		t.Fatalf("item 4 missing; got %d rows", len(rows))
	}
	if v := got[colHowVoted]; v != "F" {
		t.Errorf("how_voted = %q, want F", v)
	}
	if v := got[colMgmtRec]; v != "1" {
		t.Errorf("management_recommendation = %q, want 1", v)
	}
}
