package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXFrequencyDigits pins the say-on-pay frequency vote printed as a
// bare NUMBER of years:
//
//	6     14A Executive Compensation Vote         3         3            Management
//	      Frequency
//	4.    14A Executive Compensation Vote         F         1            Management
//	      Frequency
//
// `3` and `1` are the whole Vote Cast cell. A digit cannot simply join the
// vocabulary: a proposal's text can end in one (`Amend Article 3`) and the
// peel would read it as the vote of a row that printed none. What separates
// the two is the OTHER cell: a frequency answer is printed beside a Mgt Rec
// (`3` or `F`), while a stray trailing digit stands alone. 446 rows placed by
// the shape finder on one registrant's filings, 2026-09-01, plus 38 more in
// the `F  1` form.
func TestISSNPXFrequencyDigits(t *testing.T) {
	cases := []struct {
		fixture, item, want, mgmt, desc string
	}{
		{"E6_frequency_digits.txt", "6", "3", "3", "14A Executive Compensation Vote Frequency"},
		{"E6b_frequency_f1.txt", "4", "1", "F", "14A Executive Compensation Vote Frequency"},
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
		if v := got[colVoteDescription]; v != c.desc {
			t.Errorf("%s: description = %q, want %q", c.fixture, v, c.desc)
		}
	}
}
