package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXForAll pins `For All` on a director slate in the SGML-table
// vintage that abbreviates the sponsor to `Mgmt`:
//
//	  #  Proposal                                             Mgt Rec  Vote Cast  Sponsor
//	  1  Election of Directors                                For All  For All    Mgmt
//
// A whole cell, 35 rows in one 2005 filing placed by the shape finder.
func TestISSNPXForAll(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "E8_for_all.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(rows))
	}
	r := rows[0]
	if v := r[colHowVoted]; v != "For All" {
		t.Errorf("how_voted = %q, want %q", v, "For All")
	}
	if v := r[colMgmtRec]; v != "For All" {
		t.Errorf("management_recommendation = %q, want %q", v, "For All")
	}
	if v := r[colVoteDescription]; v != "Election of Directors" {
		t.Errorf("description = %q", v)
	}
}
