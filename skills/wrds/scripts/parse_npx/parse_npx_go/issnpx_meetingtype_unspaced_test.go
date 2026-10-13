package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Comerica's 2004 report (0000950124-04-004152, 4,620 rows with no date) prints
// the meeting line as `Meeting Date:     Mar 02 2004       MeetingType:      Annual`
// -- the type label without its space -- so the date field ran on into the type
// and parsed as nothing. The label is cut with or without the space.
func TestISSNPXMeetingTypeLabelWithoutSpace(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "I_meetingtype_unspaced.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colIssuerName] == "ADC Telecommunications, Inc." && r[colMeetingDate] != "20040302" {
			t.Fatalf("ADC: date %q, want 20040302", r[colMeetingDate])
		}
	}
}
