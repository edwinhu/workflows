package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Northern Lights Fund Trust 2021 (0001580642-21-002528; 1,189 of 1,189 rows
// without a date on r179; the filer agent's shape across 91 filings and 17,778
// undated rows): a nine-column grid whose header cells carry the form's item
// letters -- `(a) Issuer's Name | (b) Exchange Ticker Symbol | (c) "CUSIP" # |
// (d) Shareholder Meeting Date | (e) Matter Identification | ...` -- and whose
// date reads `24-Jul-2019`.
func TestHTMLTableLetteredHeaderDayMonYear(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H63_lettered_header_day_mon_year.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "FIDELITY NAT'L INFORMATION SERVICES,INC." {
			continue
		}
		seen++
		if r[colMeetingDate] != "20190724" || r[colCUSIP] != "31620M106" {
			t.Fatalf("FIS: date %q cusip %q (%s)", r[colMeetingDate], r[colCUSIP], r[colVoteDescription])
		}
	}
	if seen < 2 {
		t.Fatalf("%d FIS rows among %d", seen, len(rows))
	}
}
