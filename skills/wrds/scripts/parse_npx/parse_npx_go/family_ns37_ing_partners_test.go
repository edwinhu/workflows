package main

import (
	"path/filepath"
	"testing"
)

// 000103/1039001/0000950124-04-004854.txt: 1-59, 41723-41773 (verbatim; the
// fixture's four closing lines are the filing's own last four). ING PARTNERS
// INC 2004, the largest undiagnosed known-registrant no-series family: 35,252
// lost rows across three filings (15,525 + 15,525 in the two FY2004 N-PX/A and
// N-PX, 4,202 in the FY2005 N-PX).
//
// The banner shape is NOT the gap. Every one of the 21 sections in this filing
// is framed `===== <NAME> =====`, issnpx reads every one of them, and all 22,648
// rows carry a fund_name. Ten of the 21 headings resolve; the 15,525 lost rows
// are exactly the eleven that do not. Nine of those eleven -- ING AELTUS
// ENHANCED INDEX, ING ALGER {GROWTH, AGGRESSIVE GROWTH, CAPITAL APPRECIATION},
// ING MFS {GLOBAL GROWTH, CAPITAL OPPORTUNITIES}, ING GOLDMAN SACHS(R) CORE
// EQUITY, ING SALOMON BROTHERS {INVESTORS VALUE, FUNDAMENTAL VALUE, AGGRESSIVE
// GROWTH} -- have no entry at any vintage under any CIK in the corpus
// dictionary: those sleeves left the registrant before EDGAR began tagging
// series in 2006, and they are a floor, not a fix.
//
// ING UBS U.S. ALLOCATION PORTFOLIO is the one that is not. The corpus declares
// that name once, verbatim and uniquely:
//
//	0000837276	S000005761	ING UBS U.S. Allocation Portfolio	20060630
//
// -- ING INVESTORS TRUST, a sibling ING registrant. The transfer is audited by
// the printed banners of the two registrants, not inferred from the name:
//
//	FY2004  1039001/0000950124-04-004854 line 41723   prints it
//	FY2004   837276/0000950124-04-004852               does not (47 banners)
//	FY2005  1039001/0000950153-05-002199               does not
//	FY2005   837276/0000950153-05-002195 line 109322  prints it
//	FY2006   837276/0001193125-06-182536 line 127633  prints it, and that
//	                                                  filing's header declares
//	                                                  S000005761 under exactly
//	                                                  this name
//
// The portfolio moved from ING Partners into ING Investors Trust between the
// FY2004 and FY2005 periods and was tagged S000005761 there. 3,670 rows in each
// FY2004 filing (7,340 of the family's 35,252) are that fund's votes.
//
// Both routes to the id refuse it, and both refuse it for the same reason --
// they are scoped to the filer's own CIK:
//
//   - cikSeries.crossCIK (cik_series.go:181) drops the hit because
//     S000005761's declaration, 20060630, post-dates the filing's 20040630
//     period. That guard is the BLACKROCK refusal and must not be widened: it
//     is what stops a 2004 heading matching a name another registrant adopted
//     years later. Verified as the blocker by backdating only that one
//     dictionary row to 20040101, which stamps all 3,670 rows.
//   - the audited hand-map route refuses it too. overlayDeclaredIDs
//     (series_overlay.go:93-106) builds the permitted set from the filing's own
//     decls plus cikDict.byCIK[meta.CIK] alone, so an id another registrant
//     declared can never be stamped however well audited the map entry is.
//     Verified by appending this fixture's map row to series_map_applied.tsv
//     against the real filing: the 3,670 rows stay blank.
//
// So the overlay -- whose entries are hand-audited by construction, and which
// already carries two rows for this filing -- cannot express a fund that
// changed registrants. That is the gap this fixture pins, and the safe fix is
// the overlay's, not crossCIK's: let the map name an id outside the filer's own
// dictionary, since a map entry is an audited assertion rather than a match.
// overlayFutureVintage does not refuse this id (its first decl is not earlier
// than the registrant's earliest), so the same-CIK membership test is the only
// thing to relax.
//
// The test asserts only that the section's rows carry S000005761. It fails
// today with a blank series_id.
func TestFamilyNS37INGPartnersCrossRegistrantOverlay(t *testing.T) {
	dir := filepath.Join("testdata", "family_ns37_ing_partners")
	fixture := "ing_partners_2004_ubs_allocation.txt"
	relPath := "000103/1039001/0000950124-04-004854.txt"

	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })

	var err error
	if cikDict, err = loadCIKSeries(filepath.Join(dir, "ing_partners_cik_series.tsv")); err != nil {
		t.Fatal(err)
	}
	if seriesMap, err = loadSeriesOverlay(filepath.Join(dir, "ing_partners_series_map.tsv")); err != nil {
		t.Fatal(err)
	}

	sink := &rowSink{}
	meta := processFile(relPath, filepath.Join(dir, fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s error=%s", meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	if len(sink.buf) == 0 {
		t.Fatalf("fixture precondition: %s parsed to no rows", fixture)
	}

	const wantFund = "ING UBS U.S. ALLOCATION PORTFOLIO"
	const wantSeries = "S000005761"
	blank := 0
	for _, r := range sink.buf {
		if r.FundName != wantFund {
			t.Fatalf("fixture precondition: row under fund %q, want %q", r.FundName, wantFund)
		}
		if r.SeriesID != wantSeries {
			blank++
		}
	}
	if blank > 0 {
		t.Errorf("%d of %d rows under %q carry series_id %q, want %s: the audited hand-map names it, "+
			"but overlayDeclaredIDs (series_overlay.go:93) permits only ids of CIK 0001039001's own dictionary, "+
			"and ING INVESTORS TRUST (0000837276) is the registrant that declared it",
			blank, len(sink.buf), wantFund, sink.buf[0].SeriesID, wantSeries)
	}
}
