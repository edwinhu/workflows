package main

import (
	"path/filepath"
	"testing"
)

// familyNS36Dispatch runs the real dispatch on a family NS36 fixture with the
// named dictionary loaded and NO series-map overlay, and asserts the fixture's
// own preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyNS36Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns36", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns36", fixture), sink, make([]byte, headBytes))
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

// 000102/1026708/0001193125-05-176987.txt: verbatim source lines 11-28 (the SEC
// document opener through the registrant's STATE OF INCORPORATION), 50-60 (the
// FORMER COMPANY block through `<PAGE>`), 112-125 (the first Vote Summary
// Report banner, its `Equity Fund` heading and the table's own column ruler),
// 260-261 and 264-278 (the BP PLC (Form. Bp Amoco Plc) meeting row and its
// wrapped proposals 3-8, through that section's `</TABLE>`), 9544-9557 (the
// sibling banner, its `INTERNATIONAL EQUITY FUND` heading, its ruler and the
// 77 Bank Ltd. meeting row), 9565-9575 (that meeting's sub-items 2.1-2.7), 278
// again (a `</TABLE>` to close the second section) and the filing's own last
// four lines. Every byte is verbatim.
//
// The two vote blocks were chosen for a reason that is NOT about the series id:
// this filing's vote columns are shifted, so on most of its rows the dispatch
// emits a truncated how_voted (`For` -> "r", `Against` -> "ainst", and the
// issuer field eats the cusip's leading digit -- visible in this test's own
// failure output as cusip="55622104" for the printed 055622104). That is a
// second, independent defect in the same bytes, reported separately and not
// asserted here; the blocks excerpted above are ones whose rows emit an EMPTY
// how_voted, so the fixture does not trip
// `TestHowVotedVocabularyInvariant`, which sweeps all of testdata/.
//
// Wilshire Variable Insurance Trust, CIK 1026708, period 20050630, layout
// `votesummary` (the precondition asserts it). The filing carries NO
// <SERIES-ID> in its header (`grep -c SERIES-ID` -> 0), so the whole
// declaration set is the dictionary backfill -- the 18 rows of
// `wilshire_dict.tsv`, which are CIK 0001026708's rows of cik_series.tsv,
// verbatim.
//
// Source line 118 verbatim, flush left, the only thing between the report's
// date line and its `<TABLE>` (printed 61 times in the filing):
//
//	Equity Fund
//
// and source line 9549, the sibling, the same shape:
//
//	INTERNATIONAL EQUITY FUND
//
// This registrant declares every sleeve under its own brand infix `WILSHIRE
// VIT`:
//
//	S000001038  WILSHIRE VIT BALANCED FUND             20060630
//	S000001039  WILSHIRE VIT EQUITY FUND               20060630
//	S000001040  WILSHIRE VIT INCOME FUND               20060630
//	S000001041  WILSHIRE VIT INTERNATIONAL EQUITY FUND 20060630
//	S000001042  WILSHIRE VIT SHORT-TERM INVESTMENT FUND 20060630
//	S000001043  WILSHIRE VIT SMALL CAP GROWTH FUND     20060630
//	S000001044  WILSHIRE VIT SOCIALLY RESPONSIBLE FUND 20060630
//
// and the document prints the short form. THE ROUTE IS PROBED, not judged by
// eye. Against this filing's own index -- `issFilingIndex(meta.SeriesDecls,
// normalizeSeriesName(meta.CompanyName), meta.CIK, metaPeriod(meta))` plus
// `issFormerKeys` -- `icrResolveFundShared` answers:
//
//	"INTERNATIONAL EQUITY FUND"   -> S000001041
//	"BALANCED FUND"               -> S000001038
//	"INCOME FUND"                 -> S000001040
//	"SMALL CAP GROWTH FUND"       -> S000001043
//	"SOCIALLY RESPONSIBLE FUND"   -> S000001044
//	"WILSHIRE VIT EQUITY FUND"    -> S000001039
//	"VIT EQUITY FUND"             -> S000001039
//	"Equity Fund"                 -> ""            <-- the defect
//	"XYZZY FUND"                  -> ""
//
// Every other brand-stripped short name this registrant prints resolves; the
// full and the half-cut spelling of this one resolve; only the fully-cut
// `EQUITY FUND` does not. It is not ambiguous: exactly ONE declared name
// reduces to `EQUITY FUND` -- S000001041 reduces to `INTERNATIONAL EQUITY
// FUND`, a different key -- so the id is named by the bytes and nothing is
// guessed.
//
// Fix location: `layout_issnpx.go`, `newISSSeriesIndex`, the brand-cut loop at
// the `issCutBrand(k, b)` that seeds `lessBrandFull` / `lessLeadCompact`. The
// brand list built from the registrant key `wilshire variable insurance trust`
// holds both `wilshire` and the trailing-initials brand `vit`, but each cut is
// applied ONCE and only at the front, so `wilshire vit equity fund` cuts to
// `vit equity fund` and stops -- `lessBrandFull["equity fund"]` is absent
// (probed directly on the index). Re-cutting the residue against the same brand
// list would seed `equity fund`, `balanced fund`, `income fund`, `international
// equity fund`, `small cap growth fund` and `socially responsible fund`, all
// distinct, so the existing collision rule in `put` refuses nothing here.
//
// Rows affected: 1,128 on this path in the real filing (`Equity Fund`, blank in
// the current tree), plus 27 more the same section loses to a separate
// attribution defect -- in the second report style the heading line is
// `                          July 01, 2004 - June 30, 2005` (source line 1621)
// and the tree stamps that date line as the fund name instead of the `Equity
// Fund` line beneath it. Those 27 are NOT asserted here; this test asserts only
// the series id on the section the tree does attribute. The sibling asserted
// below resolves today and must keep its id.
func TestFamilyNS36WilshireVITBrandInfixEquityFund(t *testing.T) {
	rows := familyNS36Dispatch(t, "wilshire_equity_fund.txt", "wilshire_dict.tsv", "votesummary", 13)
	var eq, intl int
	for _, r := range rows {
		switch r.FundName {
		case "Equity Fund":
			eq++
			if r.SeriesID != "S000001039" {
				t.Errorf("the heading names `Equity Fund`, which is the declared `WILSHIRE VIT EQUITY FUND` with this registrant's own brand infix cut -- the same cut that makes `INCOME FUND`, `BALANCED FUND` and `SOCIALLY RESPONSIBLE FUND` resolve -- and exactly one declared name reduces to it: issuer=%q cusip=%q date=%q desc=%q series=%q want S000001039",
					r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
			}
		case "INTERNATIONAL EQUITY FUND":
			intl++
			if r.SeriesID != "S000001041" {
				t.Errorf("the sibling heading already resolves on the same index and must keep its id: issuer=%q series=%q want S000001041", r.IssuerName, r.SeriesID)
			}
		default:
			t.Errorf("unexpected section %q", r.FundName)
		}
	}
	if eq != 6 || intl != 7 {
		t.Fatalf("fixture sections: equity=%d international=%d want 6/7", eq, intl)
	}
}
