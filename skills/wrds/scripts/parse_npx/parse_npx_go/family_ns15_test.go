package main

import (
	"path/filepath"
	"testing"
)

// familyNS15Dispatch runs the real dispatch on a family NS15 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS15Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns15", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns15", fixture), sink, make([]byte, headBytes))
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

// 000091/916490/0001580642-20-003105.txt: verbatim source lines 1-24, 38-39,
// 326-345, 356-369, 195291-195314 and 195328-195353, plus one `</TABLE>` line
// to close the table the line-range cut opened and the filing's own last four
// lines. Dispatches to `htmltable` (the precondition asserts it).
//
// Timothy Plan, 2020. 6,249 of 18,238 rows carry no series, in exactly two
// sections, and the fund_name emitted on both is an EXHIBIT NUMBER. The vendor
// opens every section with an account label in the first cell of the table's
// first row and right-aligns the exhibit number in the last cell of that same
// row. Eight of the ten sections spell the label `Account(s):` and resolve;
// the two that stay blank spell it `Institution Account(s):`, and for those
// the layout falls through to the last cell. Source lines 195293 and 195298,
// verbatim:
//
//	<TD COLSPAN="6" STYLE="font-weight: bold; vertical-align: top">Institution Account(s):&nbsp;&nbsp;TIMOTHY PLAN US SMALL CAP ETF </TD>
//	...
//	<TD COLSPAN="2" STYLE="vertical-align: bottom; text-align: right">Exhibit 18</TD></TR>
//
// against a sibling that resolves (census, real dispatch on the whole filing):
//
//	4832 NAMED "Account(s):  TIMOTHY PLAN INTERNATIONAL ETF" => S000063765
//	3282 blank "Exhibit 17" => ""
//	2967 blank "Exhibit 18" => ""
//
// `TIMOTHY PLAN US SMALL CAP ETF` resolves once handed over -- measured
// through icrResolveFundShared / issPlainHeadingSeries / lvResolveBanner on
// this filing's own index plus the registrant's 40 dictionary rows:
//
//	"TIMOTHY PLAN US SMALL CAP ETF"  shared=S000063764 plain=S000063764 lv=S000063764
//	"TIMOTHY PLAN LARGE CAP ETF"     shared=""         plain=""         lv=""
//
// (the filing declares S000063764 as `Timothy Plan US Small Cap Core ETF`; the
// printed name drops `Core`). The Exhibit 17 section's own account,
// `TIMOTHY PLAN LARGE CAP ETF`, names no series at this CIK under any vintage
// -- the nearest are `Timothy Plan US Large Cap Core ETF` and `Timothy Plan US
// Large/Mid Cap Core ETF`, both S000063763, and the printed name drops both
// `US` and the distinguishing `Core` / `Large/Mid` -- so those 3,282 rows are a
// name sub-floor inside this family and stay blank even after the fix.
//
// Rows reached: the 2,967 rows of the Exhibit 18 section of the measured
// filing; the family is 4 filings and 7,249 pool rows.
//
// Fix in layout_htmltable.go, in the section-heading reader that recognises the
// `Account(s):` label: `Institution Account(s):` is the same label with a
// vendor qualifier in front of it and must open a section the same way, so that
// the exhibit number in the row's last cell is never adopted as the fund.
func TestFamilyNS15TimothyInstitutionAccountLabelUnread(t *testing.T) {
	rows := familyNS15Dispatch(t, "timothy_institution_account_label_unread.txt", "timothy_dict.tsv", "htmltable", 1)
	for _, r := range rows {
		if r.SeriesID != "S000063764" {
			t.Errorf("an Institution Account(s) label was not read and the row's exhibit number was taken for the fund: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000063764", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
