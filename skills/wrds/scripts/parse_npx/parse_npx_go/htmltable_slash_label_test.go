package main

import (
	"os"
	"path/filepath"
	"testing"
)

// CRM Mutual Fund Trust 2008 (0001193125-08-188294; 1,408 rows with no date or
// id on r154): the identity strip alternates label and value cells --
// `Meeting Date/Type | | 06/10/08 AGM | | Security | | 4498101 | | Meeting
// Status | Voted | ...`. The date label carries `/Type`, and the CUSIP is
// printed as a number, so its leading zeros are gone (ACI Worldwide is
// 004498101).
func TestHTMLTableSlashLabelAndShortCUSIP(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H52_slash_label_short_cusip.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "ACI Worldwide Inc" {
			continue
		}
		seen++
		if r[colMeetingDate] != "20080610" || r[colCUSIP] != "004498101" {
			t.Fatalf("ACI: date %q cusip %q (%s)", r[colMeetingDate], r[colCUSIP], r[colVoteDescription])
		}
		if r[colHowVoted] != "For" {
			t.Fatalf("ACI: how_voted %q", r[colHowVoted])
		}
	}
	if seen < 2 {
		t.Fatalf("%d ACI Worldwide rows among %d", seen, len(rows))
	}
}
