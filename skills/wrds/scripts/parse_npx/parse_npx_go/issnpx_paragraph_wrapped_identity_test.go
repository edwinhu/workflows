package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Dreyfus Opportunity Funds 2015 (0001111178-15-000032; 148 issnpx filings
// with 36,044 rows carrying series but no security id on r141, 59 of them
// Dreyfus and BNY Mellon): the report is HTML paragraphs, and the generator
// wrapped each paragraph's text over a raw source newline at a word boundary,
// `Ticker:` / `ARI   Security ID: S01680107`, `AFRICAN RAINBOW` / `MINERALS LTD`.
// Inside a paragraph a newline is whitespace, so the identity line is one line.
func TestISSNPXParagraphWrappedIdentity(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "D8_paragraph_wrapped_identity.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colCUSIP] != "S01680107" {
			continue
		}
		seen++
		if r[colIssuerName] != "AFRICAN RAINBOW MINERALS LTD" || r[colMeetingDate] != "20141205" || r[colTicker] != "ARI" {
			t.Fatalf("African Rainbow: issuer %q date %q ticker %q (%s)", r[colIssuerName], r[colMeetingDate], r[colTicker], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no rows with security id S01680107 among %d", len(rows))
	}
}
