package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Vanguard International Equity Index Funds 2017 (0000932471-17-005163, 1,779
// rows with no security id on r145; 58,220 across the layout's 219 filings):
// a Nordic share class puts a space in the ticker, `TICKER: MAERSK B  CUSIP:
// K0514G135`, and the one-token ticker pattern then saw no CUSIP label. The
// ticker runs to the CUSIP label.
func TestVanguardTickerWithShareClass(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "vanguard", "V_ticker_with_class.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "A.P. Moller - Maersk A/S" {
			continue
		}
		seen++
		if r[colCUSIP] != "K0514G135" || r[colTicker] != "MAERSK B" || r[colMeetingDate] != "20170328" {
			t.Fatalf("Maersk: cusip %q ticker %q date %q (%s)", r[colCUSIP], r[colTicker], r[colMeetingDate], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no Maersk rows among %d", len(rows))
	}
}
