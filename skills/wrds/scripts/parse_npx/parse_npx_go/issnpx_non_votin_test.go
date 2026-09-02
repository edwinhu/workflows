package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXNonVotinTruncated pins `Non-Votin`: the report generator's own
// truncation of Non-Voting at the Vote Cast column's width.
//
//	#     Proposal                                  Mgt Rec   Vote Cast Sponsor
//	1.    Present Financial Statements              Non-Votin Non-Votin Management
//
// The vocabulary carries `non-voting`; this filing never prints the g, on 457
// cells, and a second family prints `None  Non-Votin  Management`. 405 rows
// placed by the shape finder, 2026-09-01. how_voted is what the cell printed.
func TestISSNPXNonVotinTruncated(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "E7_non_votin.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	var got []string
	for _, r := range rows {
		if r[colItemSeq] == "1" {
			got = r
		}
	}
	if got == nil {
		t.Fatalf("item 1 missing; got %d rows", len(rows))
	}
	if v := got[colHowVoted]; v != "Non-Votin" {
		t.Errorf("how_voted = %q, want %q", v, "Non-Votin")
	}
	if v := got[colMgmtRec]; v != "Non-Votin" {
		t.Errorf("management_recommendation = %q, want %q", v, "Non-Votin")
	}
	if v := got[colVoteDescription]; v != "Present Financial Statements" {
		t.Errorf("description = %q", v)
	}
}
