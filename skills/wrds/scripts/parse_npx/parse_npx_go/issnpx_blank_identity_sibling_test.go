package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Artisan Funds 2004-2010 (0001193125-09-183863 and its five siblings; 2,539 to
// 4,695 rows per filing with no id): a meeting block may print its identity line
// with both values empty -- `Ticker:                      Security ID:` -- while
// the SAME issuer and the SAME meeting date are printed again a few blocks later
// with the id filled: `Ticker:       CBY            Security ID:  12721E102`,
// both `Meeting Date: MAY 14, 2009`. The blank block's rows keep no id, so the
// filing loses ids it does print. Recoverable this way: 128 rows in 2009, 29 in
// 2010, 35 in 2005, 19-22 in 2004/2007/2008.
func TestISSNPXBlankIdentityFilledFromSiblingBlock(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "I_blank_identity_sibling_block.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "CADBURY PLC" || r[colVoteDescription] != "Approve Remuneration Report" {
			continue
		}
		seen++
		if r[colCUSIP] != "12721E102" {
			t.Fatalf("CADBURY PLC %s: cusip %q, want \"12721E102\"", r[colMeetingDate], r[colCUSIP])
		}
	}
	if seen < 2 {
		t.Fatalf("%d CADBURY PLC rows among %d, want both blocks", seen, len(rows))
	}
}
