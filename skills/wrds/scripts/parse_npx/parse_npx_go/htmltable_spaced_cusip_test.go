package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Hennessy Funds Trust 2011 (0000894189-11-003395; 1,063 rows with no id or
// date on r161b): the same US Bancorp grammar, with the CUSIP printed in
// groups (`091 826 107`) and the vote header's labels carrying colons and a
// value (`Vote: | MRV: n/a | Proposal: | Proposed by Issuer or shareholder:`)
// over `For | | | 1. Directors | Issuer | For`. The value row's spacers differ
// from the header's, so the description column still lands on the proponent
// word -- a defect this test does not cover.
func TestHTMLTableSpacedCUSIPAndColonLabels(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H61_spaced_cusip_colon_labels.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "Black Box Corp." {
			continue
		}
		seen++
		if r[colCUSIP] != "091826107" || r[colMeetingDate] != "20100810" || r[colHowVoted] != "For" {
			t.Fatalf("Black Box: cusip %q date %q vote %q (%s)", r[colCUSIP], r[colMeetingDate], r[colHowVoted], r[colVoteDescription])
		}
	}
	if seen != 2 {
		t.Fatalf("%d Black Box rows among %d", seen, len(rows))
	}
}
