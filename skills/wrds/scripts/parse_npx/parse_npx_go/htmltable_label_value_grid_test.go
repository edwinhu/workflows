package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The Donnelley identity grid (0001193125-15-291803, 17,472 rows with no date
// on run71; 480k htmltable rows lost their date in all): label and value
// alternate across ONE row with spacer cells between, `Meeting Date | | 07/15/2014
// | | Country | | Spain | | Primary Security ID | | E6282J109`, then `Record
// Date | | 07/10/2014 | | Meeting Type | | Annual | | Ticker | | ITX`, then
// `Primary CUSIP E6282J109 | | Primary ISIN ... | | Primary SEDOL ...`. Six
// filled cells with only ONE label the layout knew made the row too wide to be
// read as bare labels, so the date and the security id were never read.
func TestHTMLTableLabelValueGrid(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H24_label_value_grid.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) < 3 {
		t.Fatalf("rows = %d, want at least 3", len(rows))
	}
	for _, r := range rows {
		if r[colMeetingDate] != "20140715" {
			t.Errorf("meeting date %q, want 20140715 (%s)", r[colMeetingDate], r[colVoteDescription])
		}
		if r[colCUSIP] != "E6282J109" {
			t.Errorf("cusip %q, want E6282J109", r[colCUSIP])
		}
		if r[colTicker] != "ITX" {
			t.Errorf("ticker %q, want ITX", r[colTicker])
		}
		if r[colISIN] != "ES0148396015" {
			t.Errorf("isin %q, want ES0148396015", r[colISIN])
		}
	}
}
