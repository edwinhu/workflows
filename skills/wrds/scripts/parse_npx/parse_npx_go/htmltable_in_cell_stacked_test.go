package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Clearwater Investment Trust 2011 (0000897101-11-001512 and -001772, 22,022
// rows with no date, no id and no issuer on run71): the identity grid above each
// item table stacks its labels INSIDE one cell and the values inside the next --
// `Security ID<br>Ticker Symbol<br>ISIN` | `151290889<br>CX<br>US1512908898`,
// then `Meeting Type<br>Meeting Date<br>Agenda` | `Special<br>24-Feb-2011<br>...`
// -- under a bare `Issuer` | `CEMEX, S.A.B. DE C.V.` row. Labels and values pair
// line by line; a bare two-cell label row carries its value.
func TestHTMLTableInCellStackedLabels(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H32_in_cell_stacked_labels.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) < 3 {
		t.Fatalf("rows = %d, want the three CEMEX items", len(rows))
	}
	for _, r := range rows {
		if r[colIssuerName] != "CEMEX, S.A.B. DE C.V." || r[colCUSIP] != "151290889" || r[colTicker] != "CX" || r[colMeetingDate] != "20110224" {
			t.Fatalf("issuer %q cusip %q ticker %q date %q, want CEMEX, S.A.B. DE C.V. / 151290889 / CX / 20110224 (%s)", r[colIssuerName], r[colCUSIP], r[colTicker], r[colMeetingDate], r[colVoteDescription])
		}
	}
}
