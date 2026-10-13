package main

import (
	"os"
	"path/filepath"
	"testing"
)

// PFM Multi-Manager Series Trust 2023 (0001104659-23-090157, all 13,154 rows
// with no date on run71): the column header spells the date column `Meeting
// Data`, and the vocabulary knew only `Meeting Date`.
func TestHTMLTableMeetingDataHeader(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H29_meeting_data_header.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) < 2 {
		t.Fatalf("rows = %d, want at least 2", len(rows))
	}
	for _, r := range rows {
		if r[colMeetingDate] == "" || r[colIssuerName] == "" {
			t.Errorf("issuer %q date %q (%s)", r[colIssuerName], r[colMeetingDate], r[colVoteDescription])
		}
		if r[colCUSIP] == "421946104" && (r[colMeetingDate] != "20220715" || r[colIssuerName] != "Healthcare Realty Trust Incorporated") {
			t.Errorf("Healthcare Realty: issuer %q date %q", r[colIssuerName], r[colMeetingDate])
		}
	}
}
