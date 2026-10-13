package main

import (
	"os"
	"path/filepath"
	"testing"
)

// M Fund 2017 (0001398344-17-010475; three filings of the registrant hold 3,476
// rows with no date on r154): a foreign issuer's identity header is `Company
// Name | Meeting Date | SEDOL | Ticker` over `GREAT PORTLAND ESTATES PLC R.E.I.T.,
// LONDON | 07-Jul-2016 | BZ0XJR3 | GPOR LN`, and SEDOL was not a stacked label the
// reader knew, so the row was refused and the proposals took the cover page's
// `(Exact name of registrant as specified in charter)` as their issuer. The SEDOL
// is not a security id the linker reads, but the name and the date are.
func TestHTMLTableSEDOLIdentityHeader(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H50_sedol_identity_header.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] == "(Exact name of registrant as specified in charter)" {
			t.Fatalf("cover page read as the issuer: %q", r[colVoteDescription])
		}
		if r[colIssuerName] != "GREAT PORTLAND ESTATES PLC R.E.I.T., LONDON" {
			continue
		}
		seen++
		if r[colMeetingDate] != "20160707" || r[colTicker] != "GPOR LN" {
			t.Fatalf("Great Portland: date %q ticker %q (%s)", r[colMeetingDate], r[colTicker], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no Great Portland rows among %d", len(rows))
	}
}
