package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Stadion Investment Trust 2016 (0001398344-16-016736; 942 of 942 rows without a
// date on r182, the agent's 15 filings 5,349): the grid heads its date column
// `Meeting Dt` beside a `Holding Dt` record date, so the row prints two dates
// and only the header can tell them apart.
func TestHTMLTableMeetingDtHeader(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H66_meeting_dt_header.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "GENERAL MILLS INC" {
			continue
		}
		seen++
		if r[colMeetingDate] != "20150929" || r[colCUSIP] != "370334104" {
			t.Fatalf("General Mills: date %q cusip %q (%s)", r[colMeetingDate], r[colCUSIP], r[colVoteDescription])
		}
	}
	if seen < 2 {
		t.Fatalf("%d General Mills rows among %d", seen, len(rows))
	}
}
