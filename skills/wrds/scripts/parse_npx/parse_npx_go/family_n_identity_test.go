package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 000093/939934/0001135428-19-000179.txt, lines 75076-75125, verbatim.
// The same meeting follows immediately with its CUSIP and terminal punctuation.
func TestFamilyNICRBlankIdentityFromPunctuatedSibling(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "icr", "N_site_centers_sibling.txt"))
	if err != nil {
		t.Fatal(err)
	}
	res := parseText([]byte(edgarEnvelope("0000939934", "0001135428-19-000179", string(b))), FilingMeta{FilePath: "000093/939934/0001135428-19-000179.txt", FormType: "N-PX"})
	if res.Meta.ParseStatus != "ok" || res.Meta.Layout != "icr" || len(res.Rows) != 22 {
		t.Fatalf("status=%q layout=%q rows=%d, want ok/icr/22", res.Meta.ParseStatus, res.Meta.Layout, len(res.Rows))
	}
	for i, r := range res.Rows {
		if r.MeetingDate != "20190509" || r.Ticker != "SITC" {
			t.Fatalf("row %d date=%q ticker=%q, want 20190509/SITC", i, r.MeetingDate, r.Ticker)
		}
		if r.CUSIP != "82981J109" {
			t.Errorf("row %d issuer=%q cusip=%q, want 82981J109 printed in the same-date SITC sibling", i, r.IssuerName, r.CUSIP)
		}
	}
}
