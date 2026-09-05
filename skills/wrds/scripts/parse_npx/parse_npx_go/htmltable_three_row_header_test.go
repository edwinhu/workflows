package main

import (
	"os"
	"path/filepath"
	"testing"
)

// American Pension Investors Trust 2018 (0001398344-18-012221; 1,946 rows,
// none dated, on r159): the header wraps over three rows -- `For or` alone
// on the first, `Meeting | Proposed | Vote | Against` on the second, `Issuer
// | Ticker | CUSIP | Date | Matter Voted On | By | Cast | Vote | Mgt.` on
// the third -- and the date column was left as a bare `Date`.
func TestHTMLTableThreeRowHeaderDate(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H57_three_row_header.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "BT Group Plc" {
			continue
		}
		seen++
		if r[colMeetingDate] != "20170712" || r[colCUSIP] != "05577E101" || r[colHowVoted] != "For" {
			t.Fatalf("BT: date %q cusip %q vote %q (%s)", r[colMeetingDate], r[colCUSIP], r[colHowVoted], r[colVoteDescription])
		}
	}
	if seen < 3 {
		t.Fatalf("%d BT rows among %d", seen, len(rows))
	}
}
