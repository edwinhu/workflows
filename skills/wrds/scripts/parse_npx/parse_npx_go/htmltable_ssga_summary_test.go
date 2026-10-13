package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The SSgA "Vote Summary Report" grid (Kiewit Investment Fund 2006,
// 0001302716-06-000006: 5,698 rows with no issuer, id or date): the header
// stacks two labels per column (`Mtg Date/Type`, `Company/Ticker`,
// `CUSIP/Proposal`), the meeting's first row carries `05/24/06 - A`, the
// company, the CUSIP, the record date and the shares, and the item rows follow
// under the same columns. A row with no vote that holds exactly one date, one
// CUSIP-shaped id and one name is the meeting's identity, whatever the header
// calls the columns; `date - type` is a date.
func TestHTMLTableSSGAVoteSummaryIdentityRow(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H35_ssga_vote_summary.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) < 2 {
		t.Fatalf("rows = %d", len(rows))
	}
	r := rows[0]
	if r[colIssuerName] != "21st Century Insurance Group *TW*" || r[colCUSIP] != "90130N103" || r[colMeetingDate] != "20060524" {
		t.Fatalf("issuer %q cusip %q date %q, want 21st Century Insurance Group *TW* / 90130N103 / 20060524", r[colIssuerName], r[colCUSIP], r[colMeetingDate])
	}
}
