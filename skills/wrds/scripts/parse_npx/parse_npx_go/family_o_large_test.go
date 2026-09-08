package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Both PIMCO sections print Consent Date rather than Meeting Date.
func TestFamilyOLargeConsentDate(t *testing.T) {
	for _, tc := range []struct {
		file, cusip, date string
	}{
		// 0000067590-07-000256, lines 9233-9262.
		{"O_large_consent_814679.txt", "605056AB6", "20070418"},
		// 0000067590-07-000259, lines 12007-12035.
		{"O_large_consent_1035018.txt", "05366BAB8", "20060814"},
	} {
		t.Run(tc.file, func(t *testing.T) {
			rows := familyOLargeRows(t, "issnpx", tc.file)
			found := false
			for _, r := range rows {
				if r[colCUSIP] != tc.cusip {
					continue
				}
				found = true
				if r[colMeetingDate] != tc.date {
					t.Errorf("issuer=%q date=%q want %s; description=%q layout=%q", r[colIssuerName], r[colMeetingDate], tc.date, r[colVoteDescription], r[len(r)-1])
				}
			}
			if !found {
				t.Fatalf("no emitted vote for security %s", tc.cusip)
			}
		})
	}
}

// 0000950135-04-004268, lines 22219-22365. Keep the entire real-estate
// table to preserve its header and year continuation boundaries.
func TestFamilyOLargeNextLineYear(t *testing.T) {
	rows := familyOLargeRows(t, "issnpx", "O_large_next_line_year.txt")
	found := false
	for _, r := range rows {
		if r[colCUSIP] != "02607P305" {
			continue
		}
		found = true
		if r[colMeetingDate] != "20030925" {
			t.Errorf("issuer=%q date=%q want 20030925; description=%q layout=%q", r[colIssuerName], r[colMeetingDate], r[colVoteDescription], r[len(r)-1])
		}
	}
	if !found {
		t.Fatal("no emitted vote for AMERICAN FINANCIAL REALTY TRUST")
	}
}

// 0001324443-08-000065, lines 346-618: the label cell contains JUN,
// while the adjacent cell supplies 3, 2008. The neighboring complete table
// supplies the repeated header evidence required by dispatch and a dated control.
func TestFamilyOLargePartialMonthCell(t *testing.T) {
	rows := familyOLargeRows(t, "htmltable", "O_large_partial_month_cell.txt")
	found := false
	for _, r := range rows {
		want := "20080508"
		if r[colIssuerName] == "AFFILIATED MANAGERS GROUP" {
			want = "20080603"
			found = true
		}
		if r[colMeetingDate] != want {
			t.Errorf("issuer=%q date=%q want %s; description=%q layout=%q", r[colIssuerName], r[colMeetingDate], want, r[colVoteDescription], r[len(r)-1])
		}
	}
	if !found {
		t.Fatal("no emitted vote for AFFILIATED MANAGERS GROUP")
	}
}

// 0000834798-05-000012, lines 309-594: the three value cells are MAY,
// 17, and 2005. Both complete tables are needed for identity-to-vote dispatch.
func TestFamilyOLargeThreeDateValueCells(t *testing.T) {
	rows := familyOLargeRows(t, "htmltable", "O_large_three_date_value_cells.txt")
	for _, r := range rows {
		if r[colMeetingDate] != "20050517" {
			t.Errorf("issuer=%q date=%q want 20050517; description=%q layout=%q", r[colIssuerName], r[colMeetingDate], r[colVoteDescription], r[len(r)-1])
		}
	}
}

func familyOLargeRows(t *testing.T, layout, name string) [][]string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", layout, name))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no emitted votes")
	}
	for _, r := range rows {
		if r[len(r)-1] != layout {
			t.Fatalf("layout=%q want %s", r[len(r)-1], layout)
		}
	}
	return rows
}
