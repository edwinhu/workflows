package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Putnam Variable Trust (CIK 822671), filer agent 0000928816, prints a
// ProxyEdge grid whose identity block is ALWAYS a bare one-cell issuer heading
// (`AAON, Inc.`) directly above a stacked `Ticker | Security ID: | Meeting
// Date | Meeting Status` label row, over and over inside ONE <TABLE> with only
// an `<HR noShade>` divider between issuers -- the vendor never closes the
// table between meetings. The bare-heading reader in layout_htmltable.go
// (htmlContextLead's call site) only accepted a new one-cell lead when
// ctx.Issuer was empty, but ctx.Issuer is not cleared until the FIRST DATA ROW
// of each issuer's OWN block re-seals it (the per-row grouped-export rule a
// little further down the same function) -- one row too late to let the NEXT
// issuer's heading in. Every issuer after the filing's first was silently
// refused as a lead candidate, so ctx.Issuer never updated and every later
// block's votes were stamped with the FIRST issuer's name.
// 0000928816-11-001081.txt alone prints this shape 46,785 times, every row
// read as "Holly Corporation" (full453 run, staleissuer.tsv top row).
//
// The fixture is this filing's own SEC header, one <SERIES> declaration
// (Capital Opportunities Fund) and the Fund Name table through AAON's and
// Abercrombie's blocks, verbatim.
func TestFamilyPutnam822671ProxyEdgeConsecutiveIssuers(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "family_putnam822671", "putnam822671_proxyedge_consecutive_issuers.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}

	var aaon, aberc int
	for _, r := range rows {
		switch r[colCUSIP] {
		case "000360206":
			aaon++
			if r[colIssuerName] != "AAON, Inc." {
				t.Errorf("AAON row: issuer = %q, want %q", r[colIssuerName], "AAON, Inc.")
			}
			if r[colMeetingDate] != htmlDate("05/17/2011") {
				t.Errorf("AAON row: date = %q, want 20110517", r[colMeetingDate])
			}
		case "002896207":
			aberc++
			if r[colIssuerName] != "Abercrombie & Fitch Co." {
				t.Errorf("Abercrombie row: issuer = %q, want %q", r[colIssuerName], "Abercrombie & Fitch Co.")
			}
			if r[colMeetingDate] != htmlDate("02/28/2011") {
				t.Errorf("Abercrombie row: date = %q, want 20110228", r[colMeetingDate])
			}
		}
	}
	if aaon != 4 {
		t.Errorf("AAON rows = %d, want 4 (items 1.1, 1.2, 2, 3)", aaon)
	}
	if aberc != 3 {
		t.Errorf("Abercrombie rows = %d, want 3 (items 1, 2, 3)", aberc)
	}
}
