package main

import (
	"os"
	"path/filepath"
	"testing"
)

func htmlBlockRows(t *testing.T, name string) [][]string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", name))
	if err != nil {
		t.Fatal(err)
	}
	return runISSNPXDoc(t, string(b))
}

func htmlExpectIssuer(t *testing.T, rows [][]string, issuer, date, cusip string, min int) {
	t.Helper()
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != issuer {
			continue
		}
		seen++
		if r[colMeetingDate] != date || r[colCUSIP] != cusip {
			t.Fatalf("%s: date %q cusip %q (%s)", issuer, r[colMeetingDate], r[colCUSIP], r[colVoteDescription])
		}
	}
	if seen < min {
		t.Fatalf("%d %s rows among %d", seen, issuer, len(rows))
	}
}

// CM Advisors Family of Funds 2017 (0001398344-17-009504; 722 of 722 rows undated
// on r185): the identity rows span their label cells -- `| Security (4) |
// 008474108 | | Meeting Type (2) | Annual` over `| Ticker Symbol (4) | AEM | |
// Meeting Date (2) | 28-Apr-2017` -- so the bare label lands in the last column
// of its span and the value sits in the cell after it.
func TestHTMLTableSpannedBareLabels(t *testing.T) {
	htmlExpectIssuer(t, htmlBlockRows(t, "H67_spanned_bare_labels.txt"), "AGNICO EAGLE MINES LIMITED", "20170428", "008474108", 3)
}

// FS Series Trust 2020 (0001104659-20-097460; 595 of 595 rows undated on r185):
// the identity is four label rows INSIDE the vote table -- `Issuer | Bank of
// America Corporation`, `Ticker | BAC`, `CUSIP | 060505104`, `Meeting Date |
// 22-Apr-20` -- each with the label in the first column and the value in the
// second, the vote columns empty.
func TestHTMLTableBareLabelRowsInVoteTable(t *testing.T) {
	htmlExpectIssuer(t, htmlBlockRows(t, "H68_bare_label_rows_in_vote_table.txt"), "Bank of America Corporation", "20200422", "060505104", 3)
}

// Bragg Capital Trust 2020 (0001398344-20-017260; 888 of 888 rows undated on
// r185): a block opens with the issuer over two columns, then `Ticker | PFE |
// CUSIP: | 717081103`, and the dates row reads `Record | Meeting | 4/23/2020`
// -- the record-date label with no value, then a bare `Meeting` label whose
// value is the meeting date.
func TestHTMLTableRecordMeetingLabelRow(t *testing.T) {
	htmlExpectIssuer(t, htmlBlockRows(t, "H69_record_meeting_label_row.txt"), "Pfizer Inc.", "20200423", "717081103", 3)
}
