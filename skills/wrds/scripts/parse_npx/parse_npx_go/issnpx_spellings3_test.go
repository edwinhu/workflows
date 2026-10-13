package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Three more spellings from the long tail of the residue (filings holding at
// most twenty blank rows), placed 2026-09-02. Each is a whole cell between a
// Mgt Rec value and a sponsor, printed exactly so by its filer:
//
//	1     Election of Directors                   For       Withold      Management
//	1     Accept Fin Statmnts & Status Rpts       For       DoNotVote    Management
//	1A    Election of Directors                   For       Mixed        Management
//
// `Withold` is a misspelling (21 rows, two filings), `DoNotVote` the value
// without its spaces (14 rows), `Mixed` a split vote by another name (12
// rows). how_voted is verbatim, so each is recorded as printed.
func TestISSNPXSpellingsWitholdDoNotVoteMixed(t *testing.T) {
	cases := []struct{ fixture, item, want, mgmt string }{
		{"EC_withold.txt", "1", "Withold", "For"},
		{"ED_donotvote.txt", "1", "DoNotVote", "For"},
		{"EE_mixed.txt", "1A", "Mixed", "For"},
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
