package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Filer agent 1580642's third export (Adler Value Fund in 0001580642-23-004388;
// 13,177 rows on run71 with issuer "Symbol" and CUSIP "Date"): the column header
// wraps over FOUR rows, `Shareholder | Brief Identification | ...`, `Ticker |
// Meeting | of the Matter | ...`, `Issuer Name | Symbol | CUSIP | Date | Voted On
// | ...`, `(Issuer/Security Holder) | (Y/N) | ...`. Only two-row splits were
// joined, so a later fragment was read as the header and the fragment beneath it
// as the first vote.
func TestHTMLTableFourRowHeader(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H28_four_row_header.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) < 4 {
		t.Fatalf("rows = %d, want at least 4", len(rows))
	}
	want := map[string][2]string{
		"Spectrum Brands Holdings": {"84790A105", "20220809"},
		"Twitter":                  {"90184L102", "20220913"},
	}
	for _, r := range rows {
		w, known := want[r[colIssuerName]]
		if !known {
			t.Errorf("unexpected issuer %q (cusip %q, %s)", r[colIssuerName], r[colCUSIP], r[colVoteDescription])
			continue
		}
		if r[colCUSIP] != w[0] || r[colMeetingDate] != w[1] {
			t.Errorf("%s: cusip %q date %q, want %v", r[colIssuerName], r[colCUSIP], r[colMeetingDate], w)
		}
		switch r[colHowVoted] {
		case "For", "Against":
		default:
			t.Errorf("how_voted %q", r[colHowVoted])
		}
	}
}
