package main

import (
	"path/filepath"
	"testing"
)

// 000091/914036/0001193125-22-231315.txt: verbatim source lines 1-52 (the SGML
// header down to `<EXISTING-SERIES-AND-CLASSES-CONTRACTS>`), 287-313 (the TWO
// `<SERIES>` declarations this fixture needs -- S000015972 is the fund under
// test, declared at source lines 287-298 as `LVIP Blended Mid Cap Managed
// Volatility Fund`; S000015973 is present only so the single-declared-series
// fallback does not fill `series_id` behind the defect), 1503-1511 (the header's
// close and `<TEXT>`), 47377-47442 (the fund banner's own page, banner at source
// line 47381) and 50211-50273 (the SECOND unbannered header-repeat page). Every
// byte is a line-range cut of the source; the three closing lines ` </DIV>`,
// `</TEXT>` and `</DOCUMENT>` are the only added ones, and they close markup the
// cut opened.
//
// LINCOLN VARIABLE INSURANCE PRODUCTS TRUST, CIK 914036, period 20220630,
// dispatched `splittable` (the precondition below re-asserts it on the cut).
//
// THIS IS THE SECOND OF THE TWO UNBANNERED PAGES NS60 FOUND, AND NS60 DID NOT
// FIX IT. `TestFamilyNS60LincolnUnbanneredHeaderPage` covers the first one
// (source lines 43220-43227) and passes on HEAD; this filing's remaining 2,108
// both-blank rows are all one run that begins on the second one (source lines
// 50213-50220) and ends at the next real banner, `LVIP ClearBridge Franklin
// Select Large Cap Managed Volatility Fund`, at source line 57399. On the whole
// real filing, current binary, `-cik-series` and `-series-map` OFF: 188,400 rows,
// 2,108 with both `series_id` and `fund_name` blank, contiguous, opening on the
// Chewy ballots of the page at 50213 -- which is exactly LOST_BASE's 2108
// no_series rows for this filing.
//
// IT IS NOT NS60's SHAPE AND IT IS NOT DISTANCE. The two pages are byte-identical
// from `<PRE>` through the dashed rule -- three blank lines, then the same 4-line
// stacked header -- and the brief's distance hypothesis (56 `<PRE>` pages from
// banner to the first, 88 to the second) is disproved by construction: this
// fixture is the banner page and the unbannered page ADJACENT, with all 88
// intervening pages removed, and it still fails. Crossing the two pairs isolates
// the carrier exactly -- banner page 1 + unbannered page 1 resolves, banner
// page 2 + unbannered page 2 fails, banner page 1 + unbannered page 2 FAILS, and
// banner page 2 + unbannered page 1 RESOLVES. The defect travels with the
// unbannered page, not with the banner, the section length or the page count.
//
// WHAT ACTUALLY DIFFERS -- measured, at the one line that carries it. Both
// unbannered pages print a three-line wrapped ballot description. On the first
// page the middle line still carries the wrapped issuer name (source lines
// 43242-43244):
//
//	Healthcare Trust                                      Advisory Vote to Ratify
//	of America, Inc.                                      Named Executive
//	                     HTA     42225P501   07-Jul-21    Officers' Compensation     Management            Yes
//
// On the second page the issuer is short enough to fit on one line, so the middle
// line carries the description fragment ALONE (source lines 50231-50233):
//
//	Chewy, Inc.                                           Advisory Vote to Ratify
//	                                                      Named Executive
//	                    CHWY     16679L109   14-Jul-21    Officers' Compensation     Management            Yes
//
// WHY THAT MATTERS. `pageBare` is the page's FIRST lone text run
// (`layout_splittable.go:700-708`), and `spInstitutionalPreRows` re-reads it at
// EVERY dashed rule on the page, not only the first (`layout_splittable.go:
// 605-621`). These pages carry TWO rules: the wide panel's at the top and the
// spill panel's further down (source line 50249). At the FIRST rule `pageBare` is
// still "" on both pages, so NS60's carry-the-open-fund path is taken and nothing
// is cleared -- that is the whole of what NS60 fixed. By the SECOND rule the page
// has set `pageBare`, and what it set it to is the difference:
//
//   - page 1: `Fund's Vote For or`, the spill panel's own top label line. It is
//     inside the label block, so `spPageBanner` returns "" (`layout_splittable.go:
//     744-754`) and the open fund survives. Measured on the cut: `pageBanner=""`.
//   - page 2: `Named Executive`, the wrapped description fragment above, read
//     eleven lines before the spill header ever prints. It is NOT in the label
//     block, so `spPageBanner` hands it back as a banner, `spIsBannerNamedGroup`
//     is true, and the unconditional assignment fires with a string no series
//     index can resolve. Measured on the cut: `pageBanner="Named Executive"`,
//     then `spBannerFund("Named Executive", ...)` -> "".
//
// `spBannerFund` returns "" for an unresolvable banner by design
// (`layout_splittable.go:756-776`), so `ctx.bare` is emptied and `ctx.bareFund`
// goes false. `flush` has not run yet for this page, so even the page's own
// eleven rows are emitted with no fund, and every page after it carries none
// until the next real banner. `spBannerFund`'s doc already names the hazard --
// "the same position also carries the wrapped issuer name that opens a
// continuation page (`Marvell`)" -- and a wrapped DESCRIPTION line reaches it the
// same way.
//
// Fix location: the banner arm of `spInstitutionalPreRows`,
// `layout_splittable.go:605-621`, and/or `spPageBanner`,
// `layout_splittable.go:744-754`.
func TestFamilyNS60BLincolnUnbanneredHeaderPageWrappedDescription(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	const fixture = "lincoln_unbannered_wrapped_description_2022.txt"
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture,
		filepath.Join("testdata", "family_ns60b_lincoln_unbannered_page", fixture),
		sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" || meta.Layout != "splittable" || len(rows) != 22 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want ok/splittable/22 error=%s",
			meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	const (
		wantSeries = "S000015972"
		wantFund   = "LVIP Blended Mid Cap Managed Volatility Fund"
	)

	// The cut is two pages and the reader emits them in order: rows 0-10 are the
	// banner's own page (Chewy x6 then ICON plc x5) and rows 11-21 are the
	// unbannered page (Chewy x6, nCino x4, RH x1). Chewy's six ballots are printed
	// on BOTH pages, so the halves are told apart by position and pinned by the
	// issuers unique to each.
	if rows[6].IssuerName != "ICON plc" || rows[10].IssuerName != "ICON plc" {
		t.Fatalf("fixture guard: rows 6 and 10 should be the banner page's ICON plc ballots, got %q and %q",
			rows[6].IssuerName, rows[10].IssuerName)
	}
	if rows[17].IssuerName != "nCino, Inc." || rows[21].IssuerName != "RH" {
		t.Fatalf("fixture guard: rows 17 and 21 should be the unbannered page's nCino and RH ballots, got %q and %q",
			rows[17].IssuerName, rows[21].IssuerName)
	}

	for i, r := range rows[:11] {
		// The banner's own page, which resolves today. It guards the fixture: the
		// banner at source line 47381 is what gives these rows S000015972, so if
		// they go blank the cut is broken, not the grammar.
		if r.SeriesID != wantSeries || r.FundName != wantFund {
			t.Fatalf("fixture guard: the banner's own page stopped resolving at row %d: issuer=%q series=%q fund=%q",
				i, r.IssuerName, r.SeriesID, r.FundName)
		}
	}

	for i, r := range rows[11:] {
		if r.SeriesID != wantSeries || r.FundName != wantFund {
			t.Errorf("row %d of the SECOND unbannered header-repeat page (source lines 50213-50273) lost the open fund: issuer=%q cusip=%q date=%q desc=%q how_voted=%q series=%q fund=%q want %s / %q -- the page's first lone text run is the wrapped description fragment `Named Executive` (source line 50232, printed alone because `Chewy, Inc.` fits on one line), which the spill panel's rule at source line 50249 then reads as a fund banner and clears the fund the banner at source line 47381 opened",
				i+11, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.HowVoted,
				r.SeriesID, r.FundName, wantSeries, wantFund)
		}
	}
}
