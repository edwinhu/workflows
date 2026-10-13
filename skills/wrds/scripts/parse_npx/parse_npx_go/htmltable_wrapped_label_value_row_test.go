package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Green Century Funds 2010 (0001144204-10-046589, 4,503 rows with no date): the
// meeting's identity is two wide rows of label and value cells, and the labels
// of the second wrap inside their cells (`Ticker / Symbol | JAVA | Meeting /
// Date | 17-Jul-2009`), so the split-header reader consumed the row as a header
// stacked over rows and the ticker and date were never read. A row that reads
// as context with a value is context, and is read before the split header.
func TestHTMLTableWrappedLabelValueRow(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H37_wrapped_label_value_row.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := false
	for _, r := range rows {
		if r[colCUSIP] == "24702R101" {
			seen = true
			if r[colMeetingDate] != "20090717" || r[colTicker] != "DELL" {
				t.Fatalf("Dell: date %q ticker %q, want 20090717 / DELL", r[colMeetingDate], r[colTicker])
			}
		}
	}
	if !seen {
		t.Fatal("no Dell rows")
	}
}
