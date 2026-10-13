package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXDistributionColumns pins the table whose header declares NO Vote
// Cast column but two percentage columns named for the choices:
//
//	#     Proposal                  Rec    For       Withhold            Sponsor
//	1.01  Elect Trustee James C.    For    97.581%   2.419%              Management
//	      Curvey
//
// The fund reports its vote as a distribution, and the header names each
// column. how_voted carries each verbatim percentage labelled with its
// column, in the `F=85.71%` convention another filer prints by hand:
// `For=97.581% Withhold=2.419%`. About 4,300 rows in two registrants'
// filings, 2026-09-02. Decided under the standing goal; reversible.
func TestISSNPXDistributionColumns(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "ES_distribution_columns.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	want := map[string]string{
		"Elect Trustee James C. Curvey": "For=97.581% Withhold=2.419%",
		"Elect Trustee Dennis J. Dirks": "For=97.330% Withhold=2.670%",
	}
	seen := 0
	for _, r := range rows {
		exp, ok := want[r[colVoteDescription]]
		if !ok {
			continue
		}
		seen++
		if v := r[colHowVoted]; v != exp {
			t.Errorf("%s: how_voted = %q, want %q", r[colVoteDescription], v, exp)
		}
		if v := r[colMgmtRec]; v != "For" {
			t.Errorf("%s: management_recommendation = %q, want For", r[colVoteDescription], v)
		}
		if v := r[colVoteSource]; v != "Management" {
			t.Errorf("%s: sponsor = %q, want Management", r[colVoteDescription], v)
		}
	}
	if seen != 2 {
		t.Fatalf("saw %d of the 2 distribution rows; got %d rows", seen, len(rows))
	}
}
