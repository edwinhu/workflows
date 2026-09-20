package main

import (
	"path/filepath"
	"testing"
)

// familyMislink3Dispatch runs the real dispatch on a family MISLINK3 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyMislink3Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink3", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink3", fixture), sink, make([]byte, headBytes))
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

// 000084/844779/0001193125-04-147200.txt: verbatim source lines 11-29, 63-69,
// 90-93, 2220-2234 and 34081-34085 (the filing's own tail).
//
// BLACKROCK FUNDS (CIK 844779), period 20040630, prints
//
//	========================= BLACKROCK BALANCED PORTFOLIO =========================
//
// at source line 2220, and 1,184 of the filing's 12,654 rows carry S000003863 --
// a series of CIK 319108, a DIFFERENT registrant. Eleven sibling banners in the
// same filing are stamped correctly from the identical ruled-banner grammar, so
// the layout is not at fault; the defect is entirely in resolution.
//
// The rung is cikSeries.crossCIK (cik_series.go:105), read at the tail of
// issResolveFund (layout_issnpx.go:2292-2296) on the heading AS PRINTED after
// every registrant-scoped rung has refused. Measured on the real dispatch with
// the whole 41,139-row dictionary loaded:
//
//	crossCIK("0000844779", "BLACKROCK BALANCED PORTFOLIO")
//	  => S000003863 "BlackRock Balanced Portfolio" declDate=20250630
//
// The rung's own guard -- exact, and one series of one registrant corpus-wide --
// is SATISFIED: `BlackRock Balanced Portfolio` is declared once in the corpus.
// A same-sponsor guard would not refuse it either, since CIK 319108 is also a
// BlackRock trust. What refuses it is VINTAGE. S000003863's four declared names
// are `Mercury Balanced Capital Strategy Portfolio` (20060630), `BlackRock
// Balanced Capital Portfolio` (20070630), `BlackRock Sustainable Balanced
// Portfolio` (20220630) and `BlackRock Balanced Portfolio` (20250630). The name
// that matches this 2004 heading is the one the other registrant adopted
// twenty-one years AFTER the filing; in 2004 that series was called Mercury.
//
// The asymmetry is the bug. The same-CIK backfill path is contemporaneity-aware
// -- cikSeries.back calls dictContemporaneous (cik_series.go:146), which keeps
// the declaration nearest the filing's period -- while byNameAll
// (cik_series.go:68) indexes every vintage with no date filter at all, so
// crossCIK answers a 2004 heading out of a 2025 declaration.
//
// BLACKROCK FUNDS' own 2004 Balanced Portfolio is in none of its 153 dictionary
// rows (it was merged away before series ids existed), so the correct answer
// here is NO series: this is a mislink over a floor, and the fix trades 1,184
// wrong ids for 1,184 blanks.
//
// Fix in cik_series.go: crossCIK must take the filing's period and refuse a
// decl whose DeclDate post-dates it -- either by threading the period through
// the call site at layout_issnpx.go:2293 / layout_icr.go:796, or by making
// byNameAll carry each name's vintage so the rung can compare. The same-CIK
// path already has dictContemporaneous; the cross-CIK path has nothing.
func TestFamilyMislink3BlackRockCrossCIKFutureVintage(t *testing.T) {
	rows := familyMislink3Dispatch(t, "blackrock_cross_cik_future_vintage.txt", "blackrock_dict.tsv", "issnpx", 4)
	for _, r := range rows {
		if r.FundName != "BLACKROCK BALANCED PORTFOLIO" {
			continue
		}
		if r.SeriesID != "" {
			t.Errorf("a 2004 heading took another registrant's series off a 2025 declaration: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want \"\"", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000004/49702/0000820027-04-000715.txt: verbatim source lines 11-29, 59-80,
// 2582-2596, 13128-13140 and 16986-16990 (the filing's own tail).
//
// AXP GROWTH SERIES INC/MN (CIK 49702), period 20040630, prints two SEPARATE
// ruled banners at source lines 2582 and 13128:
//
//	========================== AXP LARGE CAP EQUITY FUND ===========================
//	==================== AXP QUANTITATIVE LARGE CAP EQUITY FUND ====================
//
// and the real dispatch stamps BOTH S000003289 -- 959 rows and 1,684 rows of the
// filing's 7,589. The registrant's whole dictionary is five rows / four series,
// and S000003289's only name is `RiverSource Large Cap Equity Fund`. Two
// distinct sleeves cannot be one series, so 1,684 rows are mislinked.
//
// The rung, measured cold (a fresh index per key, since the chain memoises):
//
//	issResolveFund("AXP LARGE CAP EQUITY FUND")               => S000003289
//	issResolveFund("AXP QUANTITATIVE LARGE CAP EQUITY FUND")  => S000003289
//	issResolveFund("RIVERSOURCE QUANTITATIVE LARGE CAP EQUITY FUND") => S000003289
//	issInternalTokenDropDecl("riversource quantitative large cap equity fund")
//	  => S000003289 "RiverSource Large Cap Equity Fund"
//	issSplicedDecl(same key)  => S000003289 "RiverSource Large Cap Equity Fund"
//
// so the brand substitution AXP -> RiverSource is sound and the drop of the
// internal token `quantitative` is what mislinks. issInternalTokenDropDecl
// (layout_issnpx.go:3964) is a subset-token rung in the sense of family
// MISLINK2: it resolves on a SUBSET of the heading's tokens and never reads the
// token it dropped.
//
// MISLINK2's principle -- a dropped token that CONTRADICTS the declared name
// refuses -- does extend here, and two decidable signals establish the
// contradiction without needing a taxonomy of adjectives:
//
//  1. A SIBLING BANNER of the same filing resolves to the same series WITHOUT
//     the dropped token. `AXP LARGE CAP EQUITY FUND` is exactly the declared
//     name after the brand cut, so `quantitative` is what distinguishes the two
//     headings and cannot be surplus.
//  2. The dropped token occurs in ANOTHER declared name of the same registrant
//     under a DIFFERENT series: `Columbia Large Core Quantitative Fund`
//     (S000003287). Dropping it is therefore a choice between two series, not
//     the removal of a decoration.
//
// Neither signal is a word list, and neither is the number/region enumeration --
// `quantitative` is a distinguishing ADJECTIVE, so widening that word list would
// not have caught it. Guarding on the two signals above would.
//
// The correct answer for `AXP QUANTITATIVE LARGE CAP EQUITY FUND` is no series:
// nothing at this CIK spells a Quantitative Large Cap Equity sleeve in 2004, so
// like MISLINK2 this is a correctness gain and a coverage loss. The test asserts
// only that the QUANTITATIVE banner does not carry the plain sleeve's id, and
// leaves the sibling `AXP LARGE CAP EQUITY FUND` alone.
//
// Fix in layout_issnpx.go, issInternalTokenDropDecl (:3964), beside the
// MISLINK2 number/region guard: refuse when the dropped token appears in
// another declared name of the registrant under a different series. The same
// guard belongs on issSplicedDecl, which answers this key too.
func TestFamilyMislink3AXPQuantitativeAdjectiveDrop(t *testing.T) {
	rows := familyMislink3Dispatch(t, "axp_quantitative_adjective_drop.txt", "axp_dict.tsv", "issnpx", 3)
	for _, r := range rows {
		if r.FundName != "AXP QUANTITATIVE LARGE CAP EQUITY FUND" {
			continue
		}
		if r.SeriesID == "S000003289" {
			t.Errorf("a distinguishing adjective was dropped onto the plain sleeve's series: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want \"\" (or its own id)", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
