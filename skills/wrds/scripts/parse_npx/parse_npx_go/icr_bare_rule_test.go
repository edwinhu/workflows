package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Royce Fund 2011 (0000709364-11-000021, 40,596 of 40,861 rows with no fund and
// no series on run71): the report opens each fund with `Fund Name : Royce 100
// Fund` and then prints a bare `=====` rule between EVERY issuer block. The bare
// rule was read as the banner grammar's section end and cleared the fund, so
// only the first issuer of each fund kept its series. A bare rule clears a fund
// a banner rule set; it never clears a fund the `Fund Name :` label set.
func TestICRBareRuleDoesNotClearALabelledFund(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "icr", "I11_royce_bare_rule.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) < 30 {
		t.Fatalf("rows = %d, want the blocks of several issuers", len(rows))
	}
	for _, r := range rows {
		if r[colFundName] != "Royce 100 Fund" || r[colSeriesID] != "S000009519" {
			t.Fatalf("item %s (%s): fund %q series %q, want Royce 100 Fund / S000009519", r[colItemSeq], r[colIssuerName], r[colFundName], r[colSeriesID])
		}
	}
}
