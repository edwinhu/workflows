package main

import (
	"path/filepath"
	"testing"
)

// familyNS39Dispatch runs the real dispatch on a family NS39 fixture with the
// registrant's own corpus dictionary loaded -- the production run loads it, and
// this defect only shows with it loaded, so a test that nils it would pass over
// the bug -- and asserts the fixture's preconditions (status, layout, row count)
// so a failure below is an assertion about the fund banner and never a broken
// fixture.
func familyNS39Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	dir := filepath.Join("testdata", "family_ns39")
	var err error
	if cikDict, err = loadCIKSeries(filepath.Join(dir, "pvc_dict.tsv")); err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join(dir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	return rows
}

// 000001/12601/0000898745-11-000548.txt: verbatim source lines 1-141, 260-950,
// 134203-134204 and 134230. Every byte is a line-range cut of the source; the
// 142-259 gap drops the filing's separate cover-page document, and the three
// tail lines are the filing's own `</TEXT></DOCUMENT></SEC-DOCUMENT>`, so the
// document the fixture keeps opens and closes exactly as the source does.
// Dispatches to `htmltable` (the precondition asserts it).
//
// Principal Variable Contracts Funds Inc, CIK 12601, period 20110630. ALL 3,718
// of this filing's rows carry NO series. The filing declares six series in its
// own SGML header, one of which is the fund the whole document reports on:
//
//	source line  58  <SERIES-NAME>SmallCap Value Account I            S000007678
//	source line 272  FUND: Principal Variable Contracts Funds, Inc. &#150; SmallCap Value Account I
//
// THE BANNER IS RESOLVABLE AND IS NOT THE DEFECT. `SmallCap Value Account I` is
// the declared name spelled verbatim, behind the registrant brand and an en
// dash -- the same brand-infix shape that resolves elsewhere in this same
// vintage (sibling filing 0000898745-11-000538 names every one of its rows from
// `Principal Variable Contracts Funds, Inc. - Equity Income Account`). Measured
// on the whole filing with the `Institution Account(s):` lines deleted and
// NOTHING else changed, all 3,843 rows carry fund_name `Principal Variable
// Contracts Funds, Inc. - SmallCap Value Account I` AND series S000007678.
//
// THE BYTES. The ISS export prints the `FUND:` banner ONCE, in the title block
// of page 1, and prints the vendor's internal account code on EVERY page, in the
// run-parameter strip under the `Vote Summary Report` banner. Counted on the
// whole filing: `FUND: ` appears 1 time, `Institution Account(s): PVC SMALLCAP
// VALUE ACCT I - PMC` appears 483 times. Both are in page 1's SAME pre-table
// block, the account code second (fixture lines 154 and 164, source 272 and
// 282):
//
//	<TD align=left><B><FONT ...>FUND: Principal Variable Contracts Funds, Inc. &#150; SmallCap Value Account I</FONT></B></TD></TR>
//	<TD align=left><B><FONT ...>ADVISOR: Principal Management Corporation</FONT></B></TD></TR>
//	<TD ... align=left><B><FONT ...>Vote Summary Report</FONT></B></TD></TR>
//	<TD ... align=left><FONT ...>Report was run from: 7/1/10 to 6/30/11</FONT></TD></TR>
//	<TD ... align=left><FONT ...>Location(s): Principal Management Corporation</FONT></TD></TR>
//	<TD ... align=left><FONT ...>Institution Account(s): PVC SMALLCAP VALUE ACCT I - PMC</FONT></TD></TR>
//
// htmlFundLabelled (layout_htmltable.go:6401-6405) lists `institution account`
// as a fund label, and htmlReportParameterLine (:6541-6558) demotes
// `Institution Account(s):` to a run parameter ONLY when its value is the
// blanket `all ...`. This value is not blanket, so the account code is read as
// the block's fund -- and it is read LAST, so it overwrites the `FUND:` banner
// that the same block printed ten lines above it. The banner is then never
// printed again, while the code is reprinted on all 483 pages, so nothing ever
// restores it.
//
// `PVC SMALLCAP VALUE ACCT I - PMC` is not a name any header or dictionary
// carries: `ACCT I` for `Account I`, no `Value`-less sibling to disambiguate
// against, and a ` - PMC` adviser-initials tail. It resolves against the
// filing's own six declarations alone, because `SmallCap` picks out exactly one
// of the six; add the registrant's corpus dictionary -- which carries SmallCap
// Account, SmallCap Blend Account, SmallCap Growth Account, SmallCap Growth
// Account II, SmallCap Value Account and SmallCap Value Account I -- and the
// abbreviation is ambiguous and refuses. That is why the production run, which
// loads the dictionary, loses every row, and why this test loads it too.
//
// Rows reached: 13,695 across the three 2011 filings of this registrant that
// print an ALL-CAPS account code (0000898745-11-000540: 6,204 named `PVC LARGE
// CAP BLEND ACCT II - PMC` and `PVC LARGECAP GROWTH ACCT I - PMC`;
// -000546: 3,773 named `PVC SMALLCAP GROWTH ACCT II - PMC`; -000548: 3,718).
// Deleting the `Institution Account(s):` lines from all three and re-running
// takes every one of those to a series. The three sibling 2011 filings escape
// only because their account code happens to spell the fund readably (`PVC
// Funds, Inc - Balanced`), not because the banner survived in them.
//
// Fix in layout_htmltable.go: a block that prints BOTH a `FUND:` banner and an
// `Institution Account(s):` run parameter must keep the banner -- the banner is
// the registrant's own name for the fund and the account code is the vendor's
// internal key for it, so the code must never overwrite a fund the same block
// already named. Nothing here asks for `Institution Account(s):` to stop naming
// a fund in the vintages where it is the only thing printed.
func TestFamilyNS39PrincipalVariableContractsInstitutionAccountCodeClobbersTheFundBanner(t *testing.T) {
	rows := familyNS39Dispatch(t, "pvc_fund_heading_2011.txt", "htmltable", 5)
	for _, r := range rows {
		if r.SeriesID != "S000007678" {
			t.Errorf("the per-page `Institution Account(s):` code overwrote the `FUND:` banner: fund=%q issuer=%q cusip=%q date=%q item=%q desc=%.40q series=%q want S000007678 (the banner `Principal Variable Contracts Funds, Inc. - SmallCap Value Account I`, source line 272)", r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
