package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXLabelledDistribution pins the Vote Cast cell one registrant
// prints as a comma-separated labelled distribution, wrapped wherever the
// column width falls:
//
//	1.1   ELECTION OF DIRECTOR: P. GERALD MALONE  For       F=94%, AB=   Management
//	                                                        6%
//	1.1   ELECTION OF DIRECTOR: LAWRENCE J. FOX   For       F=35%,       Management
//	                                                        AB=65%
//	1.4   Election of Director: FREDERIC A.       For       F=91%, AB=9% Management
//	      ESCHERICH
//
// The parser already admits the one-token `F=85.71%`; this is the same
// fact with several labels. A fragment that ends in `=` is glued to the
// next line's fragment without a space, one that ends in `,` with one. 367
// rows in two filings, 2026-09-02.
func TestISSNPXLabelledDistribution(t *testing.T) {
	cases := []struct{ fixture, item, want, desc string }{
		{"ET_labelled_distribution_wrap_eq.txt", "1.1", "F=94%, AB=6%", "ELECTION OF DIRECTOR: P. GERALD MALONE"},
		{"EU_labelled_distribution_wrap_comma.txt", "1.1", "F=35%, AB=65%", "ELECTION OF DIRECTOR: LAWRENCE J. FOX"},
		{"EV_labelled_distribution_one_line.txt", "1.4", "F=91%, AB=9%", "Election of Director: FREDERIC A. ESCHERICH"},
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
			}
		}
		if got == nil {
			t.Errorf("%s: item %s missing; got %d rows", c.fixture, c.item, len(rows))
			continue
		}
		if v := got[colHowVoted]; v != c.want {
			t.Errorf("%s: how_voted = %q, want %q", c.fixture, v, c.want)
		}
		if v := got[colMgmtRec]; v != "For" {
			t.Errorf("%s: management_recommendation = %q, want For", c.fixture, v)
		}
		if v := got[colVoteDescription]; v != c.desc {
			t.Errorf("%s: description = %q, want %q", c.fixture, v, c.desc)
		}
	}
}
