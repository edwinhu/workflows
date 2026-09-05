package main

import (
	"os"
	"path/filepath"
	"testing"
)

// North Track Funds 2005 (0001144204-05-026187; 3,148 rows, none dated, on
// r156): the strip's label and value share a cell wrapped at a newline
// (`Meeting\nDate 28-Apr-05`, `Meeting\nType Annual`), and the `ISIN` label
// is followed by the agenda cell (`Agenda 932273458 - Management`), which is
// no ISIN.
func TestHTMLTableNorthTrackDateInLabelCell(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H56_north_track.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "ADOBE SYSTEMS INCORPORATED" {
			continue
		}
		seen++
		if r[colMeetingDate] != "20050428" || r[colCUSIP] != "00724F101" || r[colISIN] != "" {
			t.Fatalf("Adobe: date %q cusip %q isin %q (%s)", r[colMeetingDate], r[colCUSIP], r[colISIN], r[colVoteDescription])
		}
	}
	if seen < 2 {
		t.Fatalf("%d Adobe rows among %d", seen, len(rows))
	}
}
