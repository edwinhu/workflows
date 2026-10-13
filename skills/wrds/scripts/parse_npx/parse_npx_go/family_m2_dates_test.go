package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 0001105607-06-000286, lines 209-525: the meeting date is on the
// following row beside Issuer: and ISIN:, not beside Annual Meeting Date:.
func TestFamilyM2NextRowMeetingDate(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "M2_next_row_meeting_date.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no emitted votes")
	}
	for _, r := range rows {
		if r[len(r)-1] != "htmltable" {
			t.Fatalf("layout=%q want htmltable", r[len(r)-1])
		}
		if r[colMeetingDate] != "20050713" {
			t.Errorf("issuer=%q date=%q want 20050713; description=%q layout=%q", r[colIssuerName], r[colMeetingDate], r[colVoteDescription], r[len(r)-1])
		}
	}
}
