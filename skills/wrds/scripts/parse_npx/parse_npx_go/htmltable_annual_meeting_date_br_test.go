package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Ivy Funds 2004 (0001105607-04-000299; 3,153 of 3,530 rows without a date on
// r174b, and its twin -04-000285 the same): one table per meeting, whose
// identity cell reads `Annual Meeting Date:<br> 07/31/2003` -- the meeting
// type prefixes the label and a line break separates it from the value --
// beside `Issuer: 285512` (a number, not a name) and blank ISIN and SEDOL
// cells; the issuer name and ticker sit in the rows above.
func TestHTMLTableAnnualMeetingDateOverBreak(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H62_annual_meeting_date_br.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colIssuerName] != "ELECTRONIC ARTS INC." {
			t.Fatalf("issuer %q (%s)", r[colIssuerName], r[colVoteDescription])
		}
		if r[colMeetingDate] != "20030731" {
			t.Fatalf("date %q (%s)", r[colMeetingDate], r[colVoteDescription])
		}
	}
}
