package main

import (
	"os"
	"path/filepath"
	"testing"
)

// MET Investors Series Trust 2010 (0001193125-10-201666, 60 MB; 3,328 rows
// carried `Country` as the issuer and `Security ID on Ballot` as the CUSIP on
// r135): the report opens each meeting with an account grid, `Location ID |
// Location Name | Institutional Account Name | Company Name | Ticker | Primary
// Security ID | Security ID on Ballot` over `122 | AIM Advisors, Inc. | MET/AIM
// SMALL CAP GROWTH PORTFOLIO | Nice-Systems Ltd. | | 653656108 | 653656108`.
// The grid's labels were unknown, so a later label row was read as the values
// of an earlier one. A value that is itself a label is never a value, and the
// grid's labels name the identity row beneath them.
func TestHTMLTableAccountGridLabelsAreNotValues(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H46_account_grid_labels.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colIssuerName] == "Country" || r[colIssuerName] == "Company Name" || r[colCUSIP] == "Security ID on Ballot" {
			t.Fatalf("label read as a value: issuer %q cusip %q (%s)", r[colIssuerName], r[colCUSIP], r[colVoteDescription])
		}
		if r[colIssuerName] != "Nice-Systems Ltd." || r[colCUSIP] != "653656108" {
			t.Fatalf("issuer %q cusip %q, want Nice-Systems Ltd. / 653656108 (%s)", r[colIssuerName], r[colCUSIP], r[colVoteDescription])
		}
	}
}
