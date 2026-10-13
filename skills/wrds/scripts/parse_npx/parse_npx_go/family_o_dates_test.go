package main

import (
	"os"
	"testing"
)

// 0000894189-13-004227, lines 215-803: the complete table is needed by dispatch.
func TestFamilyOWeekdayWithoutCommaMeetingDate(t *testing.T) {
	b, err := os.ReadFile("testdata/htmltable/O_weekday_identity_date.txt")
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	want := map[string]string{
		"Madison Square Garden": "20121129",
		"DigitalGlobe":          "20121203",
		"GEOEYE":                "20121203",
		"Apple":                 "20130227",
	}
	seen := make(map[string]bool)
	for _, r := range rows {
		date, ok := want[r[colIssuerName]]
		if !ok {
			t.Fatalf("unexpected issuer %q", r[colIssuerName])
		}
		seen[r[colIssuerName]] = true
		if r[colMeetingDate] != date {
			t.Errorf("issuer=%q date=%q want %s; description=%q layout=%q", r[colIssuerName], r[colMeetingDate], date, r[colVoteDescription], r[len(r)-1])
		}
	}
	for issuer := range want {
		if !seen[issuer] {
			t.Errorf("no emitted votes for %q", issuer)
		}
	}
}

// 0001206774-04-001152, lines 141-157: a month-first date in a Broadridge block.
func TestFamilyOBroadridgeMonthFirstMeetingDate(t *testing.T) {
	b, err := os.ReadFile("testdata/O_colonless_meeting_date.txt")
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no emitted votes")
	}
	for _, r := range rows {
		if r[colMeetingDate] != "20040220" {
			t.Fatalf("issuer=%q date=%q want 20040220; description=%q layout=%q", r[colIssuerName], r[colMeetingDate], r[colVoteDescription], r[len(r)-1])
		}
	}
}
