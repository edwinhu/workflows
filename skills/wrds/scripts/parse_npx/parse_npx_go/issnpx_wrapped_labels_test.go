package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Praxis Mutual Funds 2020 (0001398344-20-014805, 16,447 rows with no issuer,
// id or date): the ISS text report run through an HTML converter that pads with
// &nbsp; and wraps lines, so `Ticker: ABT Security` ends one line and `ID:
// 002824100` starts the next, and `Meeting Date:` is followed by its value on
// the line below. The identity lines are rejoined before the ordinary parse.
func TestISSNPXWrappedIdentityLines(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "I_wrapped_labels_praxis.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) < 3 {
		t.Fatalf("rows = %d, want at least 3", len(rows))
	}
	for _, r := range rows {
		if r[colIssuerName] != "ABBOTT LABORATORIES" || r[colTicker] != "ABT" || r[colCUSIP] != "002824100" || r[colMeetingDate] != "20200424" {
			t.Errorf("issuer %q ticker %q cusip %q date %q, want ABBOTT LABORATORIES / ABT / 002824100 / 20200424", r[colIssuerName], r[colTicker], r[colCUSIP], r[colMeetingDate])
		}
	}
}
