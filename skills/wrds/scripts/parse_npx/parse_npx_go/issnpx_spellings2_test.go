package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Three more spellings the residue harvest ranked and the shape finder placed,
// 2026-09-01 on the 35-commit build. Each is a whole cell between a Mgt Rec
// value and a sponsor, so none can be the fragment of a wrapped cell.
//
//	1.01  Elect Stephen F. Bollenbach               For       WHOLD      Management
//	4     Advisory Vote on Say on Pay Frequency   1Year     1Year        Management
//	4     Advisory Vote on Say on Pay Frequency   3Years    1Year        Management
//	1.    Election of Directors                   N         W            Management
//
// `WHOLD` (91 rows) is a 2004 abbreviation of Withhold beside the `W'HOLD` the
// vocabulary already carries. `1Year` and `3Years` (124 rows) are the
// frequency answers printed without the hyphen `1-YEAR` has. `W` (69 rows) is
// the one-letter vote the lettered vintage's comment said did not appear --
// it does not in THAT filing, and it does in four others, on director
// elections with Mgt Rec `N`.
func TestISSNPXSpellingsWholdYearsW(t *testing.T) {
	cases := []struct {
		fixture, item, want, mgmt string
	}{
		{"E2_whold.txt", "1.01", "WHOLD", "For"},
		{"E3_1year.txt", "4", "1Year", "1Year"},
		{"E3b_3years.txt", "3", "1Year", "3Years"},
		{"E4_n_w.txt", "1", "W", "N"},
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
