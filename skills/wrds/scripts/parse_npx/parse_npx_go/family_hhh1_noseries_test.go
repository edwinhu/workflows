package main

import (
	"path/filepath"
	"testing"
)

// familyHHH1Dispatch runs the real dispatch on a family HHH no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when one is
// named.
func familyHHH1Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_hhh1", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_hhh1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000003/34549/0001104659-04-026178.txt: 1-700, 5349, 222456-222462.
// EquiTrust Series Fund, Inc. declares NO series in the SGML header of this 2004
// filing, so the resolver sees only cik_series.tsv for CIK 0000034549, six ids
// under one spelling each:
//
//	0000034549	S000007288	EquiTrust Series Fund, Inc. Blue Chip Portfolio
//	0000034549	S000007293	EquiTrust Series Fund, Inc. Value Growth Portfolio
//
// The filing prints NO per-fund section heading. It names the fund in the FIRST
// COLUMN OF EVERY VOTE ROW, under a column header cell that reads `Series Fund`,
// verbatim:
//
//	<td width="13%" valign="top" bgcolor="#CCEEFF" ...>
//	<p style="margin:0in 0in .0001pt;text-autospace:none;"><font size="1" face="Times New Roman" style="font-size:6.0pt;">Value Growth Portfolio</font></p>
//	</td>
//	...
//	<p ...>7-Eleven</font></p>
//	...
//	<p ...>20040421</font></p>
//	...
//	<p ...>817826209</font></p>
//
// The htmltable layout reads the issuer, the meeting date and the CUSIP out of
// that same row and drops the leading fund cell: the row comes out with the
// right identity and an empty fund_name, so dictFallback.apply returns on its
// `r.FundName == ""` guard and no lookup is ever attempted.
//
// A full-file dispatch emits 115 rows and ALL 115 carry a blank series_id and a
// blank fund_name -- every row of the filing.
//
// The attribution is decidable per row: the six portfolio names the column
// prints (`Value Growth Portfolio`, `Blue Chip Portfolio`, `High Grade
// Portfolio`, `Strategic Yield Portfolio`, `Managed Portfolio`, `Money Market
// Portfolio`) are each the dictionary name minus the registrant prefix
// `EquiTrust Series Fund, Inc.`, which the registrant-prefix strip already
// removes for banner headings.
//
// Fix in the htmltable per-row fund column path (layout_htmltable.go, the column
// header map that parseHTMLTableRaw builds and the row builder that fills
// VoteRow.FundName next to htmlBareFundLine): a column whose header cell reads
// `Series Fund` (as `Fund #` already is in family DDD) is a per-row fund column,
// and its value must be handed to icrResolveFundShared the way a section heading
// is, rather than dropped.
func TestFamilyHHH1EquiTrustPerRowPortfolioColumnNeverResolves(t *testing.T) {
	rows := familyHHH1Dispatch(t, "equitrust_row_portfolio_column.txt", "equitrust_dict.tsv", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000007293" {
			t.Errorf("per-row `Value Growth Portfolio` column not resolved: fund=%q issuer=%q cusip=%q series=%q want S000007293", r.FundName, r.IssuerName, r.CUSIP, r.SeriesID)
		}
	}
}

// 000178/1785243/0001580642-22-003545.txt: 1-74, 325-502, 2534, 2540-2760,
// 9615, 9621-9681, 9700-9720. The SECOND section is in the cut on purpose: with
// only the acronym one, no row in the fixture carries a fund name or a series,
// so consolidatedSeries widens every row to the joined `S000070521;S000070522`
// and the fixture stops reproducing the real filing's blank. Uncommon Investment Funds Trust declares exactly two series in the
// SGML header of this 2022 filing:
//
//	<SERIES-ID>S000070521
//	<SERIES-NAME>Uncommon Generosity 50 Equity ETF
//	<SERIES-ID>S000070522
//	<SERIES-NAME>Uncommon Portfolio Design Core Equity ETF
//
// so the chassis single-series stamp never fires. The filing prints two vote
// sections. The SECOND one is headed by the spelled-out declared name and
// resolves:
//
//	<TD COLSPAN="5" STYLE="font-weight: bold; vertical-align: bottom; text-align: left">Uncommon Portfolio Design Core Equity ETF<BR>
//	&nbsp;01-Apr-2022 To 30-Jun-2022</TD>
//
// The FIRST one is headed by an ACRONYM only:
//
//	<TD COLSPAN="5" STYLE="font-weight: bold; text-align: left">UGCE Proxy Report 2021 Q3<BR>
//	&nbsp;01-Jul-2021 To 30-Sep-2021</TD>
//
// `UGCE` is the initials of neither declared name, so no leading-token walk or
// suffix rule can reach a declaration and the heading is never adopted: its rows
// come out with an empty fund_name AND an empty series_id.
//
// A full-file dispatch emits 522 rows: 411 under the spelled-out banner carrying
// S000070522, and 111 under the acronym banner carrying nothing.
//
// The attribution is decidable from the filing's own text rather than from the
// acronym. The registrant files a per-series Exhibit A, and the Generosity one
// says, verbatim:
//
//	The Uncommon Generosity 50 Equity ETF was not operational during the reporting period ended June 30, 2022.
//
// Two series are declared and one is stated to have cast no votes at all, so
// every vote row in the filing belongs to S000070522.
//
// Fix in the series-attribution fallback (issResolveFund / the declared-series
// fallback in layout_issnpx.go that icrResolveFundShared calls last): a filing
// that prints an explicit `was not operational` / `did not vote` exclusion
// naming a declared series must drop that series from the candidate set, and
// when exactly one declared series survives, that id is the answer for rows
// whose heading did not resolve.
func TestFamilyHHH1UncommonAcronymSectionNeverResolves(t *testing.T) {
	rows := familyHHH1Dispatch(t, "uncommon_ugce_acronym_section.txt", "", "htmltable", 9)
	for _, r := range rows {
		if r.SeriesID != "S000070522" {
			t.Errorf("`UGCE Proxy Report 2021 Q3` section not resolved: fund=%q issuer=%q date=%q series=%q want S000070522", r.FundName, r.IssuerName, r.MeetingDate, r.SeriesID)
		}
	}
}
