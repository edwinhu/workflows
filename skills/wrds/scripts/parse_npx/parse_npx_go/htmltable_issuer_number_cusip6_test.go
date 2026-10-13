package main

import (
	"os"
	"path/filepath"
	"testing"
)

// SM&R Investments 2005 (0000881166-05-000008; 5,099 of 5,099 rows with no id
// and 311 undated on the current panel) and American National Investment
// Accounts 2005 (0000867050-05-000011; 3,587 of 3,587) share a filer agent's
// Excel export. A meeting opens with a stacked block -- `DELL INC. | | DELL | |
// Annual Meeting Date: 07/16/2004` over `Issuer: 24702R | ISIN:` over `SEDOL:`
// -- so the ticker sits in the third cell of the name row, the meeting date
// rides the `<Type> Meeting Date:` label in the fifth, and the only security id
// the filing prints anywhere is the CUSIP-6 on the `Issuer:` line (24702R for
// Dell, 92857W for Vodafone, 792860 for St. Paul Travelers; no ISIN or SEDOL
// value appears in either filing). None of the three is read, so the block
// yields rows with no issuer, no id and no date.
func TestHTMLTableIssuerNumberCUSIP6Block(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H82_issuer_number_cusip6_block.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows, err := parseHTMLTableRaw(raw, "", FilingMeta{})
	if err != nil {
		t.Fatal(err)
	}
	seen := 0
	for _, r := range rows {
		if r.VoteDescription != "MICHAEL S. DELL" {
			continue
		}
		seen++
		if r.IssuerName != "DELL INC." || r.CUSIP != "24702R" || r.MeetingDate != "20040716" || r.Ticker != "DELL" {
			t.Fatalf("%q: issuer %q cusip %q ticker %q date %q, want issuer \"DELL INC.\" cusip \"24702R\" ticker \"DELL\" date \"20040716\"",
				r.VoteDescription, r.IssuerName, r.CUSIP, r.Ticker, r.MeetingDate)
		}
	}
	if seen == 0 {
		t.Fatalf("no MICHAEL S. DELL rows among %d", len(rows))
	}
}
