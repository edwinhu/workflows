package main

import (
	"fmt"
	"strings"
	"testing"
)

// Two defects the clean single-table fixtures cannot reach, both raised by review
// and both verified against the built tree before this file was written.
//
// They matter more than their size suggests because this layout exists to parse
// the filings ISS Voting Analytics does NOT cover. Nothing downstream compares
// these rows against an independent source, so a wrong meeting or a shifted
// column is caught by nothing: it enters the panel looking like good data.

func htmlDoc(body string) string {
	return "<SEC-DOCUMENT>0000000000-08-000001.txt : 20080630\n" +
		"<SEC-HEADER>0000000000-08-000001.hdr.sgml : 20080630\n" +
		"ACCESSION NUMBER:\t\t0000000000-08-000001\n" +
		"CONFORMED SUBMISSION TYPE:\tN-PX\n" +
		"CONFORMED PERIOD OF REPORT:\t20080630\n" +
		"\tCOMPANY DATA:\n\t\tCENTRAL INDEX KEY:\t\t\t0000823535\n" +
		"</SEC-HEADER>\n<DOCUMENT>\n<TYPE>N-PX\n<SEQUENCE>1\n<FILENAME>r.txt\n<TEXT>\n" +
		"<TABLE>\n" + body + "</TABLE>\n</TEXT>\n</DOCUMENT>\n"
}

func htmlRow(cells ...string) string {
	var b strings.Builder
	b.WriteString("<TR>")
	for _, c := range cells {
		b.WriteString("<TD>" + c + "</TD>")
	}
	b.WriteString("</TR>\n")
	return b.String()
}

// TestHTMLTableContextRowIsNotEatenAsData: a meeting-context row whose cell count
// falls inside the arity tolerance must still be READ as context. The data-row
// branch is tested first and unconditionally continues, so such a row is consumed
// and the PREVIOUS meeting's issuer, CUSIP and date stay attached to the next
// block's votes -- wrong meeting attribution, silently.
func TestHTMLTableContextRowIsNotEatenAsData(t *testing.T) {
	doc := htmlDoc(
		htmlRow("ISSUER NAME: ALPHA CORP", "", "MEETING DATE: 05/14/2008", "", "") +
			htmlRow("TICKER: ALPH", "", "SECURITY ID: 111111111", "", "") +
			htmlRow("Proposal No", "Proposal", "Proposed By", "Management Recommendation", "Vote Cast") +
			htmlRow("1.1", "ELECT ALPHA DIRECTOR", "Management", "For", "For") +
			htmlRow("ISSUER NAME: BETA CORP", "", "MEETING DATE: 09/20/2009", "", "") +
			htmlRow("TICKER: BETA", "", "SECURITY ID: 222222222", "", "") +
			htmlRow("Proposal No", "Proposal", "Proposed By", "Management Recommendation", "Vote Cast") +
			htmlRow("1.1", "ELECT BETA DIRECTOR", "Management", "For", "Against"))

	rows := runISSNPXDoc(t, doc)
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2 (one per block)", len(rows))
	}
	var beta []string
	for _, r := range rows {
		if strings.Contains(r[colVoteDescription], "BETA") {
			beta = r
		}
	}
	if beta == nil {
		t.Fatalf("no row for the second block")
	}
	for _, f := range []struct{ name, got, want string }{
		{"issuer_name", beta[colIssuerName], "BETA CORP"},
		{"cusip", beta[colCUSIP], "222222222"},
		{"ticker", beta[colTicker], "BETA"},
		{"meeting_date", beta[colMeetingDate], "20090920"},
	} {
		if f.got != f.want {
			t.Errorf("second block %s = %q, want %q -- the first block's meeting context"+
				" leaked onto the second block's vote", f.name, f.got, f.want)
		}
	}
}

// TestHTMLTableMappingIsDeterministic: htmlMapFields iterates a Go map in both
// its exact and its word-sequence pass, and breaks ties with `>` rather than
// `>=`. Go randomises map iteration order, so when synonyms of equal length from
// DIFFERENT fields match one header cell, the winner is whichever the runtime
// visited first. The same filing then parses differently between runs, which no
// reproducible dataset can tolerate.
func TestHTMLTableMappingIsDeterministic(t *testing.T) {
	doc := htmlDoc(
		htmlRow("ISSUER NAME: ALPHA CORP", "", "MEETING DATE: 05/14/2008", "", "") +
			htmlRow("Proposal", "Issuer / Ticker", "Proposed By", "Mgmt Rec", "Vote Cast") +
			htmlRow("1.1", "ALPH", "Management", "For", "For") +
			htmlRow("1.2", "ALPH", "Management", "For", "Against"))

	sig := func(rows [][]string) string {
		var b strings.Builder
		for _, r := range rows {
			fmt.Fprintf(&b, "%s|%s|%s|%s|%s;",
				r[colItemSeq], r[colVoteDescription], r[colVoteSource],
				r[colMgmtRec], r[colHowVoted])
		}
		return b.String()
	}
	want := sig(runISSNPXDoc(t, doc))
	for i := 1; i <= 12; i++ {
		if got := sig(runISSNPXDoc(t, doc)); got != want {
			t.Fatalf("run %d produced a DIFFERENT column mapping for the same bytes:\n"+
				"  run 0: %s\n  run %d: %s\n"+
				"  htmlMapFields iterates a Go map and breaks ties with `>`, so the field"+
				" that claims a cell depends on runtime iteration order", i, want, i, got)
		}
	}
}

// TestHTMLTableMappingDoesNotFloatIntoTheNextTable is the cost of the repeat
// witness, and it lands on the exact failure the strict header test exists to
// prevent.
//
// Accepting a candidate header because the same tuple RECURS is sound only if the
// header actually governs rows. A tuple that repeats with nothing beneath it is
// not a header -- it is a repeated label, a page banner, a column legend. If such
// a mapping is accepted AND the table-boundary reset is relaxed, it survives
// </table> and the next table's rows are read through a header belonging to a
// different table entirely.
//
// The document below is constructed: a first table whose header tuple appears
// twice with NO data rows under either, then a SECOND table whose rows share the
// arity but whose own header is not recognisable. Nothing here should be parsed.
// Emitting rows means the first table's mapping floated.
func TestHTMLTableMappingDoesNotFloatIntoTheNextTable(t *testing.T) {
	doc := "<SEC-DOCUMENT>0000000000-08-000002.txt : 20080630\n" +
		"<SEC-HEADER>0000000000-08-000002.hdr.sgml : 20080630\n" +
		"ACCESSION NUMBER:\t\t0000000000-08-000002\n" +
		"CONFORMED SUBMISSION TYPE:\tN-PX\n" +
		"CONFORMED PERIOD OF REPORT:\t20080630\n" +
		"\tCOMPANY DATA:\n\t\tCENTRAL INDEX KEY:\t\t\t0000823535\n" +
		"</SEC-HEADER>\n<DOCUMENT>\n<TYPE>N-PX\n<SEQUENCE>1\n<FILENAME>r.txt\n<TEXT>\n" +
		"<TABLE>\n" +
		htmlRow("Proposal No", "Proposal", "Proposed By", "Management Recommendation", "Vote Cast") +
		htmlRow("Proposal No", "Proposal", "Proposed By", "Management Recommendation", "Vote Cast") +
		"</TABLE>\n<TABLE>\n" +
		htmlRow("Acme Industries", "037833100", "05/14/2008", "Annual", "17,500") +
		htmlRow("Beta Holdings", "594918104", "06/02/2008", "Special", "9,250") +
		"</TABLE>\n</TEXT>\n</DOCUMENT>\n"

	rows := runISSNPXDoc(t, doc)
	if len(rows) != 0 {
		t.Fatalf("produced %d rows from a document whose only recognised header governs NO"+
			" rows: the mapping floated past </table> and the second table's cells were read"+
			" through it", len(rows))
	}
}

// TestHTMLHyphenatedCUSIPDisqualifiesAHeader closes a gap codex review found and
// that my own H7 fixture demonstrates: htmlIsCUSIP recognises exactly nine
// unpunctuated alphanumerics, so the printed form `002824-10-0` is not seen as a
// value. A context row carrying it can therefore pass the label-only header test,
// map three fields, and be adopted as a header -- putting an issuer name, a
// hyphenated CUSIP and a date into the description, proposer and vote columns.
//
// EDGAR prints CUSIPs both ways. A value test that only knows one spelling is a
// header test with a hole in it, on the population where a wrong column mapping
// cannot be caught downstream.
func TestHTMLHyphenatedCUSIPDisqualifiesAHeader(t *testing.T) {
	doc := htmlDoc(
		// A context row in the printed style: it is DATA, not a header.
		htmlRow("Issuer: Abbott Laboratories", "Ticker: ABT", "CUSIP: 002824-10-0", "Meeting Date: 04/28/2006") +
			htmlRow("Elect Directors", "MGMT", "For", "For") +
			htmlRow("Ratify Auditors", "MGMT", "For", "For") +
			htmlRow("Approve Compensation", "MGMT", "For", "Against"))

	for i, r := range runISSNPXDoc(t, doc) {
		if d := r[colVoteDescription]; d == "Issuer: Abbott Laboratories" || d == "Elect Directors" && r[colHowVoted] == "For" {
			continue // the second is a legitimate parse if a real header were found
		}
		if r[colHowVoted] == "Meeting Date: 04/28/2006" || r[colVoteSource] == "CUSIP: 002824-10-0" {
			t.Fatalf("row %d mapped a context row as a header: vote_source=%q how_voted=%q."+
				" `CUSIP: 002824-10-0` is a printed CUSIP and must disqualify a header candidate;"+
				" htmlIsCUSIP only recognises the nine-character unpunctuated spelling.",
				i, r[colVoteSource], r[colHowVoted])
		}
	}
}
