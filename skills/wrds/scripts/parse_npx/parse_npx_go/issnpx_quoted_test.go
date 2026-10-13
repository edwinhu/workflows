package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXQuotedVote pins a Vote Cast cell the filer wrapped in quotes:
//
//  1. To adopt the merger agreement and       For       "N/A"        Management
//
// Matching strips the quotes the way it strips a trailing period or
// asterisk; the value is recorded as printed, quotes and all. 12 rows in
// one registrant's 2021 filings.
func TestISSNPXQuotedVote(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "EP_quoted_na.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(rows))
	}
	if v := rows[0][colHowVoted]; v != `"N/A"` {
		t.Errorf("how_voted = %q, want %q", v, `"N/A"`)
	}
	if v := rows[0][colMgmtRec]; v != "For" {
		t.Errorf("management_recommendation = %q, want For", v)
	}
	if v := rows[0][colVoteDescription]; v != "To adopt the merger agreement and approve the mergers and the other transactions contemplated by the merger agreement." {
		t.Errorf("description = %q", v)
	}
}
