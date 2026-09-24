package main

import (
	"path/filepath"
	"testing"
)

// Scudder Variable Series II (CIK 0000810573, filing agent 0000088053),
// verbatim bytes from two pre-tagging ProxyEdge N-PX filings.
//
// Fixtures:
//
//	svs2_2005_total_return.txt -- 000081/810573/0000088053-05-000968.txt (md5
//	36141336dd7a55e80f451c8c7f601dab) lines 1-187 (the SGML header, the FORM
//	N-PX preamble, and the document's FIRST ProxyEdge page -- banner
//	`SVS II Scudder Aggressive Growth Portfolio` plus its first ballot, DELL
//	INC.), lines 26532-26556 (the whole `SVS II Total Return Portfolio` page
//	banner plus its first ballot, MICROSTRATEGY INCORPORATED) and the
//	document's own trailing tags (lines 54690-54693).
//
//	The first page is NOT decoration: it is the only place this filing opens
//	`<TABLE>`/`<CAPTION>`/`<S> <C>` (line 162 of the original; the filing
//	carries three `<TABLE>` tags in 54,693 lines), and without it the
//	splittable layout declines the document -- a fixture cut to the Total
//	Return page alone dispatches `layout=unknown:registrant:9cc4d11b
//	status=skip`, which would pin a dispatch artifact instead of the rename
//	defect. Its three DELL rows are carried along and deliberately NOT
//	asserted on: `Scudder Aggressive Growth Portfolio` is not one of the 29
//	Column A names (the exhibit redesignates `Scudder Salomon Aggressive
//	Growth Portfolio`), and it already resolves to S000006259 anyway.
//
//	svs2_2004_total_return.txt -- 000081/810573/0000088053-04-000649.txt (md5
//	d645dbc904a44b4df3f9c09e558c1de0) lines 1-151 (header and preamble),
//	lines 19076-19109 (the whole `SVS II SCUD TOTAL RET PORT- EQ` banner plus
//	its first ballot, MICROSTRATEGY INCORPORATED), that section's own closing
//	`</TABLE>` (line 20970) and the trailing tags (lines 53790-53793).
//
// Dictionary: all 58 cik_series.tsv rows this CIK carries, copied verbatim.
//
// This is a DEFECT reproduction, not a floor guard. The registrant redesignated
// TWENTY-NINE series at once, and the instrument doing it is a signed,
// trustee-executed amendment to the Declaration of Trust filed on EDGAR:
// Exhibit (a)(25) to 485BPOS 000081/810573/0000088053-06-000476.txt (md5
// 93e8a0ca4136e10007f68aeca91274cb), document `<FILENAME>exa25-svs2.txt`,
// headed
//
//	SCUDDER VARIABLE SERIES II
//	Redesignation of Series
//
// and reading "The undersigned, being a majority of the Trustees of Scudder
// Variable Series II, a Massachusetts business trust (the "Trust"), acting
// pursuant to Article III, Section 1 of the Amended and Restated Agreement and
// Declaration of Trust dated April 24, 1998, as amended ... do hereby amend the
// Amended and Restated Establishment and Designation of Series of Shares of
// Beneficial Interest dated November 12, 2004 ... The series presently
// designated as listed in Column A are each hereby redesignated as their
// corresponding name listed in Column B:", followed by a 29-row Column A /
// Column B table and "The foregoing Redesignation of Series shall be effective
// February 6, 2006." Ten trustee signature blocks follow. ONE of those 29 rows
// is what this test pins, read from the exhibit's own bytes:
//
//	Scudder Total Return Portfolio   ->  DWS Balanced VIP
//
// That successor is a dictionary row of this SAME CIK, declared at vintage
// 20060630 in 000081/810573/0000088053-06-001068.txt, the registrant's first
// series-tagged N-PX: `DWS Balanced VIP` = S000006265. The rename is therefore
// audited on both ends and registrant-scoped -- the same evidentiary shape
// issRegistrantRenames already carries for CIKs 0000928754, 0000935070,
// 0000809593 and 0001100663, and no cross-CIK reach is needed or wanted.
//
// The one fund, TWO printed spellings, one for each lossy filing -- which is
// why both vintages are fixtured rather than one:
//
//	20050630  `SVS II Total Return Portfolio`      598 rows, all blank
//	20040630  `SVS II SCUD TOTAL RET PORT- EQ`     326 rows, all blank
//
// (row counts measured over the two REAL filings with -cik-series over this
// CIK's 58 dictionary rows and no -series-map.)
//
// Neither spelling is reachable by any name-based rung: `Total Return` and
// `DWS Balanced VIP` share NO content word at all, and the 2004 vendor
// spelling is not even the Column A name but a truncation of it, so the
// abbreviation has to be keyed alongside the spelled-out one. That is exactly
// what a registrant-scoped alias table does.
//
// Not every SVS II heading is lossy, and this test asserts only on the two
// that are. Thirteen of the 2005 filing's 24 headings already resolve on the
// existing rungs (`SVS II Scudder Blue Chip Portfolio` -> S000006253 among
// them, because Column A and Column B happen to share `Blue Chip`); the rename
// table is needed for the ones where the two names share nothing.
//
// The filings declare no series at all -- EDGAR tagged none before 2006 -- so
// the header pool is empty and the successor must be resolved against this
// CIK's own dictionary rows, the rung issAuditedRenameAliases already uses.
//
// The parser currently reads both banners verbatim into the fund-name column
// and leaves series_id blank.
func TestFamilyNSSVS2RedesignationResolves(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns_svs2_redesignation", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		fixture string
		period  string
		heading string
		want    string // Column B successor's series id, this CIK's own 20060630 declaration
		colA    string
	}{
		{
			fixture: "svs2_2005_total_return.txt",
			period:  "20050630",
			heading: "SVS II Total Return Portfolio",
			want:    "S000006265", // DWS Balanced VIP
			colA:    "Scudder Total Return Portfolio",
		},
		{
			fixture: "svs2_2004_total_return.txt",
			period:  "20040630",
			heading: "SVS II SCUD TOTAL RET PORT- EQ",
			want:    "S000006265", // DWS Balanced VIP
			colA:    "Scudder Total Return Portfolio",
		},
	}

	for _, tc := range cases {
		t.Run(tc.fixture, func(t *testing.T) {
			sink := &rowSink{}
			meta := processFile(tc.fixture, filepath.Join("testdata", "family_ns_svs2_redesignation", tc.fixture), sink, make([]byte, headBytes))
			if meta.ParseStatus != "ok" || meta.CIK != "0000810573" || meta.PeriodOfReport != tc.period {
				t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
					meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
			}
			var under []VoteRow
			for _, r := range sink.buf {
				if r.FundName == tc.heading {
					under = append(under, r)
				}
			}
			if len(under) == 0 {
				t.Fatalf("fixture precondition: no rows under %q (fixture emitted %d rows in total)", tc.heading, len(sink.buf))
			}
			reported := false
			for _, r := range under {
				if r.SeriesID != tc.want && !reported {
					reported = true
					t.Errorf("heading %q (fund_name=%q): series=%q, want %q -- Exhibit (a)(25) to 485BPOS 0000088053-06-000476 redesignates %q as the Column B name whose series id that is, effective 2006-02-06",
						tc.heading, r.FundName, r.SeriesID, tc.want, tc.colA)
				}
			}
		})
	}
}
