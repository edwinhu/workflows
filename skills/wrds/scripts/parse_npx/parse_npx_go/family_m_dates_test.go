package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 0001413042-22-000736, lines 189-220: Meeting / Date spans header rows.
func TestFamilyMSplitMeetingDateHeader(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "M_split_meeting_date.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no emitted votes")
	}
	for _, r := range rows {
		if r[colMeetingDate] != "20220401" {
			t.Fatalf("issuer=%q date=%q want 20220401; description=%q layout=%q", r[colIssuerName], r[colMeetingDate], r[colVoteDescription], r[len(r)-1])
		}
	}
}

// 0001228235-11-000024, lines 111-128: the issuer strip ends in meeting 5/2/11.
func TestFamilyMParenthesizedIdentityMeeting(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "M_parenthesized_identity_meeting.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no emitted votes")
	}
	for _, r := range rows {
		if r[colMeetingDate] != "20110502" {
			t.Fatalf("issuer=%q date=%q want 20110502; description=%q layout=%q", r[colIssuerName], r[colMeetingDate], r[colVoteDescription], r[len(r)-1])
		}
	}
}
