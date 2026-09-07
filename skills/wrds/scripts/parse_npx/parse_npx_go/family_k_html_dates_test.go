package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 000131/1314414/0001580642-22-004084.txt lines 618-669, verbatim.
func TestFamilyKHTMLContestedYearMeetingDate(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "family_k_html_contested_year_meeting.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	found := false
	for _, r := range rows {
		if r[10] != "BOX INC" || !strings.Contains(r[19], "Dana Evan") {
			continue
		}
		found = true
		if r[31] != "htmltable" || r[11] != "10316T104" {
			t.Fatalf("layout=%q cusip=%q, want htmltable and 10316T104", r[31], r[11])
		}
		if r[15] != "20210909" {
			t.Errorf("BOX INC meeting_date=%q, want 20210909 from 2021 Contested Annual Meeting / September 9, 2021", r[15])
		}
	}
	if !found {
		t.Fatal("BOX INC director vote missing from dispatch output")
	}
}
