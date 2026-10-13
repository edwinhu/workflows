package main

import (
	"strings"
	"testing"
)

// 157 of the 277 filings carrying this header were not claimed by the layout at all.
// 62 of them share one shape signature, and sampling that cluster found two further
// renderings. Neither is exotic; both are the same grammar with furniture the layout
// had not been taught.
//
// PV5 -- EDGAR TABLE MARKUP AFTER THE HEADER:
//
//	ISSUER NAME                     TICKER    CUSIP     MTG DATE   MTG TYPE
//	                                          Proposal Type  Voted?  Vote  For/Agnst Mgmt
//	- -----------------------------------------------------------------------
//	<S>     <C>                     <C>       <C>       <C>        <C>
//
// The two header lines match, then a dashed rule and an SGML column-width marker
// follow. Both are furniture, but the layout closed the table on the first one, so
// these filings yielded nothing at all.
//
// PV6 -- A BLANK LINE INSIDE THE HEADER:
//
//	ISSUER NAME    TICKER    CUSIP    MTG    DATE    MTG    TYPE
//
//	       Proposal Type Voted? Vote For/Agnst Mgmt
//
// The header's two lines are separated by a blank, so a rule requiring them adjacent
// finds no header. This rendering also separates its fields with TABS and prints
// `NOT VOTED` as a vote value.
//
// Ground truth is the count of item-numbered lines in each contiguous excerpt, each
// cut to begin at the header: 40 and 22.

func loadPV(t *testing.T, name string) string { return loadPVFixture(t, name) }

func TestPVTextSkipsEDGARTableMarkup(t *testing.T) {
	rows := runISSNPXDoc(t, loadPV(t, "PV5_sgml_markup.txt"))
	if len(rows) != 39 {
		t.Fatalf("got %d rows, want 39 -- a dashed rule and an <S>/<C> column marker sit"+
			" between the header and the first meeting, and closed the table", len(rows))
	}
	for i, r := range rows {
		if d := r[colVoteDescription]; d == "" || strings.HasPrefix(d, "<") || strings.HasPrefix(d, "-") {
			t.Fatalf("row %d description %q -- markup furniture emitted as a vote", i, d)
		}
	}
}

func TestPVTextHeaderMaySpanABlankLine(t *testing.T) {
	rows := runISSNPXDoc(t, loadPV(t, "PV6_blank_in_header.txt"))
	// 21, not the 22 item-numbered lines the fixture contains. One of them --
	// `7.00 Elect David K.` -- was TRUNCATED by a page break, and what follows is a
	// REPRINT of the same block rather than its continuation, so its vote columns do
	// not exist anywhere in this excerpt. Declining it is correct: a row cannot be
	// completed from text the filing does not contain at this point, and inventing one
	// would put a value in a verbatim column that was never printed.
	if len(rows) != 21 {
		t.Fatalf("got %d rows, want 21 -- this rendering separates the two header lines"+
			" with a blank line, and its fields with tabs", len(rows))
	}
	for i, r := range rows {
		hv := strings.ToUpper(strings.TrimSpace(r[colHowVoted]))
		switch hv {
		case "FOR", "AGNST", "AGAINST", "ABSTAIN", "WITHHELD", "WITHHOLD",
			"TAKE NO ACTION", "NOT VOTED", "DID NOT VOTE", "NONE", "NON-VOTING":
		default:
			t.Errorf("row %d (%q) how_voted = %q, which this filing does not print",
				i, r[colVoteDescription], r[colHowVoted])
		}
	}
}
