package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Listed Funds Trust 2022 (0000894189-22-006561; 661 rows with no issuer, id
// or date on r161b) and the Hennessy funds of the same filer agent: each
// meeting is an identity header (`Company Name | Meeting Date | Provider
// Security ID | Ticker | Meeting Type`) over ONE value row, then a vote
// header (`Vote | MRV | Proposal | Proposed by Issuer or Security Holder`)
// over the vote rows. The identity header was read as the vote table's.
func TestHTMLTableIdentityHeaderOverOneRow(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H60_identity_header_pair.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if !strings.HasPrefix(r[colVoteDescription], "1. Approve the merger of AHL") && !strings.HasPrefix(r[colVoteDescription], "2. To approve the adjournment") {
			continue
		}
		seen++
		if r[colIssuerName] != "Athene Holding LTD" || r[colMeetingDate] != "20211221" || r[colCUSIP] != "G0684D305" || r[colHowVoted] != "For" {
			t.Fatalf("Athene: issuer %q date %q cusip %q vote %q", r[colIssuerName], r[colMeetingDate], r[colCUSIP], r[colHowVoted])
		}
	}
	if seen != 2 {
		t.Fatalf("%d Athene rows among %d", seen, len(rows))
	}
}
