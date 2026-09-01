package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestISSNPXDoesNotClaimTheSharesTable pins a table this layout must NOT read.
//
// One registrant files two grammars in one document. The ISS one this layout
// owns:
//
//	#      Proposal                          Mgt Rec   Vote Cast   Sponsor
//
// and, further down, another administrator's, whose identity columns live in a
// PARALLEL table to the left and whose own header is:
//
//	   Shares
//	Available              Item                          Management     Vote
//	  to Vote Proponet     Number Proposal               Recommendation Instruction
//	     1965 Management   1.1    Elect Director M. Jay Allison    For     For
//
// issTableHeader only recognises a line starting with `#`, so the second header
// does not close the first table. The rows are then read with issnpx's own
// column order: the SHARE COUNT becomes the item number and the whole row lands
// in the proposal text -- and, because the meeting is still the one the `#`
// section set, NRG Energy's votes are filed under Wyeth's CUSIP and meeting
// date. A wrong issuer, not a missing one.
//
// Measured 2026-09-01: 14,471 rows across 74 filings carry this signature.
// Reading the grammar correctly needs the parallel identity table, which is the
// splittable layout's job; what this layout owes is to stop claiming it.
func TestISSNPXDoesNotClaimTheSharesTable(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "D6_shares_table_wrong_meeting.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	for _, r := range runISSNPXDoc(t, string(b)) {
		item := r[colItemSeq]
		if len(item) >= 3 && item[0] >= '1' && item[0] <= '9' && issAllDigits(item) {
			t.Errorf("emitted item %q (cusip %q, %q) -- that is a SHARE COUNT read as an"+
				" item number, and the meeting is the previous section's",
				item, r[colCUSIP], r[colVoteDescription])
		}
	}
}

func issAllDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return len(s) > 0
}

// TestISSNPXDoesNotClaimTheHTMLSummaryTable is the same defect as
// TestISSNPXDoesNotClaimTheSharesTable, reached through a different foreign
// grammar.
//
// The document ends with an HTML <TABLE> whose header cells become one line
// each -- `Issuer Name`, `Ticker`, `Meeting Date`, `Primary Security ID`,
// `Meeting Type`, `Record Date`, `Proposal Number`, `Proposal Text`,
// `Proponent`, `Mgmt Rec` -- and whose rows flatten to
//
//	3i Infrastructure plc 3IN 07/05/2018 G8873L178 Annual 07/03/2018 1
//	Accept Financial Statements and Statutory Reports ...
//
// Nothing there starts with `#`, so issTableHeader does not close the ISS table
// above it, and each flattened row is read as a proposal line: the issuer,
// ticker, date and CUSIP all land in the proposal text, and the meeting stays
// whatever the last ISS section set.
//
// issForeignTableHeader already existed for the shares grammar but keys on
// PROPONET/PROPONENT together with another word on the SAME line; here each
// header cell is alone on its own line, so it never fired. Measured 2026-09-01
// this filing alone contributes 1,895 of issnpx's 2,412 spliced-cell rows.
func TestISSNPXDoesNotClaimTheHTMLSummaryTable(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "D7_html_summary_table.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	rows := runISSNPXDoc(t, string(b))
	for _, r := range rows {
		if d := r[colVoteDescription]; len(d) > 0 &&
			(containsAll(d, "3IN", "G8873L178") || containsAll(d, "Infrastructure plc", "Annual")) {
			t.Errorf("emitted %q -- that is a row of the HTML summary table, not a proposal", d)
		}
	}

	// The ISS section above it must still be read.
	var seen bool
	for _, r := range rows {
		if r[colVoteDescription] == "Designate Two Shareholders to Sign Minutes of Meeting" {
			seen = true
		}
	}
	if !seen {
		t.Errorf("the ISS section above the foreign table was lost; got %d rows", len(rows))
	}
}

func containsAll(s string, subs ...string) bool {
	for _, sub := range subs {
		if !strings.Contains(s, sub) {
			return false
		}
	}
	return true
}
