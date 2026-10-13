package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The two exports of 0001580642-23-004388 one after the other, as the filing
// prints them: fund 1's eleven-column table (`Company Name | Ticker | Primary
// CUSIP | Meeting Date | ...`), then fund 2's twelve-column table (`Company Name
// | Primary Ticker Symbol | Security ID | Meeting Date | ...`). Each parses alone
// with its dates; in sequence the second lost every date (13,177 rows on run71).
func TestHTMLTableTwoExportsInSequence(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H27_two_exports_in_sequence.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	var abb, gsk int
	for _, r := range rows {
		switch r[colCUSIP] {
		case "H0010V101":
			abb++
			if r[colMeetingDate] != "20220907" {
				t.Errorf("ABB date %q, want 20220907", r[colMeetingDate])
			}
		case "37733W105":
			gsk++
			if r[colMeetingDate] != "20220706" || r[colIssuerName] != "GSK PLC" {
				t.Errorf("GSK date %q issuer %q, want 20220706 GSK PLC (%s)", r[colMeetingDate], r[colIssuerName], r[colVoteDescription])
			}
		}
	}
	if abb < 2 || gsk < 2 {
		t.Errorf("rows ABB=%d GSK=%d, want both present", abb, gsk)
	}
}
