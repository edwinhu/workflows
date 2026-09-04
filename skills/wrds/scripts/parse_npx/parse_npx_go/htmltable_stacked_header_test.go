package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The 2005 filer-agent shape (Putnam, 0000928816-05-*): a stacked label row
// `ISSUER NAME | TICKER | CUSIP | MTG DATE | MTG TYPE`, then the column header
// `Proposal Type | Voted | Vote | For/Agnst Mgmt`, then the issuer's identity row
// `3M Co | MMM | 88579Y101 | 5/10/05 | Annual`, then the proposals. Two things
// lost the date on 803k htmltable rows of run66: MTG DATE was not a stacked
// label the layout knew, and a column header sitting between the labels and
// their values consumed the labels as if it were the value row.
func TestHTMLTableStackedLabelsOverColumnHeader(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H23_stacked_labels_over_column_header.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) < 3 {
		t.Fatalf("rows = %d, want at least 3", len(rows))
	}
	want := map[string][2]string{"3M Co": {"88579Y101", "20050510"}, "4 Kids Entertainment Inc": {"350865101", "20050526"}}
	for _, r := range rows {
		w, known := want[r[colIssuerName]]
		if !known {
			t.Errorf("unexpected issuer %q", r[colIssuerName])
			continue
		}
		if r[colCUSIP] != w[0] || r[colMeetingDate] != w[1] {
			t.Errorf("%s: cusip %q date %q, want %q %q", r[colIssuerName], r[colCUSIP], r[colMeetingDate], w[0], w[1])
		}
		switch r[colHowVoted] {
		case "FOR", "WHOLD", "AGNST":
		default:
			t.Errorf("how_voted %q, want the Vote column, never the Voted flag", r[colHowVoted])
		}
	}
}
