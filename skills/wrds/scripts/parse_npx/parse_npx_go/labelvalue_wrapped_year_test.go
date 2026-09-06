package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Timothy Plan 2019 (0001580642-19-003968; 867 of 867 rows with no issuer or
// date on r185; the 2021 filing 1,275 more): the identity lines wrap their year
// -- `Meeting Date: APR 17` / `2019 Meeting Type: Annual` / `Record Date: FEB
// 28` / `2019` -- so the date has no year and the lone `2019` line above the
// `#` header was read as the issuer.
func TestLabelValueWrappedYear(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "labelvalue", "LV3_wrapped_year.txt"))
	if err != nil {
		t.Fatal(err)
	}
	// The whole filing dispatches to labelvalue; this excerpt alone would go to
	// issnpx on its identity lines, so the layout is called directly.
	rows, err := parseLabelValue(string(stripHTML(b)), FilingMeta{})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string][2]string{"ADECOAGRO SA": {"20190417", "L00849106"}, "AGCO CORP.": {"20190425", "001084102"}}
	seen := map[string]int{}
	for _, r := range rows {
		w, ok := want[r.IssuerName]
		if !ok {
			t.Fatalf("issuer %q (%s)", r.IssuerName, r.VoteDescription)
		}
		seen[r.IssuerName]++
		if r.MeetingDate != w[0] || r.CUSIP != w[1] {
			t.Fatalf("%s: date %q cusip %q (%s)", r.IssuerName, r.MeetingDate, r.CUSIP, r.VoteDescription)
		}
	}
	if seen["ADECOAGRO SA"] < 9 || seen["AGCO CORP."] < 1 {
		t.Fatalf("rows %v among %d", seen, len(rows))
	}
}
