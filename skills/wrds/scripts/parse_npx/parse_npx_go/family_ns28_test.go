package main

import (
	"path/filepath"
	"testing"
)

// familyNS28Dispatch runs the real dispatch on a family NS28 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS28Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns28", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns28", fixture), sink, make([]byte, headBytes))
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

// 000104/1046027/0000907244-05-000310.txt: verbatim source lines 11-29 (the SEC
// document opener through the registrant's FISCAL YEAR END), 49-61 (the header
// closer through the opening `<div>`), 153-175 (the cover's series list,
// including the parenthetical rename line), 199-210 (the `FORM N-Px REPORT`
// banner with its ICA number, reporting period and registrant line),
// 15940-15972 (the EVERGREEN GLOBAL LEADERS banner and the whole ACE LTD. block
// under it) and the filing's own last five lines. Every byte is verbatim.
// Dispatches to `issnpx` (the precondition asserts it).
//
// Evergreen International Trust, period 20050630, `issnpx`. Measured on the
// current tree with the full 41,139-row dictionary:
//
//	=== 000104/1046027/0000907244-05-000310.txt layout=issnpx status=ok rows=7235 blank=1587
//	    1992 S000003433  "EVERGREEN INTERNATIONAL EQUITY FUND"
//	    1678 S000003430  "EVERGREEN EMERGING MARKETS GROWTH FUND"
//	    1587 blank       "EVERGREEN GLOBAL LEADERS FUND"
//	    1529 S000003432  "EVERGREEN GLOBAL OPPORTUNITIES FUND"
//	     449 S000003434  "EVERGREEN PRECIOUS METALS FUND"
//
// Four of the filing's five banners resolve; the fifth is blank because the
// dictionary's earliest vintage for this CIK (20060630) spells the fund by its
// CURRENT name, `Evergreen Global Large Cap Equity Fund` (S000003431) -- the one
// declared series no banner in this filing claims.
//
// The rename is not inferred: THE FILING ITSELF PRINTS IT, on the cover's series
// list, source lines 165 and 167 verbatim (tags stripped):
//
//	Evergreen Global Large Cap Equity Fund
//	     (changed name from Evergreen Global Leaders Fund on 11/05/04)
//
// so the banner's series id is named by the bytes rather than reached by
// elimination or by string similarity. The rename post-dates the period's start
// (11/05/04, inside 07/01/2004-06/30/2005), which is exactly why the body still
// prints the old spelling while the header and the dictionary carry the new one.
//
// PROBED, not judged by eye, against this filing's own index (6
// dictionary-backfilled decls; the 2005 filing declares no `<SERIES>` blocks):
//
//	icrResolveFundShared(ix, "EVERGREEN GLOBAL LEADERS FUND")     -> ""
//	icrResolveFundShared(ix, "GLOBAL LEADERS FUND")               -> ""
//	icrResolveFundShared(ix, "EVERGREEN INTERNATIONAL EQUITY FUND") -> "S000003433"  (contrast)
//
// Fix location: `layout_issnpx.go`, the cover-page pass that runs before the
// banner loop in `parseISSNPX` -- a `(changed name from <X> on <date>)` line
// under a cover-list fund name is a filing-declared alias of the name above it,
// and belongs in the index the way `issFormerKeys` folds the header's FORMER
// CONFORMED NAMEs in, keyed to the id the current name resolves to.
func TestFamilyNS28EvergreenCoverChangedNameFrom(t *testing.T) {
	rows := familyNS28Dispatch(t, "evergreen_global_leaders_rename.txt", "evergreen_dict.tsv", "issnpx", 3)
	for _, r := range rows {
		if r.SeriesID != "S000003431" {
			t.Errorf("the cover prints `(changed name from Evergreen Global Leaders Fund on 11/05/04)` under `Evergreen Global Large Cap Equity Fund`, so the banner's series is named by the filing's own bytes: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want S000003431",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000087/875352/0000910682-04-000022.txt: verbatim source lines 11-29 (the SEC
// document opener through the registrant's FISCAL YEAR END), 50-90 (the header
// closer, the document opener, the FORM N-PX cover and `ITEM 1. PROXY VOTING
// RECORD.`), 17689-17709 (the REAL ESTATE INVESTMENT TRUST PORTFOLIO two-line
// banner and the whole ALEXANDRIA REAL ESTATE EQUITIES block under it) and the
// filing's own last five lines. Every byte is verbatim. Dispatches to `issnpx`
// (the precondition asserts it).
//
// Delaware Pooled Trust, period 20040630, `issnpx`. This is a WRONG series, not
// a blank one. Measured on the current tree with the full 41,139-row dictionary,
// the two REIT sections of this filing:
//
//	286 S000003933  "THE REAL ESTATE INVESTMENT TRUST PORTFOLIO (a/k/a DELAWARE REIT FUND)"
//	286 S000003933  "THE REAL ESTATE INVESTMENT TRUST PORTFOLIO II"
//
// Both are stamped S000003933, which the dictionary declares as `THE REAL ESTATE
// INVESTMENT TRUST PORTFOLIO II`. The filing prints the two as SEPARATE ruled
// sections (source lines 17689 and 18461), so they cannot be one fund, and the
// first one's own second banner line names the other fund outright. Source lines
// 17689-17690 verbatim:
//
//	================== THE REAL ESTATE INVESTMENT TRUST PORTFOLIO ==================
//	==========================  (a/k/a DELAWARE REIT FUND) =========================
//
// The a/k/a reaches the row's fund_name, so the continuation line IS read -- but
// the series is resolved from the first line alone, and `THE REAL ESTATE
// INVESTMENT TRUST PORTFOLIO` gets there by dropping the declared name's
// trailing ordinal `II`.
//
// PROBED, not judged by eye, against this filing's own index (33
// dictionary-backfilled decls; the 2004 filing declares no `<SERIES>` blocks).
// The joined banner resolves EXACTLY, to a different id than the tree stamps:
//
//	icrResolveFundShared(ix, "THE REAL ESTATE INVESTMENT TRUST PORTFOLIO (a/k/a DELAWARE REIT FUND)") -> "S000003937"
//	icrResolveFundShared(ix, "DELAWARE REIT FUND")                            -> "S000003937"
//	icrResolveFundShared(ix, "THE REAL ESTATE INVESTMENT TRUST PORTFOLIO")    -> "S000003933"  (the ordinal drop)
//	icrResolveFundShared(ix, "THE REAL ESTATE INVESTMENT TRUST PORTFOLIO II") -> "S000003933"  (the OTHER section)
//
// `series_map_applied.tsv` names the same answer independently -- the one
// overlay row on this path is
// `000087/875352/0000910682-04-000022.txt<TAB>THE REAL ESTATE INVESTMENT TRUST PORTFOLIO (a/k/a DELAWARE REIT FUND)<TAB>S000003937<TAB>1.0<TAB>286`.
//
// Fix location: `layout_issnpx.go`, the banner chain in `parseISSNPX` -- a ruled
// banner line immediately followed by a second ruled banner line is ONE heading,
// and the series lookup must be handed the joined text that already reaches
// fund_name. The ordinal-drop rung that answers the truncated first line is the
// reason the defect is a wrong id rather than a blank.
func TestFamilyNS28DelawareREITAkaBannerLine(t *testing.T) {
	rows := familyNS28Dispatch(t, "delaware_reit_aka_banner.txt", "delaware_dict.tsv", "issnpx", 9)
	for _, r := range rows {
		if r.SeriesID != "S000003937" {
			t.Errorf("the banner's second ruled line names `(a/k/a DELAWARE REIT FUND)` and the joined heading resolves exactly, but the series is taken from the truncated first line and lands on the filing's OTHER REIT section: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want S000003937",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
