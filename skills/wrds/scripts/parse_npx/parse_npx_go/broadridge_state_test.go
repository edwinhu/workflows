package main

import (
	"strings"
	"testing"
)

// Two defects that the verbatim fixtures structurally cannot reach, both raised
// by review of the shipped rule and both about the SAME failure: a block whose
// heading was not captured silently inherits whatever fund was current above it,
// so one fund's votes are recorded against another.
//
// THESE FIXTURES ARE CONSTRUCTED, NOT VERBATIM, AND THAT IS DELIBERATE.
// Everything under testdata/ is a real filing excerpt; these two cases are built
// in code instead, because I could not find a real one. A scan of 900 broadridge
// filings for an SGML-only line standing between a fund heading and its dashed
// rule returned ZERO. The shape is nonetheless reachable: removeMarkup (html.go)
// turns a block tag such as <PAGE> or </TABLE> into a newline, so any filing that
// paginates between the heading and the rule produces it, and the layout reads
// the resulting blank as "no heading here".
//
// Because the shape is constructed, its SCALE is unestablished. Review put it at
// "110k+ blocks"; the corpus does not support that -- the shipped rule stamps
// 14,683,481 of 22,922,623 rows (64.06%, from 6.26%), which is 68.0% of the
// attributable rows and ABOVE the recon report's 66.12% headline. So these tests
// exist because inheriting a stale fund is WRONG, not because it is common. The
// corpus bound on the damage is 239 multi-series filings stamping exactly one
// series (1,016,871 rows, 4.44%), which is also the shape of a filing where only
// one fund voted -- an upper bound, not a measurement.

const brSeriesHdr = "<SEC-DOCUMENT>0000000000-16-000001.txt : 20160630\n" +
	"<SEC-HEADER>0000000000-16-000001.hdr.sgml : 20160630\n" +
	"ACCESSION NUMBER:\t\t0000000000-16-000001\n" +
	"CONFORMED SUBMISSION TYPE:\tN-PX\n" +
	"CONFORMED PERIOD OF REPORT:\t20160630\n" +
	"\tCOMPANY DATA:\n\t\tCENTRAL INDEX KEY:\t\t\t0000701804\n" +
	"<SERIES-AND-CLASSES-CONTRACTS-DATA>\n<EXISTING-SERIES-AND-CLASSES-CONTRACTS>\n" +
	"<SERIES>\n<OWNER-CIK>0000701804\n<SERIES-ID>S000000111\n<SERIES-NAME>Alpha Growth Fund\n</SERIES>\n" +
	"<SERIES>\n<OWNER-CIK>0000701804\n<SERIES-ID>S000000222\n<SERIES-NAME>Beta Income Fund\n</SERIES>\n" +
	"</EXISTING-SERIES-AND-CLASSES-CONTRACTS>\n</SERIES-AND-CLASSES-CONTRACTS-DATA>\n</SEC-HEADER>\n"

// brBlock is one meeting block in the broadridge grammar, matching the shape of
// the real fixtures: issuer line at indent 1 carrying `Agenda Number`, then the
// meeting fields, then a two-row proposal slate.
func brBlock(issuer, cusip string) string {
	rule := strings.Repeat("-", 120)
	return rule + "\n" +
		" " + issuer + "                                        Agenda Number:  934311034\n" +
		rule + "\n" +
		"        Security:  " + cusip + "\n" +
		"    Meeting Type:  Annual\n" +
		"    Meeting Date:  28-Jan-2016\n" +
		"          Ticker:  APD\n" +
		"            ISIN:  US0091581068\n\n" +
		"Prop.# Proposal                                      Proposal     Proposal Vote      For/Against\n" +
		"                                                     Type         Mgt Rec            Management\n" +
		"1      Elect Director Jane Doe                       Management   For       For      For\n" +
		"2      Ratify Auditors                               Management   For       For      For\n\n"
}

func brDoc(body string) string {
	return brSeriesHdr +
		"<DOCUMENT>\n<TYPE>N-PX\n<SEQUENCE>1\n<FILENAME>report.txt\n<TEXT>\n" +
		body + "\n</TEXT>\n</DOCUMENT>\n"
}

// seriesCounts returns series_id -> row count for a parsed document.
func seriesCounts(t *testing.T, doc string) map[string]int {
	t.Helper()
	out := map[string]int{}
	for _, r := range runISSNPXDoc(t, doc) {
		out[r[colSeriesID]]++
	}
	return out
}

// TestBroadridgeHeadingBehindPageBreakIsNotInherited: an SGML-only line between
// the heading and its dashed rule must not cost the heading. The failure that
// matters is not the blank stamp -- it is that Beta's block silently takes
// Alpha's series.
func TestBroadridgeHeadingBehindPageBreakIsNotInherited(t *testing.T) {
	doc := brDoc(
		"Alpha Growth Fund\n" + brBlock("AIR PRODUCTS AND CHEMICALS, INC.", "009158106") +
			"Beta Income Fund\n<PAGE>\n" + brBlock("3M COMPANY", "88579Y101"))

	got := seriesCounts(t, doc)
	if got["S000000111"] == 0 {
		t.Fatalf("Alpha's own block lost its series; got %v", got)
	}
	if got["S000000222"] == 0 {
		t.Errorf("Beta's block carries no S000000222; a <PAGE> between the heading and"+
			" its rule cost the heading entirely\n  got %v", got)
	}
	if got["S000000111"] > 2 {
		t.Errorf("S000000111 is stamped on %d rows but Alpha governs only one 2-row block"+
			" -- Beta's rows were attributed to Alpha, which is one fund's votes recorded"+
			" against another\n  got %v", got["S000000111"], got)
	}
}

// TestBroadridgeFurnitureRejectedHeadingClearsState: a candidate rejected as
// table furniture is still a section boundary. Leaving the previous fund
// standing attributes the next section's votes to it.
func TestBroadridgeFurnitureRejectedHeadingClearsState(t *testing.T) {
	doc := brDoc(
		"Alpha Growth Fund\n" + brBlock("AIR PRODUCTS AND CHEMICALS, INC.", "009158106") +
			"SEDOL(S) QUICK CODE\n" + brBlock("3M COMPANY", "88579Y101"))

	got := seriesCounts(t, doc)
	if got["S000000111"] > 2 {
		t.Errorf("S000000111 is stamped on %d rows, but the second block sits under a heading"+
			" slot rejected as table furniture. A rejected candidate is still a heading:"+
			" leaving Alpha standing records the second section's votes as Alpha's\n  got %v",
			got["S000000111"], got)
	}
}

// TestBroadridgeAmbiguousNameIsNotRescuedByTheCodeStrip: the 4-character code
// strip exists to recover a heading that found NO match. Retrying it after an
// AMBIGUOUS lookup converts a deliberate no-stamp into a stamp, which is the one
// thing the collision rule exists to prevent.
func TestBroadridgeAmbiguousNameIsNotRescuedByTheCodeStrip(t *testing.T) {
	hdr := strings.Replace(brSeriesHdr,
		"<SERIES-ID>S000000222\n<SERIES-NAME>Beta Income Fund\n",
		"<SERIES-ID>S000000222\n<SERIES-NAME>Alpha Growth Fund\n", 1)
	doc := hdr + "<DOCUMENT>\n<TYPE>N-PX\n<SEQUENCE>1\n<FILENAME>report.txt\n<TEXT>\n" +
		"2A14 Alpha Growth Fund\n" + brBlock("AIR PRODUCTS AND CHEMICALS, INC.", "009158106") +
		"\n</TEXT>\n</DOCUMENT>\n"

	for id, n := range seriesCounts(t, doc) {
		if id != "" && n > 0 {
			t.Errorf("stamped %q on %d rows, but 'Alpha Growth Fund' is declared by TWO"+
				" distinct series here, so the name is ambiguous and must stamp NOTHING."+
				" The code strip may only rescue a heading that found no match at all.", id, n)
		}
	}
}

// TestBroadridgeAmbiguousHeadingBehindPageBreakStampsNothing is the residue case
// from the round-3 review: the page-break repair must not turn an AMBIGUOUS
// heading into an inherited stamp. Ambiguity means the filing itself does not say
// which fund this is, so the only correct answer is to stamp nothing -- inheriting
// the fund above is the same defect the repair was for, one step along.
func TestBroadridgeAmbiguousHeadingBehindPageBreakStampsNothing(t *testing.T) {
	hdr := strings.Replace(brSeriesHdr,
		"<SERIES-ID>S000000222\n<SERIES-NAME>Beta Income Fund\n",
		"<SERIES-ID>S000000222\n<SERIES-NAME>Shared Name Fund\n", 1)
	hdr = strings.Replace(hdr,
		"<SERIES-ID>S000000111\n<SERIES-NAME>Alpha Growth Fund\n",
		"<SERIES-ID>S000000111\n<SERIES-NAME>Alpha Growth Fund\n</SERIES>\n"+
			"<SERIES>\n<OWNER-CIK>0000701804\n<SERIES-ID>S000000333\n<SERIES-NAME>Shared Name Fund\n", 1)

	doc := hdr + "<DOCUMENT>\n<TYPE>N-PX\n<SEQUENCE>1\n<FILENAME>report.txt\n<TEXT>\n" +
		"Alpha Growth Fund\n" + brBlock("AIR PRODUCTS AND CHEMICALS, INC.", "009158106") +
		"Shared Name Fund\n<PAGE>\n" + brBlock("3M COMPANY", "88579Y101") +
		"\n</TEXT>\n</DOCUMENT>\n"

	got := seriesCounts(t, doc)
	if got["S000000111"] > 2 {
		t.Errorf("S000000111 is stamped on %d rows. The second section's heading is declared by"+
			" TWO distinct series, so the filing does not say which fund it is and the answer"+
			" must be NO stamp -- inheriting Alpha records the second fund's votes as Alpha's\n"+
			"  got %v", got["S000000111"], got)
	}
}
