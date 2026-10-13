package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The ProxyEdge grid as Clearwater Investment Trust 2011 prints it for most of
// its meetings (0000897101-11-001512: 4,739 rows read with the issuer "Ticker"
// and no date): the label row carries the ISSUER in its first cell -- `Booker
// Group plc | | Meeting Date | | Country | Security ID | Meeting Type | Record
// Date` -- and the value row prints the ticker with its own label in the first
// cell, `Ticker BOKl | | 07-Jul-10 | | United Kingdom | G1344P100 | Annual |
// 05-Jul-10`. The first cell of a label row that is not a label is the issuer;
// a value cell that starts with a label word carries that field.
func TestHTMLTableIssuerInLabelRow(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H33_issuer_in_label_row.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	// the excerpt opens with the CEMEX block (H32's shape) so the layout is
	// selected as the whole filing selects it; the Booker block follows
	booker := 0
	for _, r := range rows {
		if r[colIssuerName] == "CEMEX, S.A.B. DE C.V." {
			continue
		}
		booker++
		if r[colIssuerName] != "Booker Group plc" || r[colCUSIP] != "G1344P100" || r[colTicker] != "BOKl" || r[colMeetingDate] != "20100707" {
			t.Fatalf("issuer %q cusip %q ticker %q date %q, want Booker Group plc / G1344P100 / BOKl / 20100707", r[colIssuerName], r[colCUSIP], r[colTicker], r[colMeetingDate])
		}
	}
	if booker == 0 {
		t.Fatal("no Booker rows")
	}
}
