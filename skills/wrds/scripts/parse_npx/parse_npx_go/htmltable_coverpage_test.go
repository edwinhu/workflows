package main

import (
	"strings"
	"testing"
)

// The largest single block left in the HTML residue, and the one that decides
// whether the remaining skip count means anything.
//
// Of the 5,529 HTML documents still declining, a grid scan splits them:
//
//	2,792  no vote vocabulary anywhere, fewer than 10 wide table rows  -> nil
//	2,271  vote vocabulary present (other header shapes, handled elsewhere)
//	  300  NO vocabulary but a HEADERLESS vote table
//	  166  no vocabulary, wide rows, unclear
//
// The 2,792 are cover pages: registrant name, address, signature, no vote record.
// They belong in ok/n_rows=0, the status README reserves for "the fund had
// nothing to vote". Leaving them in skip claims we failed to read a filing that
// holds nothing to read, and it buries the filings we genuinely cannot parse
// under five times their number in noise.
//
// THE TRAP, AND WHY THE RULE IS NOT "NO VOCABULARY MEANS NIL".
// H7 below carries 387 rows of real votes in an unlabelled positional table:
//
//	Election of Directors                    | MGMT  | YES | FOR ALL-DIRS | FOR
//	Proposal on Pay-for-Superior-Performance | SHLDR | YES | AGNST        | FOR
//
// There is no COLUMN HEADER above them; the meaning of each column is positional.
// CORRECTION, 2026-08-29: an earlier version of this comment claimed H7 matches no
// vote vocabulary at all. That is false about the bytes -- rows 4 and 5 print
// `CUSIP: 002824-10-0` and `Meeting Date: 04/28/2006`, both of which ARE in
// voteTableVocabulary, so the vocabulary check short-circuits before the table
// test is reached and this test passed for a reason other than the one it
// documented. The claim was written from the shape of the data rows without
// checking the fixture's own bytes. TestHTMLNilRuleRequiresBothHalves below
// exercises the table half directly, which is what this fixture cannot do.

// TestHTMLCoverPageIsNilNotSkip: a cover page with no vote record is ok/0 rows.
func TestHTMLCoverPageIsNilNotSkip(t *testing.T) {
	rows, status := runISSNPXDocStatus(t, loadNil(t, "H6_cover_page_only.txt"))
	if len(rows) != 0 {
		t.Fatalf("cover page produced %d vote rows, want 0", len(rows))
	}
	if status != "ok" {
		t.Errorf("parse_status = %q, want \"ok\": this filing carries a registrant, an address"+
			" and a signature, and no proxy voting record. Recording it as %q asserts we failed"+
			" to read it, which buries the filings we actually cannot parse.", status, status)
	}
}

// TestHTMLHeaderlessVoteTableIsNotNil is the guard on the rule above. This filing
// matches no vote vocabulary and MUST NOT be swept up as a nil report: it holds
// hundreds of real vote rows in an unlabelled positional table. Whether the
// layout can yet parse it is a separate question -- what it must never do is
// declare it empty.
func TestHTMLHeaderlessVoteTableIsNotNil(t *testing.T) {
	rows, status := runISSNPXDocStatus(t, loadNil(t, "H7_headerless_votes.txt"))
	if status == "ok" && len(rows) == 0 {
		t.Fatalf("declared a nil report (ok, 0 rows), but this filing's table holds real votes" +
			" -- `Election of Directors | MGMT | YES | FOR ALL-DIRS | FOR`. It matches no vote" +
			" vocabulary only because it has no header row; the columns are positional." +
			" A nil verdict needs no vocabulary AND no substantial table, not vocabulary alone.")
	}
}

// TestHTMLNilRuleRequiresBothHalves exercises the half H7 cannot reach: a document
// with NO vote vocabulary anywhere AND a real vote table. Neither condition alone
// may produce a nil verdict.
func TestHTMLNilRuleRequiresBothHalves(t *testing.T) {
	doc := htmlDoc(
		htmlRow("Elect Directors", "MGMT", "YES", "FOR ALL", "FOR") +
			htmlRow("Ratify Auditors", "MGMT", "YES", "FOR", "FOR") +
			htmlRow("Shareholder Access Proposal", "SHLDR", "YES", "AGNST", "FOR") +
			htmlRow("Report on Political Spending", "SHLDR", "YES", "AGNST", "FOR"))

	rows, status := runISSNPXDocStatus(t, doc)
	if status == "ok" && len(rows) == 0 {
		t.Fatalf("declared a nil report on a document carrying four positional vote rows and" +
			" no vote vocabulary. The vocabulary half of the rule fired and the table half" +
			" never ran; a nil verdict needs BOTH.")
	}
}

// TestHTMLUnclosedCellsAreNotNil is the data-loss path. Legacy EDGAR HTML omits
// the closing </TD>, so a row written
//
//	<TR><TD>Election of Directors<TD>MGMT<TD>YES<TD>AGNST</TR>
//
// yields ZERO cells from a splitter that only emits at a terminator. A filing with
// hundreds of such vote rows then counts zero wide rows, looks tableless, and is
// recorded ok/n_rows=0 -- the votes vanish and the manifest says the filing was
// read successfully. That is strictly worse than `skip`, which at least stays
// countable. Absence of parseable cells is not evidence of absence of a table.
func TestHTMLUnclosedCellsAreNotNil(t *testing.T) {
	var b strings.Builder
	b.WriteString("<TABLE>\n")
	for i := 0; i < 12; i++ {
		b.WriteString("<TR><TD>Election of Directors<TD>MGMT<TD>YES<TD>AGNST<TD>FOR</TR>\n")
	}
	b.WriteString("</TABLE>\n")
	doc := htmlDoc(b.String())

	rows, status := runISSNPXDocStatus(t, doc)
	if status == "ok" && len(rows) == 0 {
		t.Fatalf("declared a nil report on a document whose twelve vote rows use unclosed <TD>" +
			" tags. The cell splitter produced nothing, which was read as \"no table\" rather" +
			" than \"markup this splitter cannot cut\". A filing we cannot cut must stay skip.")
	}
}
