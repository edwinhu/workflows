package main

import (
	"path/filepath"
	"testing"
)

// familyMislinkGSTIDispatch runs the real dispatch on the family MISLINK-GSTI
// fixture with the named dictionary and series-map overlay loaded (either may
// be "" for "not loaded at all"), and asserts the fixture's own preconditions
// -- status, layout, row count, CIK and period -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyMislinkGSTIDispatch(t *testing.T, fixture, dict, overlay, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	var err error
	if dict != "" {
		if cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink_gsti", dict)); err != nil {
			t.Fatal(err)
		}
	}
	if overlay != "" {
		if seriesMap, err = loadSeriesOverlay(filepath.Join("testdata", "family_mislink_gsti", overlay)); err != nil {
			t.Fatal(err)
		}
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink_gsti", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	if meta.CIK != "0001100663" || meta.PeriodOfReport != "20070630" {
		t.Fatalf("fixture/dispatch precondition: cik=%s period=%s", meta.CIK, meta.PeriodOfReport)
	}
	return rows
}

// 000110/1100663/0001193125-07-193032.txt: verbatim source lines 1-1165 (the
// SEC document opener, the whole SGML header including every
// <SERIES-ID>/<SERIES-NAME>/<CLASS-CONTRACT-*> declaration this registrant
// makes, and the document's <TYPE>/<TEXT>/<PAGE> opener through the FORM N-PX
// title), then the `ISHARES DOW JONES U.S. TECHNOLOGY SECTOR INDEX FUND`
// section banner with the whole of 3COM CORPORATION's 20-Sep-2006 AGM under
// it, then the `ISHARES S&P GSTI[TM] TECHNOLOGY INDEX FUND` section banner with
// the same issuer's block under it. Every byte is verbatim; only whole lines
// were dropped, and the two blocks are byte-identical to each other except for
// the banner line, so any difference in the rows they produce is the banner's
// resolution and nothing else. The header is kept COMPLETE -- all 90 <SERIES>
// blocks, 110 declarations once the dictionary backfill is counted -- because
// the declared set IS the evidence the resolver reads, and a two-name header
// would change the answer rather than shorten the fixture.
//
// `gsti_overlay.tsv` carries this filing's four `series_map_applied.tsv` rows
// verbatim but for the filing key, which is rewritten to the fixture's name so
// the overlay reaches this dispatch. `dict.tsv` is all 882
// `cik_series.tsv` rows for CIK 0001100663.
//
// iShares Trust, CIK 1100663, period 20070630, layout `issnpx`.
//
// The registrant declares TWO DISTINCT series whose names both carry the word
// `Technology` (source lines 275-284 and 505-514):
//
//	<SERIES-ID>S000004329  iShares Dow Jones U.S. Technology Sector Index Fund  (class C000012059, ticker IYW)
//	<SERIES-ID>S000004352  iShares Goldman Sachs Technology Index Fund          (class C000012082, ticker IGM)
//
// and prints a separate section for each. The second is banner-headed with the
// index vendor's later name for the same IGM fund -- GSTI is Goldman Sachs
// Technology Index -- so the two banners are:
//
//	============= ISHARES DOW JONES U.S. TECHNOLOGY SECTOR INDEX FUND ==============   <- S000004329
//	================== ISHARES S&P GSTI[TM] TECHNOLOGY INDEX FUND ==================   <- S000004352
//
// and the GSTI one is stamped S000004329, moving 1,684 rows of the Goldman
// Sachs Technology Index Fund onto a Dow Jones sector fund that cast none of
// them -- which is worse than leaving them blank.
//
// THE ROUTE IS PROBED, not judged by eye, and it is NOT the resolver. Running
// the real dispatch on this fixture with `dict.tsv` loaded and NO overlay, and
// asking `issResolveFund` directly on the index the dispatch builds
// (`newISSSeriesIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName))`,
// 110 decls, `ix.commonSuffix == "fund"`), every GSTI banner of this registrant
// answers nil:
//
//	"ISHARES S&P GSTI[TM] TECHNOLOGY INDEX FUND"          -> nil
//	"ISHARES S&P GSTI[TM] NETWORKING INDEX FUND"          -> nil
//	"ISHARES S&P GSTI[TM] SOFTWARE INDEX FUND"            -> nil
//	"ISHARES DOW JONES U.S. TECHNOLOGY SECTOR INDEX FUND" -> S000004329 "iShares Dow Jones U.S. Technology Sector Index Fund"
//
// So the common-suffix / stem-drop machinery (`issCommonLastWord`, `lessSuffix`,
// `lessSuffixSibling`, the brand-strip loop at `layout_issnpx.go:3620-3660`) is
// NOT picking the wrong one of two collision candidates: it declines the GSTI
// key entirely, and the vendor's `GSTI[TM]` rename is unreachable from the
// header, which spells the fund `Goldman Sachs`. Without the overlay the whole
// GSTI section is BLANK, and the three siblings this registrant prints
// (NETWORKING / SEMICONDUCTOR / SOFTWARE) are blank too rather than
// self-resolving.
//
// The stamp is the SERIES-MAP OVERLAY. `series_map_applied.tsv` carries exactly
// four rows for this filing, and the three siblings are right while the fourth
// is wrong:
//
//	heading                                        series_id   confidence  rows
//	ISHARES S&P GSTI[TM] NETWORKING INDEX FUND     S000004353  1.0          198   <- correct
//	ISHARES S&P GSTI[TM] SEMICONDUCTOR INDEX FUND  S000004354  1.0          420   <- correct
//	ISHARES S&P GSTI[TM] SOFTWARE INDEX FUND       S000004355  1.0          341   <- correct
//	ISHARES S&P GSTI[TM] TECHNOLOGY INDEX FUND     S000004329  1.0         1684   <- WRONG, want S000004352
//
// The overlay row is internally inconsistent with its own three siblings: they
// map the GSTI family onto the registrant's Goldman Sachs series in ID order
// (S000004353/4354/4355 are `iShares Goldman Sachs Networking / Semiconductor /
// Software Index Fund`), and the TECHNOLOGY member of that same contiguous
// block is S000004352, `iShares Goldman Sachs Technology Index Fund`, whose sole
// class C000012082 carries the ticker IGM that GSTI names. S000004329 is a
// different family (Dow Jones, ticker IYW) and already has its own separate
// banner and its own 1,563 rows in this filing, so the overlay hands one
// series_id two distinct printed sections.
//
// The MISLINK-JHVIT756913-2A32 guard (`seriesOverlay.applyWithHeader`,
// series_overlay.go) is the one that should have caught it and structurally
// cannot: it refuses an overlay id only when the filing's OWN header resolves
// the printed heading to a DIFFERENT series, and here the header resolves
// `ISHARES S&P GSTI[TM] TECHNOLOGY INDEX FUND` to nothing at all (probe above),
// so there is no header answer to disagree with. The evidence that convicts
// this row is not the header's reading of the heading but the SIBLING
// OVERLAY ROWS for the same filing: three of the four GSTI headings map into one
// contiguous declared block, and the fourth jumps out of it onto a series that
// already owns another section of the same filing.
//
// Fix location: `series_overlay.go` -- an overlay id must not be stamped on a
// heading when the same filing's overlay already stamps that id on a DIFFERENT
// heading, or (the positive form) when the heading's sibling overlay rows agree
// on a contiguous declared block that the id falls outside of. Either predicate
// refuses this row; neither touches the three correct siblings.
//
// Rows affected: 1,684 on this path in the real filing, currently WRONG.
// The Dow Jones section asserted below is the control, measured on the same
// dispatch: its banner reaches S000004329 through the linker on the filing's own
// header-declared name, with no overlay row involved, and it must keep its id.
func TestFamilyMislinkGSTITechnologyIndexFundOverlay(t *testing.T) {
	rows := familyMislinkGSTIDispatch(t, "ishares2007_gsti_technology.txt", "dict.tsv", "gsti_overlay.tsv", "issnpx", 10)
	var dj, gsti int
	for _, r := range rows {
		switch r.FundName {
		case "ISHARES DOW JONES U.S. TECHNOLOGY SECTOR INDEX FUND":
			dj++
			if r.SeriesID != "S000004329" {
				t.Errorf("the Dow Jones section is the control -- it resolves through the filing's own header-declared name with no overlay row -- and must keep its id: issuer=%q item=%q series=%q want S000004329",
					r.IssuerName, r.ItemSeq, r.SeriesID)
			}
		case "ISHARES S&P GSTI[TM] TECHNOLOGY INDEX FUND":
			gsti++
			if r.SeriesID != "S000004352" {
				t.Errorf("GSTI is Goldman Sachs Technology Index, the vendor's later name for the IGM fund this registrant declares as `iShares Goldman Sachs Technology Index Fund` (S000004352, class C000012082); its three sibling GSTI headings in this same filing are mapped by the same overlay onto the contiguous Goldman Sachs block S000004353/4354/4355, while this row jumps onto S000004329 -- `iShares Dow Jones U.S. Technology Sector Index Fund`, ticker IYW -- which already has its own separate banner and its own rows in this filing, so the overlay gives one series_id two distinct printed sections and moves the Goldman Sachs fund's votes onto the Dow Jones fund: issuer=%q item=%q cusip=%q date=%q series=%q want S000004352",
					r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.SeriesID)
			}
		default:
			t.Errorf("unexpected section %q (series %q)", r.FundName, r.SeriesID)
		}
	}
	if dj != 5 || gsti != 5 {
		t.Fatalf("fixture sections: dowjones=%d gsti=%d want 5/5", dj, gsti)
	}
}
