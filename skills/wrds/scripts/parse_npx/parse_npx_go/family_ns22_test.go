package main

import (
	"path/filepath"
	"testing"
)

// familyNS22Dispatch runs the real dispatch on a family NS22 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS22Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns22", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns22", fixture), sink, make([]byte, headBytes))
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

// 000091/912036/0001438934-17-000531.txt: verbatim source lines 1-20 (the SEC
// header through the CIK), 53-54 (the series-data openers), 307-310 and 321-325
// and 340 (the `S000044915` and `S000044916` `<SERIES>` blocks, trimmed to the
// id/name lines and their closers), 390-398 (the header closers and the
// document opener through `<TEXT>`), 425-434 (the reporting-period lines, the
// `<PAGE>` and the `<TABLE>`/`<S> <C>` opener), 5162-5179 and 5188-5193 (the
// `Guardian Capital` banner and the first two-thirds of its AUTOMATIC DATA
// PROCESSING block -- the contrast), 5691-5717 (the DOW CHEMICAL heading that
// carries NO proposals, and the ABBVIE block that follows it) and the filing's
// own last three lines. Every byte is verbatim. Dispatches to `broadridge` (the
// precondition asserts it).
//
// AMG Funds IV, period 20170630, `broadridge`. Measured on the current tree
// with the full 41,139-row dictionary:
//
//	=== 000091/912036/0001438934-17-000531.txt layout=broadridge status=ok rows=11458 blank=1704
//	    1361 blank "ISIN:  US2605431038"
//	     114 S000044915 "AMG Managers Guardian Capital Global Divdend Fund"
//
// The registrant prints 26 fund banners, each on its own line above a rule.
// Inside the `AMG Managers Guardian Capital Global Divdend Fund` section
// (source lines 5163-11569) the vendor prints a meeting heading that carries no
// proposals at all -- source lines 5691-5700, verbatim:
//
//	--------------------------------------------------------------------------------------------------------------------------
//	 THE DOW CHEMICAL COMPANY                                                                    Agenda Number:  934450317
//	--------------------------------------------------------------------------------------------------------------------------
//	        Security:  260543103
//	    Meeting Type:  Special
//	    Meeting Date:  20-Jul-2016
//	          Ticker:  DOW
//	            ISIN:  US2605431038
//	--------------------------------------------------------------------------------------------------------------------------
//	 ABBVIE INC.                                                                                 Agenda Number:  934548821
//
// The heading's closing rule is immediately followed by the NEXT meeting's
// opening rule, with no proposal table between them. The layout takes the last
// line above a rule as a fund banner, so `ISIN:  US2605431038` becomes the fund
// name and every row from ABBVIE to the end of the Guardian section -- 1,361 of
// them -- is blank. Contrast source lines 5162-5172, where the same rule is
// preceded by the real banner and the section resolves.
//
// PROBED, not judged by eye. Handed the banner the bytes actually print, the
// existing chain answers it with no new rung; handed the ISIN line it correctly
// answers nothing:
//
//	icrResolveFundShared("AMG Managers Guardian Capital Global Divdend Fund") -> "S000044915"
//	icrResolveFundShared("ISIN:  US2605431038")                              -> ""
//
// So this is an attribution shape, not a naming one. The filing's own SGML
// header declares the banner, source lines 309-310 verbatim:
//
//	<SERIES-ID>S000044915
//	<SERIES-NAME>AMG Managers Guardian Capital Global Dividend Fund
//
// (the banner misspells `Dividend` as `Divdend`; the chain already tolerates
// that, which is why the first 114 rows of the section carry the id).
//
// Fix location: `layout_broadridge.go`, the fund-banner reader -- the line
// above a rule is a fund banner only when it is not part of the meeting heading
// the vendor just opened. A meeting heading whose `Security:`/`Meeting Type:`/
// `Meeting Date:`/`Ticker:`/`ISIN:` block is closed by a rule with no proposal
// table between must leave the section's banner standing.
func TestFamilyNS22AMGGuardianISINReadAsBanner(t *testing.T) {
	rows := familyNS22Dispatch(t, "amg_guardian_isin_banner.txt", "amg_dict.tsv", "broadridge", 8)
	for _, r := range rows {
		if r.CUSIP != "00287Y109" {
			continue
		}
		if r.SeriesID != "S000044915" {
			t.Errorf("the section's banner was lost to the ISIN line of a proposal-less meeting heading: fund=%q issuer=%q cusip=%q item=%q desc=%q series=%q want S000044915",
				r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000135/1355064/0001580642-17-004477.txt: verbatim source lines 1-20 (the SEC
// header through the CIK), 45-46 (the series-data openers), 209-212 and 237
// (the `S000049985` `<SERIES>` block, trimmed to its id/name lines and its
// closer), 262-275 (the header closers and the document opener through
// `<BODY>`), 10146-10158 (the `<TABLE>` opener and the masthead row that prints
// the registrant, the fund name and `Exhibit 1`), 10185-10214 (the
// `N-PX Form Requirements` rule row, the nine-column header row and the first
// vote row) and the filing's own last five lines. Every byte is verbatim.
// Dispatches to `htmltable` (the precondition asserts it).
//
// Mutual Fund Series Trust, period 20170630, `htmltable`. Measured on the
// current tree with the full 41,139-row dictionary:
//
//	=== 000135/1355064/0001580642-17-004477.txt layout=htmltable status=ok rows=1302 blank=1302
//	    1302 blank "Exhibit 1"
//
// EVERY row of the filing is blank and every one of them carries the string
// `Exhibit 1` as its fund name. The masthead row above each vote table prints
// three labelled cells, source lines 10148-10156 verbatim (attributes elided
// only in this comment; the fixture carries the bytes whole):
//
//	<TD ...><B>Registrant:&nbsp;&nbsp;Mutual Fund Series Trust</B></TD>
//	...
//	<TD ...><B>Fund Name - Eventide Multi-Asset Income Fund</B></TD>
//	...
//	<TD ...>Exhibit 1</TD>
//
// The layout takes the LAST non-empty cell of that row as the fund name, so the
// exhibit number wins and the `Fund Name - ` cell is never read. The filing
// prints four such mastheads (source lines 800, 921, 1042 and 10152).
//
// PROBED, not judged by eye. Handed the string the `Fund Name - ` cell prints,
// the existing chain answers every one of the four with no new rung; handed
// `Exhibit 1` it correctly answers nothing:
//
//	icrResolveFundShared("Exhibit 1")                            -> ""
//	icrResolveFundShared("Eventide Multi-Asset Income Fund")      -> "S000049985"
//	icrResolveFundShared("Day Hagen Hedged Strategy Fund")        -> "S000055854"
//	icrResolveFundShared("Day Hagen Tactical Allocation Fund")    -> "S000026891"
//	icrResolveFundShared("Day Hagen Tactical Dividend  Fund")     -> "S000045618"
//
// (the mastheads misspell the adviser as `Day Hagen` where the header declares
// `Day Hagan`; the chain already tolerates that.) So this is an attribution
// shape, not a naming one. The filing's own SGML header declares the banner,
// source lines 211-212 verbatim:
//
//	<SERIES-ID>S000049985
//	<SERIES-NAME>Eventide Multi-Asset Income Fund
//
// Fix location: `layout_htmltable.go`, the masthead reader -- a masthead row
// that prints a `Fund Name` label must be read from the LABELLED cell, not from
// the last non-empty cell of the row.
func TestFamilyNS22MFSTExhibitNumberReadAsFundName(t *testing.T) {
	rows := familyNS22Dispatch(t, "mfst_exhibit1_masthead.txt", "mfst_dict.tsv", "htmltable", 1)
	for _, r := range rows {
		if r.SeriesID != "S000049985" {
			t.Errorf("the masthead's exhibit number was read as the fund name: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want S000049985",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
