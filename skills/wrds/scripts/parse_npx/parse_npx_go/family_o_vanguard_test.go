package main

import (
	"os"
	"testing"
)

// 000153/1537140/0000910472-14-003863.txt:776-1225 is one entire
// table. Lines 830-833 print Special Shareholder Meeting Date: 6/10/2014;
// lines 1045-1048 print the following issuer's Shareholder Meeting Date: 5/22/2014.
func TestFamilyONorthernSpecialShareholderMeetingDate(t *testing.T) {
	path := "testdata/htmltable/O_vanguard_northern_special.txt"
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	res := parseText(b, FilingMeta{FilePath: path})
	if res.Meta.Layout != "htmltable" || res.Meta.ParseStatus != "ok" {
		t.Fatalf("dispatch = %s/%s: %s", res.Meta.Layout, res.Meta.ParseStatus, res.Meta.ErrorMsg)
	}
	target, control := 0, 0
	for _, row := range res.Rows {
		switch row.CUSIP {
		case "4812A2587":
			target++
			if row.MeetingDate != "20140610" {
				t.Errorf("CUSIP %s proposal %q: meeting_date=%q, want 20140610 (Special Shareholder Meeting Date)", row.CUSIP, row.VoteDescription, row.MeetingDate)
			}
		case "52729N308":
			control++
			if row.MeetingDate != "20140522" {
				t.Errorf("CUSIP %s proposal %q: meeting_date=%q, want 20140522 (dated control)", row.CUSIP, row.VoteDescription, row.MeetingDate)
			}
		}
	}
	if target != 14 || control != 13 {
		t.Fatalf("target/control rows=%d/%d, want 14/13", target, control)
	}
}
