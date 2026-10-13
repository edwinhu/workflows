package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Putnam Investment Funds 2004 (0000928816-04-000801; 2,529 of 11,889 rows
// with their proposal text doubled on r160b): the report prints each
// proposal's first line a second time beneath the row, and the wrap join
// took the echo as a continuation.
func TestPVTextEchoedDescriptionIsNotAContinuation(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "pvtext", "PV6_echoed_description.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	want := map[string]string{
		"ELECT DIRECTOR DOUGLAS D. FRENCH":                               "FOR",
		"RATIFY AUDITORS":                                                "FOR",
		"ELECT DIRECTOR P.C. GODSOE":                                     "AGNST",
		"ADOPTION OF AMENDED AND RESTATED INCENTIVE STOCK PLAN OF 1998.": "AGNST",
	}
	seen := map[string]bool{}
	for _, r := range rows {
		if r[colIssuerName] != "HERMAN MILLER, INC." && r[colIssuerName] != "INGERSOLL-RAND COMPANY LIMITED" {
			continue
		}
		if v, ok := want[r[colVoteDescription]]; ok {
			if r[colHowVoted] != v {
				t.Fatalf("%s: vote %q", r[colVoteDescription], r[colHowVoted])
			}
			seen[r[colVoteDescription]] = true
		}
	}
	for d := range want {
		if !seen[d] {
			t.Errorf("no row with description %q among %d rows", d, len(rows))
		}
	}
}
