package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Mutual Fund Series Trust 2018 (0001580642-18-004114): the lettered grid's
// `(d) Shareholder Meeting Type & Date` column reads `Annual 28-Jul-2017`.
func TestHTMLTableTypeBeforeDateCell(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H65_type_before_date_cell.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "Vodafone Group Plc." {
			continue
		}
		seen++
		if r[colMeetingDate] != "20170728" || r[colCUSIP] != "92857W308" {
			t.Fatalf("Vodafone: date %q cusip %q (%s)", r[colMeetingDate], r[colCUSIP], r[colVoteDescription])
		}
	}
	if seen < 3 {
		t.Fatalf("%d Vodafone rows among %d", seen, len(rows))
	}
}
