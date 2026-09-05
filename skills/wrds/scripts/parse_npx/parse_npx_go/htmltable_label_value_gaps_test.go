package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Clearwater Investment Trust 2011's majority grid (0000897101-11-001512,
// 10,776 rows with no date after rounds 9 and 10): label and value share a row
// with blank cells between them, a label may have no value on its row
// (`Ticker Symbol | | | Meeting Date | 07-Jul-10`), and the ISIN is labelled
// `ISN`. A label's value is the next filled cell unless that cell is itself a
// label.
func TestHTMLTableLabelValueGaps(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H38_label_value_gaps.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := false
	for _, r := range rows {
		if r[colISIN] == "GB00B1YW4409" {
			seen = true
			if r[colMeetingDate] != "20100707" {
				t.Fatalf("date %q, want 20100707 (%s)", r[colMeetingDate], r[colVoteDescription])
			}
		}
	}
	if !seen {
		t.Fatal("no rows carrying the ISIN GB00B1YW4409")
	}
}
