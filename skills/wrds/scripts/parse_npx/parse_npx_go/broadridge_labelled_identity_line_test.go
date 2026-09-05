package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Baron Investment Funds Trust 2005 (0001017918-05-000121 and -000118, 5,274
// rows with no issuer, id or date on r137): the vote summary report prints the
// meeting's identity on ONE line led by the issuer's name, `ALEXANDER'S INC.
// CUSIP: 014752109  TICKER: ALX  MEETING DATE: 05/18/05  TYPE: ANNUAL`. The
// label reader required a label block to begin with a label, so the line was
// free text and the block's issuer became a line of the SGML header. Two or more
// colon-suffixed labels after a leading name are that name's identity line.
func TestBroadridgeLabelledIdentityLineLedByIssuer(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "broadridge", "B_labelled_identity_line.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colVoteDescription] != "STEVEN ROTH" && r[colVoteDescription] != "1. STEVEN ROTH" {
			continue
		}
		seen++
		if r[colIssuerName] != "ALEXANDER'S INC." || r[colCUSIP] != "014752109" || r[colMeetingDate] != "20050518" || r[colHowVoted] != "FOR" {
			t.Fatalf("Roth: issuer %q cusip %q date %q vote %q, want ALEXANDER'S INC. / 014752109 / 20050518 / FOR", r[colIssuerName], r[colCUSIP], r[colMeetingDate], r[colHowVoted])
		}
	}
	if seen == 0 {
		t.Fatalf("no Steven Roth row among %d rows", len(rows))
	}
}
