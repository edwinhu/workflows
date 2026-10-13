package main

import (
	"path/filepath"
	"testing"
)

// 000089/898745/0000898745-11-000555.txt (Principal Funds, Inc., period
// 20110630, 389,652 lines): 1-627, 31451-32004, 125592-127416, 389646-389652.
// Every middle range is a whole vendor page cut at the `<!--$$/page=-->` rule,
// copied byte for byte off /wrds/sec/archives; 1-627 is the filing's own SGML
// header and cover page, which is what the layout registry dispatches on.
//
// A full-file dispatch on this binary emits 5,499 rows. 901 of them carry an
// empty series_id and every one of the 901 carries the same fund name:
//
//	901 |PIF INTERNATIONAL FUND I EMMK
//
// The registrant's `Diversified International Fund` section runs from source
// line 31451 to 241970 and is 1,318 rows. The first 417 resolve; the remaining
// 901 do not:
//
//	417 S000006992|Principal Funds, Inc. – Diversified International Fund
//	901            |PIF INTERNATIONAL FUND I EMMK
//
// The export is the ISS `Vote Summary Report` page grammar. The section's fund
// is named ONCE, at source line 31468, by the registrant's own banner:
//
//	FUND:  Principal Funds, Inc. &#150; Diversified International Fund
//
// and every page after it reprints only the run-parameter strip -- `Vote
// Summary Report` / `Report was run from:` / `Location(s):` / `Institution
// Account(s): PIF INTERNATIONAL FUND I EMMK`. That last line is the vendor's
// internal account code, not a fund, and it is NOT the all-prefixed blanket
// form htmlReportParameterLine skips, so the only thing keeping it from being
// adopted as the section's heading is the banner guard at
// layout_htmltable.go:316, which refuses an `Institution Account` labelled cell
// while bannerFund is set. htmlExplicitFundBanner's own doc comment states that
// invariant: the account code "printed under the same title block and
// reprinted on every continuation page, never displaces" the `FUND:` banner.
//
// What breaks it is one wrapped word. At source line 125831 the vote table
// prints the tail of a proposal that the vendor hard-wraps across five sibling
// rows --
//
//	Receive Board of Directors Report on Company's 2010 Business
//	Operations; Receive Financial Statements and Consolidated
//	Financial Statements; Receive Proposal on Allocation of 2010
//	Income
//
// -- and the last fragment, `Income`, lands alone as the only filled cell of
// its row. The two-cell heading reader adopts it (layout_htmltable.go:488-491),
// because the registrant's cross-filing dictionary declares a series literally
// named `Income Fund`:
//
//	0000898745	S000014242	Income Fund	20070630
//
// This filing's own SGML header declares nine series and S000014242 is not
// among them, so the fragment resolves only through the dictionary. Adopting it
// sets curSeries=S000014242 AND clears bannerFund. From the next page break on,
// `Institution Account(s): PIF INTERNATIONAL FUND I EMMK` walks past the :316
// guard and is adopted at :321-322 instead, on that page and on all 199 pages
// after it, and series_id is empty for the remaining 901 rows of the section.
//
// Blanking that one cell in a copy of this fixture and re-running turns all 15
// rows into S000006992 with no other change, which is the direct evidence that
// the banner carry-forward itself is intact and only its authority is being
// lost:
//
//	15 S000006992|Principal Funds, Inc. – Diversified International Fund
//
// The run is safe to attribute, and the safety is decidable from the filing
// alone rather than from a "most-recently-seen banner" guess:
//
//   - `Institution Account(s):` holds the value `PIF INTERNATIONAL FUND I EMMK`
//     unchanged across all 200 pages of the section, from line 31530 to the end
//     of the run. It never varies inside the banner's scope.
//   - No `FUND:` line of any kind falls between the banner at 31468 and the
//     next one at 241971, which opens a different section (`Diversified Real
//     Asset Fund`). No fund change is marked or implied anywhere in between.
//   - `Income` occurs exactly once as a lone cell in the whole section
//     (`grep -n '>Income</FONT>'` over lines 31451-241970 returns line 125831
//     and nothing else), and its four preceding sibling rows are the rest of
//     one sentence. It is proposal prose, not a heading.
//
// principal_dict.tsv carries all 167 cik_series.tsv rows this CIK has ever
// declared -- 121 distinct series ids -- so nothing here can pass by a
// single-series fallback. The test runs overlay-free by construction
// (seriesMap = nil), so series_map_applied.tsv is not in it either.
func TestFamilyNS898745EMMKCarryForwardLostToWrappedProposalWord(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns898745_emmk_carryforward", "principal_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	const fixture = "principal_emmk_carryforward.txt"
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns898745_emmk_carryforward", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || len(sink.buf) != 15 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=15 error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	for i, r := range sink.buf {
		if r.SeriesID != "S000006992" {
			t.Errorf("row %d of the section opened by `FUND:  Principal Funds, Inc. - Diversified International Fund` (source line 31468): fund=%q issuer=%q cusip=%q date=%q item=%q series=%q want S000006992",
				i, r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq, r.SeriesID)
		}
	}
}
