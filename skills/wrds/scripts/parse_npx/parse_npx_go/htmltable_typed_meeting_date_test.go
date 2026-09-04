package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Manning & Napier Fund 2007 (0001193125-07-188615, all 10,822 rows with no
// date on run71): the block row prints the meeting type INSIDE the label,
// `Special Meeting Date: 08/31/2006`, `Annual Meeting Date:`, `AGM Meeting
// Date:`. A context line had to begin with a label, so none of these were read.
func TestHTMLTableTypedMeetingDateLabel(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H31_typed_meeting_date_label.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) < 1 {
		t.Fatalf("rows = %d, want at least 1", len(rows))
	}
	for _, r := range rows {
		if r[colMeetingDate] != "20060831" || r[colIssuerName] != "WACHOVIA CORPORATION" || r[colTicker] != "WB" {
			t.Errorf("issuer %q ticker %q date %q (%s)", r[colIssuerName], r[colTicker], r[colMeetingDate], r[colVoteDescription])
		}
	}
}
