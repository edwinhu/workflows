package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Lincoln Variable Insurance Products Trust 2005 (0001193125-05-173556; 2,054 of
// 7,890 rows with no id): a meeting opens with a label/value grid whose FIRST
// cell is the issuer name -- `Electrolux AB | | Shares Voted | 0 | Security |
// W24713120 | Meeting Status | Submitted` over `Meeting Date | 4/20/2005 | ... |
// Record Date | 4/5/2005`. The row is not read, so the id is dropped and the
// centered page-break paragraph that precedes the table -- `<P ... ALIGN="center">
// <FONT ...>30 </FONT></P>` -- is taken as the issuer instead. The filing prints
// 602 of these `Security` grids; every one yields rows whose issuer is a page
// number and whose id is blank.
func TestHTMLTableSecurityLabelGridPageNumberIssuer(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H84_security_label_grid_page_number.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatalf("no rows")
	}
	for _, r := range rows {
		if r[colIssuerName] != "Electrolux AB" || r[colCUSIP] != "W24713120" || r[colMeetingDate] != "20050420" {
			t.Fatalf("issuer %q cusip %q date %q, want \"Electrolux AB\" / \"W24713120\" / \"20050420\"",
				r[colIssuerName], r[colCUSIP], r[colMeetingDate])
		}
	}
}
