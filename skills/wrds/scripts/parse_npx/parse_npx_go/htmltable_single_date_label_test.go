package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The Donnelley grid of 2010 (0001193125-10-200750, 6,753 rows with the DATE
// read as the issuer and no date): the issuer on a one-cell row, then a row
// holding the single label `Meeting Date`, then the date on its own row,
// then `Ticker:` and `CUSIP:` label rows. A lone `Meeting Date` label row is a
// stacked label row of one, and its value row carries the date, never the
// issuer.
func TestHTMLTableSingleMeetingDateLabelRow(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H34_single_meeting_date_label.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colIssuerName] != "Textron Inc." || r[colMeetingDate] != "20100428" || r[colCUSIP] != "883203101" || r[colTicker] != "TXT" {
			t.Fatalf("issuer %q date %q cusip %q ticker %q, want Textron Inc. / 20100428 / 883203101 / TXT", r[colIssuerName], r[colMeetingDate], r[colCUSIP], r[colTicker])
		}
	}
}
