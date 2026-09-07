package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Bear Stearns Funds 2004 (0000922423-04-001413; 2,161 of 2,161 rows with no id):
// the identity line spells the id label `Security ID and/or CUSIP No.:` --
// `Ticker:       ALTR           Security ID and/or CUSIP No.:  021441100` -- and
// issTickerLine looks only for `SECURITY ID:` or `CUSIP:`, so neither substring
// is present and the line is not an identity line at all. The whole block header
// is then lost: the issuer name above it, the ticker and the CUSIP all come out
// blank, and only the meeting date (read off its own line) survives. Every one of
// the filing's 252 blocks prints this spelling.
func TestISSNPXSecurityIDAndOrCUSIPNoLabel(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "I_security_id_andor_cusip_no.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colVoteDescription] != "Ratify Auditors" {
			continue
		}
		seen++
		if r[colIssuerName] != "ALTERA CORP." || r[colCUSIP] != "021441100" || r[colTicker] != "ALTR" {
			t.Fatalf("issuer %q cusip %q ticker %q, want \"ALTERA CORP.\" / \"021441100\" / \"ALTR\"",
				r[colIssuerName], r[colCUSIP], r[colTicker])
		}
	}
	if seen == 0 {
		t.Fatalf("no Ratify Auditors row among %d", len(rows))
	}
}
