package main

import (
	"os"
	"path/filepath"
	"testing"
)

// T. Rowe Price Small-Cap Stock Fund 2005 (0000075170-05-000013; 1,855 rows,
// none dated, on r156): the label's value is split over two cells --
// `Meeting Date: | MAY | 17, 2005 | Meeting Type: Annual` -- and the month
// alone is not a date.
func TestHTMLTableDateSplitOverTwoCells(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H55_date_split_cells.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "3D SYSTEMS CORP." {
			continue
		}
		seen++
		if r[colMeetingDate] != "20050517" || r[colCUSIP] != "88554D205" {
			t.Fatalf("3D Systems: date %q cusip %q (%s)", r[colMeetingDate], r[colCUSIP], r[colVoteDescription])
		}
	}
	if seen < 2 {
		t.Fatalf("%d 3D Systems rows among %d", seen, len(rows))
	}
}
