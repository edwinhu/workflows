package main

import (
	"path/filepath"
	"testing"
)

// familyHHH2Dispatch runs the real dispatch on a family HHH no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when one is
// named.
func familyHHH2Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_hhh2", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_hhh2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000091/911507/0001104659-07-064810.txt: 13-18, 25-26, 53-54, 83-84, 113-114,
// 143-144, 171-172, 201-202, 229-230, 258-259, 288-289, 318-319, 344-352,
// 517-527. ALL TEN declared series must be cut: an earlier cut of this fixture
// carried only three and passed, because the gate below turns on whether the
// FIRST banner line resolves against the registrant's own index, and it resolves
// only once the other seven names are present. Lord Abbett Investment Trust
// declares ten series in the SGML header of this 2007 filing, among them
//
//	<SERIES-ID>S000007284
//	<SERIES-NAME>Lord Abbett World Growth & Income Strategy Fund
//	<SERIES-ID>S000012541
//	<SERIES-NAME>Lord Abbett Diversified Equity Strategy Fund
//
// and opens each fund section with an ISS `=====` banner. Two of those banners
// are too long for the 80-column rule and WRAP onto a second banner line, which
// is itself a complete rule with its own leading and trailing `=` run:
//
//	========= LORD ABBETT STRATEGIC ALLOCATION FUND- WORLD GROWTH & INCOME =========
//	=========                STRATEGY FUND                    =========
//
// and, further down,
//
//	=========== LORD ABBETT STRATEGIC ALLOCATION FUND-DIVERSIFIED EQUITY ===========
//	===========             STRATEGY FUND                     ===========
//
// Each rule is its own `<p>` block, so the text the layout sees carries a BLANK
// LINE between the two rules, and the join is decided by the blank-line path in
// parseISSNPX (layout_issnpx.go:498-507), which consults issBannerWrapVisible.
// The declared-join rung there fires only while `sofarDecl == nil` -- only while
// the banner so far names NOTHING declared. Against the full ten-name index the
// first rule alone already resolves, tolerantly, to S000007284, so the rung is
// skipped, no other rung matches (every bracket is closed, no trailing bare
// dash, and the continuation is TWO words rather than a lone type word), the
// join is refused, the second rule commits as a banner of its own, and the fund
// of record for the whole section becomes the fragment `STRATEGY FUND`, which
// names nothing declared.
//
// A full-file dispatch emits 212 rows, of which 108 -- both wrapped sections --
// carry fund_name `STRATEGY FUND` and a blank series_id. Joined, the banner
// reads `LORD ABBETT STRATEGIC ALLOCATION FUND- WORLD GROWTH & INCOME STRATEGY
// FUND`, whose tail after the registrant's own trust name is the declared
// `Lord Abbett World Growth & Income Strategy Fund` exactly, and the sibling
// section joins to the declared `... Diversified Equity Strategy Fund`. The two
// unwrapped banners in the same filing (`LORD ABBETT HIGH YIELD FUND`, `LORD
// ABBETT STRATEGIC ALLOCATION FUND- BALANCED STRATEGY FUND`) resolve today.
//
// Fix in issBannerWrapVisible (layout_issnpx.go), in the declared-join rung: the
// `sofarDecl == nil` precondition is too strong. What distinguishes a wrap from
// two adjacent funds is that the CONTINUATION names nothing on its own
// (`nextDecl == nil`) while the JOIN names a declared series -- and, when the
// banner so far also resolves, that it resolves to the SAME declaration the join
// does. A continuation that would otherwise commit as a standalone banner and
// blank the section is a wrap, on the same evidence the paren and type-word
// rungs already use.
func TestFamilyHHH2LordAbbettWrappedBannerNeverResolves(t *testing.T) {
	rows := familyHHH2Dispatch(t, "lord_abbett_wrapped_banner.txt", "", "issnpx", 10)
	for _, r := range rows {
		if r.SeriesID != "S000007284" {
			t.Errorf("wrapped `... WORLD GROWTH & INCOME` / `STRATEGY FUND` banner not resolved: fund=%q issuer=%q item=%q series=%q want S000007284", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000153/1539996/0001580642-16-010708.txt: 1-2, 4-9, 12-16, 41-44, 61-64, 81-84,
// 101-104, 121-124, 143-155, 265-412. AmericaFirst Quantitative Funds declares
// five series in the SGML header of this 2016 filing, among them
//
//	<SERIES-ID>S000036989
//	<SERIES-NAME>AmericaFirst Quantitative Strategies Fund
//
// and prints five fund sections, each opened by a `Registrant:` line in the
// first cell of the section's own table, verbatim:
//
//	<B><I>Registrant: AmericaFirst Quantitative Strategies Fund</I></B></FONT><BR>
//	<B><I>Investment Company Act file number:&nbsp;&nbsp;811-22669</I></B></FONT><BR>
//	<B><I>Reporting Period: July 1, 2015 through June 30, 2016</I></B></FONT><BR>
//	<B><I>FORM N-PX - PROXY VOTING RECORD REQUIREMENTS</I></B></FONT><BR>
//	<B><I>&nbsp;01-Jul-2015 To 30-Jun-2016</I></B></FONT></TD>
//
// htmlBareFundLine reads a direct `Registrant:` value only when it is the
// NEAREST NONBLANK LINE above the table (`strings.Join(lines[li+1:], "") != ""`
// -> continue, layout_htmltable.go). This vendor prints four more metadata lines
// after the registrant inside the same cell, so the guard fires and the heading
// is never adopted.
//
// A full-file dispatch emits 1,540 rows in two groups: 107 with a blank
// series_id AND a blank fund_name -- the Quantitative Strategies section -- and
// 1,433 stamped S000036988 under the fund_name `"Registrant: AmericaFirst
// Tactical Alpha Fund`. That second group is the SAME line surviving only
// because the filing typed a stray `&quot;` in front of it, which puts the line
// past the `strings.HasPrefix(low, "registrant")` test and onto the bare-heading
// path; the three sections below it (Income Trends, Defensive Growth, Seasonal
// Trends) print the plain form again and are swept into the Tactical Alpha
// section rather than opening their own.
//
// Fix in htmlBareFundLine (layout_htmltable.go), at the nearest-nonblank guard
// on the direct `Registrant:` value: the form metadata this vendor prints under
// the registrant -- `Investment Company Act file number:`, `Reporting Period:`,
// the `FORM N-PX` banner and the bare reporting-period date range -- must not
// count as intervening content, the way the labelled paths already look past
// it.
func TestFamilyHHH2AmericaFirstRegistrantOverMetadataNeverResolves(t *testing.T) {
	rows := familyHHH2Dispatch(t, "americafirst_quantitative_registrant.txt", "", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000036989" {
			t.Errorf("`Registrant: AmericaFirst Quantitative Strategies Fund` heading not resolved: fund=%q issuer=%q item=%q series=%q want S000036989", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
