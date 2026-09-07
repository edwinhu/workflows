package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Symmetry Panoramic Trust 2024 (000173/1736078/0001135428-24-000106.txt;
// 7,951 of 35,019 rows undated): the undated votes print one identity element
// too many, so the whole block is rotated right by one. A dated Snowflake vote
// reads `<inf:cusip>833445109</inf:cusip><inf:isin>US8334451098</inf:isin>
// <inf:meetingDate>07/05/2023</inf:meetingDate>`; the same agenda item for a
// sibling series reads `<inf:cusip>45112</inf:cusip><inf:isin>833445109</inf:isin>
// <inf:figi>US8334451098</inf:figi><inf:meetingDate></inf:meetingDate>` --
// 45112 is the spreadsheet serial for 2023-07-05, the CUSIP sits in isin, the
// ISIN in figi, and meetingDate is empty because the date fell off the front.
func TestXMLRotatedIdentityExcelSerialDate(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "xml", "X1_rotated_identity_excel_serial.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows, _ := collectXML(t, string(b))
	if len(rows) != 5 {
		t.Fatalf("got %d rows, want 5", len(rows))
	}
	for i, r := range rows {
		if r.MeetingDate != "20230705" {
			t.Errorf("row %d (%s): meeting date = %q, want 20230705", i, r.VoteDescription, r.MeetingDate)
		}
		if r.CUSIP != "833445109" {
			t.Errorf("row %d (%s): cusip = %q, want 833445109", i, r.VoteDescription, r.CUSIP)
		}
		if r.ISIN != "US8334451098" {
			t.Errorf("row %d (%s): isin = %q, want US8334451098", i, r.VoteDescription, r.ISIN)
		}
	}
}
