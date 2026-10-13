package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestISSNPXDidNotVoteAfterText pins the wrapped vote whose second half comes
// AFTER a line of wrapped proposal text:
//
//	3     MAXIMUM NUMBER OF STOCK OPTIONS,          For       Did Not    Management
//	      PERFORMANCE SHARES
//	 AND CONDITIONAL                 Vote
//	      SHARES TO BE GRANTED TO MEMBERS OF THE
//
// The join that reunites `Did Not` with `Vote` looked only at the line just
// above the continuation; here that line is proposal text, and the sponsor --
// the anchor the join needs -- is two lines up on the row line. 766 rows in
// four filings placed by the shape finder, 2026-09-02.
func TestISSNPXDidNotVoteAfterText(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "E9_didnot_vote_after_text.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) != 4 {
		t.Fatalf("got %d rows, want 4", len(rows))
	}
	for _, r := range rows {
		if v := r[colHowVoted]; v != "Did Not Vote" {
			t.Errorf("item %s: how_voted = %q, want %q", r[colItemSeq], v, "Did Not Vote")
		}
		if v := r[colMgmtRec]; v != "For" {
			t.Errorf("item %s: management_recommendation = %q, want For", r[colItemSeq], v)
		}
	}
	want := "MAXIMUM NUMBER OF STOCK OPTIONS, PERFORMANCE SHARES AND CONDITIONAL SHARES TO BE GRANTED TO MEMBERS OF THE"
	if v := rows[2][colVoteDescription]; !strings.HasPrefix(v, want) {
		t.Errorf("item 3 description = %q\nwant prefix %q", v, want)
	}
}

// TestISSNPXBroadridgeNotesHeaderIsForeign pins the Broadridge vote-summary
// table embedded in an ISS filing:
//
//	#     PROPOSAL                                                    VOTE          NOTES          COMMENTS
//	1     The election of directors of the corporation: John          For           With Mgmt
//
// Read in ISS column order the NOTES cell is in the vote position and the
// peel fails on every row. The header closes the table, as the other foreign
// grammars do; 324 rows in six filings of one agent, 2026-09-02.
func TestISSNPXBroadridgeNotesHeaderIsForeign(t *testing.T) {
	line := "#     PROPOSAL                                                    VOTE          NOTES          COMMENTS"
	if !issForeignTableHeader(line) {
		t.Errorf("issForeignTableHeader(%q) = false, want true", line)
	}
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "EA_broadridge_notes_block.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("the ISS section before the block emitted nothing; the fixture must be claimed")
	}
	for _, r := range rows {
		if strings.Contains(r[colVoteDescription], "With Mgmt") || r[colHowVoted] == "" {
			t.Errorf("a Broadridge row was read as ISS: item %s %q vote %q", r[colItemSeq], r[colVoteDescription], r[colHowVoted])
		}
	}
}
