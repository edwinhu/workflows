package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Filer agent 1580642's wide export (0001580642-23-004388, 13,177 of 15,706
// rows with no date on run71; four filings of the family in the top list): a
// column header `Company Name | Ticker | Primary CUSIP | Meeting Date | ...`
// and data rows whose date cell reads `&nbsp;07-Sep-22`.
func TestHTMLTableNbspDMYDate(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H25_nbsp_dmy_date.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) < 3 {
		t.Fatalf("rows = %d, want at least 3", len(rows))
	}
	abb := 0
	for _, r := range rows {
		if r[colCUSIP] != "H0010V101" {
			continue
		}
		abb++
		if r[colIssuerName] != "ABB Ltd." || r[colMeetingDate] != "20220907" {
			t.Errorf("issuer %q date %q (%s)", r[colIssuerName], r[colMeetingDate], r[colVoteDescription])
		}
	}
	if abb < 2 {
		t.Errorf("ABB rows = %d, want at least 2", abb)
	}
}
