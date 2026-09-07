package main

import (
	"os"
	"path/filepath"
	"testing"
)

func family_e_e2_date(t *testing.T, fixture, cusip, want string) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "family_e_e2", fixture))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no emitted rows")
	}
	for _, r := range rows {
		t.Logf("issuer=%q cusip=%q date=%q layout=%q description=%q", r[10], r[11], r[15], r[31], r[19])
		if r[11] != cusip || r[15] != want {
			t.Errorf("issuer=%q cusip=%q date=%q; want cusip=%q date=%q", r[10], r[11], r[15], cusip, want)
		}
	}
}

// 0001144204-06-036604, lines 403-538: truncated MeetingDat column label.
func TestFamily_e_e2_MeetingDat(t *testing.T) {
	family_e_e2_date(t, "family_e_e2_meetingdat.txt", "400518106", "20050801")
}

// 0001464413-14-000252, lines 615-811: weekday-prefixed meeting date.
func TestFamily_e_e2_Weekday(t *testing.T) {
	family_e_e2_date(t, "family_e_e2_weekday.txt", "22410J106", "20131113")
}

// 0000894189-16-011487, lines 223-361: bare MEETING date column.
func TestFamily_e_e2_BareMeetingColumn(t *testing.T) {
	family_e_e2_date(t, "family_e_e2_meeting.txt", "595017104", "20150814")
}
