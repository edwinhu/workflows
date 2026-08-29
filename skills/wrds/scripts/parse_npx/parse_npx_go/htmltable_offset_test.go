package main

import "testing"

// A shape where the header has FEWER columns than its data rows, because the
// item-number column carries no label. 129 filings in the HTML residue use it.
//
//	[4]  Proposal | Proposed by | Mgt. Position | Registrant Voted
//	[5]  ABBOTT LABORATORIES Security ID: 002824100 Ticker: ABT Meeting Date: 29-Apr-22 1.1 | Elect Robert J. Alpern | Management | For | Voted - For
//	[5]  1.2 | Elect Sally E. Blount | Management | For | Voted - For
//
// Mapping positionally from the header would shift every field by one and give
// desc="1.1", by="Elect Robert J. Alpern", mgmtrec="Management", vote="For" --
// a whole filing of plausible, wrong rows on funds ISS Voting Analytics does not
// cover. The layout declines this today and that is CORRECT; the tests below
// demand it parse, and a partial implementation that shifts the columns must
// fail them rather than pass by producing rows.
//
// Two deterministic facts make it parseable. The data rows carry consistently ONE
// more cell than the header and their first cell is an item number, so the header
// maps from index 1. And the first data row of each block glues the meeting
// context into cell 0 as labelled fields -- `<ISSUER> Security ID: <cusip>
// Ticker: <tkr> Meeting Date: <date> <item>` -- which is where the block's issuer,
// CUSIP, ticker and date come from.

func TestHTMLTableUnlabelledItemColumn(t *testing.T) {
	rows := runISSNPXDoc(t, loadNil(t, "H5_unlabelled_item_col.txt"))
	if len(rows) != 7 {
		t.Fatalf("produced %d rows, want 7 -- the fixture holds one header and seven"+
			" proposal rows", len(rows))
	}

	// Row 0 is the row whose first cell also carries the meeting context.
	first := rows[0]
	for _, f := range []struct{ name, got, want string }{
		{"issuer_name", first[colIssuerName], "ABBOTT LABORATORIES"},
		{"cusip", first[colCUSIP], "002824100"},
		{"ticker", first[colTicker], "ABT"},
		{"meeting_date", first[colMeetingDate], "20220429"},
		{"item_seq", first[colItemSeq], "1.1"},
		{"vote_description", first[colVoteDescription], "Elect Robert J. Alpern"},
		{"vote_source", first[colVoteSource], "Management"},
		{"management_recommendation", first[colMgmtRec], "For"},
		{"how_voted", first[colHowVoted], "Voted - For"},
	} {
		if f.got != f.want {
			t.Errorf("row 0 %s = %q, want %q", f.name, f.got, f.want)
		}
	}

	// Row 1 has no context prefix; its columns must land identically. If the
	// mapping were shifted, desc would hold an item number here.
	second := rows[1]
	if got := second[colItemSeq]; got != "1.2" {
		t.Errorf("row 1 item_seq = %q, want %q", got, "1.2")
	}
	if got := second[colVoteDescription]; got != "Elect Sally E. Blount" {
		t.Errorf("row 1 vote_description = %q, want %q -- a shifted mapping puts the item"+
			" number here", got, "Elect Sally E. Blount")
	}
	if got := second[colHowVoted]; got != "Voted - For" {
		t.Errorf("row 1 how_voted = %q, want %q", got, "Voted - For")
	}
	// Every row inherits the block's meeting context.
	for i, r := range rows {
		if r[colCUSIP] != "002824100" {
			t.Errorf("row %d cusip = %q, want the block's 002824100", i, r[colCUSIP])
		}
	}
}
