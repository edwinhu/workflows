package main

import (
	"path/filepath"
	"testing"
)

// ns912036Dispatch runs the real dispatch on a family NS912036 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// fund heading and its series id, never a broken fixture. Same mechanism as
// ns796229Dispatch in family_ns796229_mmites_test.go, pointed at its own
// testdata dir.
func ns912036Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns912036_amg_aston", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns912036_amg_aston", fixture), sink, make([]byte, headBytes))
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

// CIK 0000912036 (AMG Funds IV; `ASTON FUNDS`, `ABN AMRO FUNDS` and `ALLEGHANY
// FUNDS` are FORMER COMPANY names in this filing's own SEC-HEADER) prints six
// broadridge vote-table banners that glue the registrant's CURRENT brand token
// `AMG ` in front of a fund name spelling, VERBATIM, one of this same CIK's own
// dictionary rows from a PRE-REBRAND vintage.
//
// 000091/912036/0001438934-17-000528.txt (period 20170630, 56,729 lines; its
// N-PX/A twin 0001438934-17-000531.txt is byte-identical in every banner below,
// at the same line numbers) carries them at source lines 435, 622, 628, 882, 972
// and 1217:
//
//	AMG Aston/Anchor Capital Enhanced Equity Fund     S000020470  ASTON/ANCHOR CAPITAL ENHANCED EQUITY FUND  20120630
//	AMG Aston/Barings International Fund             S000019442  ASTON/BARINGS INTERNATIONAL FUND           20080630
//	AMG Aston/Cornerstone Large Cap Value Fund       S000001119  ASTON/CORNERSTONE LARGE CAP VALUE FUND     20110630
//	AMG Aston/Harrison Street Real Estate Fund       S000001120  ASTON/HARRISON STREET REAL ESTATE FUND     20110630
//	AMG Aston/Herndon Large Cap Value Fund           S000028305  ASTON/HERNDON LARGE CAP VALUE FUND         20100630
//	AMG Aston/TCH Fixed Income Fund                  S000001135  ASTON/TCH FIXED INCOME FUND                20070630
//
// After this package's own normalizeSeriesName folding (header.go) each heading
// is EXACTLY `amg ` + the normalized dictionary name -- measured, not asserted:
//
//	heading="amg aston cornerstone large cap value fund" dict="aston cornerstone large cap value fund"
//
// so dropping ONE LEADING token from the printed heading yields an exact,
// own-CIK dictionary hit. This is the mirror image of the shipped brandPrefixed
// rung (cik_series.go), which PREPENDS a brand the dictionary keeps and the
// heading drops; no rung reaches a DROPPED LEADING token -- dictInternalTokenDrop
// cuts only indices 1..len-2, never the first or the last.
//
// NOT in scope, and deliberately absent from the excerpt: the sibling banner
// `AMG Managers LMCG Emerging Markets Fund` (source line 11570), whose row is
// S000040201 `ASTON/LMCG Emerging Markets Fund` 20130630. Stripping `AMG` leaves
// `managers lmcg emerging markets fund` against `aston lmcg emerging markets
// fund` -- measured NOT equal. That one needs a rename inferred and must stay
// refused.
//
// The fixture is three verbatim, unedited excerpts of the real filing, in order:
// source lines 1-434 (the whole SEC-HEADER including the 18-series
// SERIES-AND-CLASSES-CONTRACTS-DATA block that proves AMG is the CURRENT brand
// while ASTON FUNDS is a FORMER COMPANY name, the document preamble, `<TEXT>`,
// the report title block and the opening `<TABLE>` with its `<S> <C>` ruler),
// 628-691 (the `AMG Aston/Cornerstone Large Cap Value Fund` banner, its rule,
// its two-line no-voting-securities disclaimer, and the FEDEX CORPORATION
// ballot that follows it in full -- 18 items, 1A through 7 -- stopping just
// before the MCKESSON separator at line 692), and 56709-56729 (the report's own
// `* Management position unknown` footnote, `</TABLE>`, the SIGNATURES page and
// the closing `</TEXT>` / `</DOCUMENT>` / `</SEC-DOCUMENT>`). dict.tsv is all
// 137 real cik_series.tsv rows for this CIK, fetched verbatim, so nothing below
// is made unambiguous by hiding a rival spelling.
//
// Measured against the tracked binary over the FULL filing with -cik-series
// pointed at the real cik_series.tsv, the FEDEX section's 18 rows come back
// blank, and the fixture reproduces those same 18 rows exactly.
func TestNS912036AMGAstonLeadingBrandPrefixBlocksResolution(t *testing.T) {
	rows := ns912036Dispatch(t, "amg_aston_cornerstone_prefix_unresolved.txt", "dict.tsv", "broadridge", 18)
	const wantFund = "AMG Aston/Cornerstone Large Cap Value Fund"
	for _, r := range rows {
		if r.FundName != wantFund || r.SeriesID != "S000001119" {
			t.Errorf("the leading AMG brand token blocked the own-CIK Aston/Cornerstone row: fund=%q want %q; series=%q want S000001119 (issuer=%q cusip=%q item=%q)", r.FundName, wantFund, r.SeriesID, r.IssuerName, r.CUSIP, r.ItemSeq)
		}
	}
}
