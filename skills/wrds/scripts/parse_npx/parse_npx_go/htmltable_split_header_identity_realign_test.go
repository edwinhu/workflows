package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Allied Asset Advisors Funds 2004 (0000894189-04-001534): each meeting prints
// an identity header (Company Name, Meeting Date, Shares Voted, CUSIP, Ticker),
// its identity row (number, issuer, date, blank, CUSIP, blank), then the vote
// header (blank, Vote, MRV, Proposal, blank, Proposed by) over the proposals.
// The identity row and the vote header leave the same number of cells blank, so
// the spacer-shift realignment (htmlRealignBySpacers) must not read the identity
// as a vote row shifted by one column: r130a (2026-09-05) emitted it as a vote
// with the issuer name in the vote cell and left every proposal without an
// issuer, id or date.
func TestHTMLTableSplitHeaderIdentityRowIsNotRealigned(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H40_split_header_identity_not_realigned.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colHowVoted] == "AMERICAN POWER CONVERSION CORPORATION" {
			t.Fatalf("identity row emitted as a vote: %q", r)
		}
		if r[colIssuerName] != "AMERICAN POWER CONVERSION CORPORATION" {
			continue
		}
		seen++
		if r[colMeetingDate] != "20040610" || r[colCUSIP] != "029066- 107" || r[colHowVoted] != "For" {
			t.Fatalf("American Power: date %q cusip %q vote %q, want 20040610 / 029066- 107 / For (%s)", r[colMeetingDate], r[colCUSIP], r[colHowVoted], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no American Power rows with an issuer among %d rows", len(rows))
	}
}
