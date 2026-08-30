package main

import "testing"

// The page-break fixture, and a lesson about fixtures.
//
// Two earlier versions of this file were WRONG in ways that blamed the parser for my
// own cutting. The first concatenated two non-contiguous byte ranges, splicing two
// unrelated lines into `Ameriso` / `Purchase Plan MGMT YES FOR FOR`; the parser
// correctly closed the table on that corruption and 36 rows were charged to the
// layout. The second began mid-section, so its header was not in the excerpt, and 73
// of its counted lines were ones the parser could not legitimately claim -- declining
// them was right. Both times the ground truth measured the CUT rather than the filing.
//
// This fixture is ONE contiguous slice that begins exactly at an `ISSUER NAME` header,
// so every vote line it contains is one the layout is entitled to read: 147 rows
// across 3 `<PAGE>` breaks.
//
// The breaks are the point. `parsePVText` used to end the table on any line that was
// neither a meeting nor a vote, and page footers sit between a meeting's votes:
//
//	1.02   Elect Pei-Yuan Chia MGMT YES FOR FOR
//	                                     Page 1
//	<PAGE>
//	1.03   Elect Marshall A. Cohen MGMT YES FOR FOR   <- dropped, and everything after
//
// 43 of 60 sampled filings carry these breaks and one holds 72, which is why the
// layout extracted 8,825 rows against 520,449 vote-like lines corpus-wide.

func TestPVTextSurvivesPageBreaks(t *testing.T) {
	rows := runISSNPXDoc(t, loadPVFixture(t, "PV3_pagebreaks.txt"))
	if len(rows) != 79 {
		t.Fatalf("got %d rows, want 79 -- every vote line in this contiguous excerpt -- a layout that treats a"+
			" page footer as end-of-table drops every row after the first break", len(rows))
	}
	for i, r := range rows {
		if r[colVoteDescription] == "" {
			t.Fatalf("row %d has an empty description", i)
		}
		// Rows recovered after a break must still carry the meeting that was open
		// before it; an unattributed row is a different bug, not a fix.
		if r[colIssuerName] == "" {
			t.Fatalf("row %d (%q) carries no issuer -- the meeting context was lost"+
				" across a page break", i, r[colVoteDescription])
		}
	}
}
