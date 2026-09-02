package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Two more whole-cell values from the residue's long tail, 2026-09-02:
//
//	1.    DIRECTOR                                          NV           Management
//	3     Human right to water                For       Angst       Shareholder
//
// `NV` is a non-vote code printed with a blank Mgt Rec (14 rows, one
// registrant); `Angst` is a filer's misspelling of Against (7 rows). Recorded
// as printed.
func TestISSNPXSpellingsNVAngst(t *testing.T) {
	cases := []struct{ fixture, item, want, mgmt string }{
		{"EG_nv.txt", "1", "NV", ""},
		{"EH_angst.txt", "3", "Angst", "For"},
	}
	for _, c := range cases {
		b, err := os.ReadFile(filepath.Join("testdata", "issnpx", c.fixture))
		if err != nil {
			t.Fatalf("read fixture: %v", err)
		}
		rows := runISSNPXDoc(t, string(b))
		var got []string
		for _, r := range rows {
			if r[colItemSeq] == c.item {
				got = r
				break
			}
		}
		if got == nil {
			t.Errorf("%s: item %s missing; got %d rows", c.fixture, c.item, len(rows))
			continue
		}
		if v := got[colHowVoted]; v != c.want {
			t.Errorf("%s: how_voted = %q, want %q", c.fixture, v, c.want)
		}
		if v := got[colMgmtRec]; v != c.mgmt {
			t.Errorf("%s: management_recommendation = %q, want %q", c.fixture, v, c.mgmt)
		}
	}
}
