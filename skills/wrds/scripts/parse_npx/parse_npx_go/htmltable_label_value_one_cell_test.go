package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Principal Variable Contracts Funds 2008 (0000012601-08-000022; 431 of 513
// rows with no date and 485 with no id on r155): the identity row prints each
// label WITH its value in one cell -- `Meeting Date/Type 05/06/08 AGM |
// Security H01301102 | Shares Voted 74,800`. A row of an earlier block lent
// its date to Alcon's votes.
func TestHTMLTableLabelAndValueInOneCell(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H53_label_value_one_cell.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "Alcon Inc." {
			continue
		}
		seen++
		if r[colMeetingDate] != "20080506" || r[colCUSIP] != "H01301102" {
			t.Fatalf("Alcon: date %q cusip %q (%s)", r[colMeetingDate], r[colCUSIP], r[colVoteDescription])
		}
	}
	if seen < 2 {
		t.Fatalf("%d Alcon rows among %d", seen, len(rows))
	}
}

// Advisors Preferred Trust 2023 (0001580642-23-004412; 450 rows, none dated,
// on r155): the SEC lettered table's date cell is `05/11/2023 - Annual`, the
// meeting type after a dash, as in the SSgA grid's `05/24/06 - A` but spelt
// out.
func TestHTMLTableDateDashMeetingType(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H54_date_dash_annual.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "Verizon Communications Inc." {
			continue
		}
		seen++
		if r[colMeetingDate] != "20230511" || r[colCUSIP] != "92343V104" {
			t.Fatalf("Verizon: date %q cusip %q (%s)", r[colMeetingDate], r[colCUSIP], r[colVoteDescription])
		}
	}
	if seen < 2 {
		t.Fatalf("%d Verizon rows among %d", seen, len(rows))
	}
}
