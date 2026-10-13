package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 000155/1556505/0001580642-18-004083.txt lines 357-511, verbatim.
// The date cell is "2018 Annual Meeting<BR>June 26, 2018".
// 0001580642-18-004547 repeats this shape at lines 501-502.
func TestFamily_h_1580642_YearMeetingPrefix(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "family_h_1580642_year_meeting_prefix.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) != 9 {
		t.Fatalf("emitted %d rows, want 9", len(rows))
	}
	for i, r := range rows {
		issuer, ticker, date := "2U INC.", "TWOU", "20180626"
		if i >= 7 {
			issuer, ticker, date = "AFLAC INCORPORATED", "AFL", "20180507"
		}
		if r[31] != "htmltable" || r[10] != issuer || r[14] != ticker {
			t.Fatalf("row %d: layout=%q issuer=%q ticker=%q", i, r[31], r[10], r[14])
		}
		if r[15] != date {
			t.Errorf("row %d %s meeting_date=%q, want %s", i, r[10], r[15], date)
		}
	}
}

// 000131/1314414/0001580642-18-003787.txt lines 495-645, verbatim.
// Both "Special - 2017-10-19" and "Annual - 2017-11-08" are printed dates.
func TestFamily_h_1580642_TypeDashDate(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "family_h_1580642_type_dash_date.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) != 8 {
		t.Fatalf("emitted %d rows, want 8", len(rows))
	}
	for i, r := range rows {
		issuer, cusip, date := "METLIFE, INC.", "59156R108", "20171019"
		if i >= 2 {
			issuer, cusip, date = "CARDINAL HEALTH, INC.", "14149Y108", "20171108"
		}
		if r[31] != "htmltable" || r[10] != issuer || r[11] != cusip {
			t.Fatalf("row %d: layout=%q issuer=%q cusip=%q", i, r[31], r[10], r[11])
		}
		if r[15] != date {
			t.Errorf("row %d %s meeting_date=%q, want %s", i, r[10], r[15], date)
		}
	}
}
