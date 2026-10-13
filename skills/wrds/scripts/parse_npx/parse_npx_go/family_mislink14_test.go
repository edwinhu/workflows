package main

import (
	"path/filepath"
	"testing"
)

// familyMislink14Dispatch runs the real dispatch on the family MISLINK14
// fixture with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyMislink14Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink14", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink14", fixture), sink, make([]byte, headBytes))
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

// 000108/1081400/0000914229-05-000086.txt: verbatim source lines 11-29 (the SEC
// document opener through the registrant's FISCAL YEAR END), 50-56 (the header
// closer through `<TEXT>`), 98-109 (`Item 1. Proxy Voting Record`, the `FORM
// N-Px REPORT` banner, its ICA number, reporting period and registrant line),
// 69806-69838 (the LARGE COMPANY GROWTH banner and the whole ALCON INC. block
// under it), 70532-70554 (the SMALL COMPANY GROWTH banner and the whole
// ACTIVCARD CORP. block under it) and the filing's own last five lines. Every
// byte is verbatim. Dispatches to `issnpx` (the precondition asserts it).
//
// Wells Fargo Funds Trust, CIK 1081400, period 20050630, `issnpx`. The filing
// carries NO <SERIES-ID> in its header (`grep -c SERIES-ID` -> 0), so the whole
// declaration set is the dictionary backfill, `cikSeries.back` over the 395
// rows of `wf_dict.tsv` (CIK 1081400's rows of cik_series.tsv, verbatim).
//
// Source line 69808 verbatim:
//
//	=============== WELLS FARGO ADVANTAGE LARGE COMPANY GROWTH FUND ================
//
// The current tree stamps S000029061 on all 327 rows of that section. That id
// is declared ONLY as, in dictionary order:
//
//	S000029061  Premier Large Company Growth Fund                        20110630
//	S000029061  Wells Fargo Advantage Premier Large Company Growth Fund  20130630
//	S000029061  Wells Fargo Premier Large Company Growth Fund            20160630
//	S000029061  Allspring Premier Large Company Growth Fund              20220630
//
// -- a series first declared 20110630, six years AFTER this filing's period,
// and every spelling of it carries `Premier`. The banner is reached only by
// dropping that lead word. `grep -in premier` over the whole 74,507-line filing
// returns NOTHING: the distinguishing word the id is declared under is printed
// nowhere in the bytes. run72 stamped S000007269 `Large Cap Growth Fund`
// (20060630) on the same banner by swapping `Company` for `Cap`; that was wrong
// too, and the current stamp replaced one wrong id with another.
//
// THE ROUTE IS PROBED, not judged by eye. Every `return banner, d` site in
// `issResolveFundUncached` was traced on a scratch copy of the package, against
// the index this filing builds (`decls=395 period=20050630`):
//
//	RUNG line 3263 -> S000029061 "Premier Large Company Growth Fund" 20110630
//	RUNG line 2730 -> S000029061 "Premier Large Company Growth Fund" 20110630
//	FINAL S000029061  issFutureVintage=true
//
// Line 2730 is the historical-brand STEM recursion: `issHistoricalBrandKey`
// yields `wells fargo:large company growth fund`, `issHistoricalBrandStem`
// yields `large company growth fund`, and that stem re-enters the chain. Line
// 3263 is `ix.lessLeadCompact[compactKey]` -- the COMPACT twin of
// `lessLeadToken`, built at :1696 from the same one-leading-token-off-the-
// declared-name remainder. `ix.lessLeadCompact["largecompanygrowthfund"]` and
// `ix.lessLeadToken["large company growth fund"]` both hold S000029061; the
// compact map is consulted first, at :3262, so it is the one that answers.
//
// NEITHER IS GUARDED. `issFutureVintage` (:4917) already recognises this hit --
// probed directly, `issFutureVintage(ix, hit)` is **true**: S000029061's
// earliest declaration is 20110630, later than the period 20050630 AND later
// than 20060630, the earliest vintage this registrant carries at all. The
// predicate is applied at the six distinctive/stem rungs and at the exact hit
// in `issResolveFundUncached` (:2534), and nowhere else. The lead-token pair --
// `lessLeadCompact` at :3262 and `lessLeadToken` at :3416 -- is outside it, so
// the same evidence that refuses a future-vintage near-miss admits a
// future-vintage lead-token drop.
//
// Fix location: `layout_issnpx.go`, `issResolveFundUncached` -- the
// `ix.lessLeadCompact` return at :3263 and its `ix.lessLeadToken` twin at
// :3416, each gated on `issFutureVintage` the way the six rungs already are. A
// declaration the filing's own header printed is undated and the predicate
// never refuses it, so no header-declared id is touched; the guard only
// declines to invent a lead-word drop onto a sleeve that did not exist.
//
// Rows affected: 327 on this path, currently WRONG, correct outcome blank. The
// sibling section asserted below is measured on the same dispatch: all 775 rows
// of `WELLS FARGO ADVANTAGE SMALL COMPANY GROWTH FUND` carry S000007361, which
// answers at a different site (line 2718, `ix.byHistoricalBrand`) on an EXACT
// declared name with only the shared brand cut -- `Allspring Small Company
// Growth Fund` less `Allspring` is the banner less `Wells Fargo Advantage` --
// with no token of the declared name dropped. It must keep its id.
func TestFamilyMislink14WFLargeCompanyGrowthPremierDropped(t *testing.T) {
	rows := familyMislink14Dispatch(t, "wf_large_company_growth.txt", "wf_dict.tsv", "issnpx", 18)
	var large, small int
	for _, r := range rows {
		switch r.FundName {
		case "WELLS FARGO ADVANTAGE LARGE COMPANY GROWTH FUND":
			large++
			if r.SeriesID != "" {
				t.Errorf("the banner names `LARGE COMPANY GROWTH FUND`; S000029061 is declared only as `Premier Large Company Growth Fund` and later, first seen 20110630 -- six years after this 20050630 period and later than this registrant's own earliest 20060630 vintage -- and `Premier` is printed nowhere in the filing, so the lead-token drop that reaches it is a guess: issuer=%q cusip=%q date=%q desc=%q series=%q want \"\"",
					r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
			}
		case "WELLS FARGO ADVANTAGE SMALL COMPANY GROWTH FUND":
			small++
			if r.SeriesID != "S000007361" {
				t.Errorf("the sibling banner equals a declared name with only the shared brand cut and no token dropped, so it must keep its id: issuer=%q series=%q want S000007361", r.IssuerName, r.SeriesID)
			}
		default:
			t.Errorf("unexpected section %q", r.FundName)
		}
	}
	if large != 8 || small != 10 {
		t.Fatalf("fixture sections: large=%d small=%d want 8/10", large, small)
	}
}
