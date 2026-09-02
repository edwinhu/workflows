package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXDigitLetterIssuerIsNotAnItem pins an issuer name that LOOKS like an
// item token.
//
// The ISS report prints the issuer on its own line above `Ticker:`:
//
//	================== ATM Large Cap Managed Volatility Portfolio ==================
//
//	3I GROUP PLC
//
//	Ticker:       MMM            Security ID:  88579Y101
//
// `3I` satisfies the lettered-item regex (1, 3a1 ...), so the line was split
// as item `3I` with description `COMPANY` and emitted as a row with no vote.
// The same happens to `3M COMPANY`, `77 BANK LTD.` and a wrapped `2010
// Business Plan`. What separates an item token from a word is the COLUMN GAP
// after it: a real item is followed by two or more spaces (`1    Elect`) or a
// terminator (`1.`), a word by one. Measured 2026-09-01: 426 rows in each of two
// filings of one registrant and 246 in another, all this shape.
func TestISSNPXDigitLetterIssuerIsNotAnItem(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "E0_issuer_digit_letter.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))

	var alvarado []string
	for _, r := range rows {
		if r[colItemSeq] == "3I" {
			t.Errorf("issuer line emitted as item 3I: %q", r[colVoteDescription])
		}
		if r[colItemSeq] == "1" {
			alvarado = r
		}
	}
	if alvarado == nil {
		t.Fatalf("row 1 is missing; got %d rows", len(rows))
	}
	if v := alvarado[colIssuerName]; v != "3I GROUP PLC" {
		t.Errorf("issuer = %q, want %q", v, "3I GROUP PLC")
	}
	if v := alvarado[colHowVoted]; v != "For" {
		t.Errorf("how_voted = %q, want For", v)
	}
}
