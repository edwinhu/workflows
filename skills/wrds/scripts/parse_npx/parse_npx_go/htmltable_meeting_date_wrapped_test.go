package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Oppenheimer Rising Dividends Fund 2014 (0000728889-14-001049; 1,047 of 1,047
// rows without a date on r179, the agent's five filings 2,067): the identity
// cell reads `ABBVIE INC. <br>Meeting Date:&nbsp;&nbsp;MAY` with `09, 2014
// <br>Record Date: ...` on the cell's next line -- the date value wraps over
// the line break inside the cell, so the label's own line holds only the
// month.
func TestHTMLTableMeetingDateWrappedInCell(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H64_meeting_date_wrapped_in_cell.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colIssuerName] != "ABBVIE INC." {
			t.Fatalf("issuer %q (%s)", r[colIssuerName], r[colVoteDescription])
		}
		if r[colMeetingDate] != "20140509" || r[colCUSIP] != "00287Y109" {
			t.Fatalf("date %q cusip %q (%s)", r[colMeetingDate], r[colCUSIP], r[colVoteDescription])
		}
	}
}
