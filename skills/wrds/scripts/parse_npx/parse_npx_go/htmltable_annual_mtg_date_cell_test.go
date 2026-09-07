package main

import "testing"

// Hillview Investment Trust II 2005 (000111/1111535/0000950159-05-001013.txt,
// 1,326 of 2,387 rows undated, and its sibling 0000950159-05-001509.txt, 1,320
// of 2,381): the identity strip prints the meeting date behind a
// meeting-type-prefixed abbreviated label, wrapped over the line break inside
// its own cell -- `<strong>Annual` on one line and `Mtg Date: 10/20/2004` on
// the next, beside `Ticker: DEO` and above `Issuer: 25243Q`. The issuer, the
// CUSIP-6 and the ticker are all read; only `Mtg Date:` is not a label the
// parser knows, so the date is dropped.
func TestHTMLTableAnnualMtgDateCell(t *testing.T) {
	rows := htmlBlockRows(t, "H86_annual_mtg_date_cell.txt")
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colMeetingDate] != "20041020" {
			t.Errorf("meeting date = %q, want 20041020 (%s / %s)",
				r[colMeetingDate], r[colIssuerName], r[colVoteDescription])
		}
	}
}
