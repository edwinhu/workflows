package main

import (
	"path/filepath"
	"testing"
)

// familyDDD2Dispatch runs the real dispatch on a family DDD no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when one
// is named.
func familyDDD2Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ddd2", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ddd2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000104/1045487/0001398344-15-005572.txt: 1-19, 43-69, 100-108, 12626-12652.
// James Advantage Funds' 2015 N-PX declares five series and prints an
// equals-rule Courier banner over each section. One banner names the fund by its
// MARKETING name, with the declared name's tokens re-ordered around a slash:
//
//	<div style="... 'Courier New' ...">================ The Golden Rainbow/A James Advised Mutual Fund ================</div>
//	...
//	<div style="... 'Courier New' ...">AAR CORP.</div>
//	<div style="... 'Courier New' ...">Ticker:&#160; &#160; &#160;&#160; AIR&#160; ... Security ID:&#160; 000361105</div>
//
// The header of this same filing declares
//
//	<SERIES-ID>S000003560
//	<SERIES-NAME>James Balanced: Golden Rainbow Fund
//
// and cik_series.tsv carries the same single name for S000003560. The banner
// keeps the distinctive pair `Golden Rainbow` and the token `James`, but adds
// `The`, `A`, `Advised`, `Mutual`, drops `Balanced`, and puts `James` after the
// slash rather than first, so neither the exact match nor the registrant-prefix
// strip reaches the declared name.
//
// 1,574 of the filing's 3,825 rows leave series_id blank under this one banner —
// the largest single block of the filing's 1,889 no-series rows.
//
// Fix in issResolveFund (layout_issnpx.go), beside the existing brand-prefix and
// type-word retries: when a banner and exactly one declared name of this CIK
// share a distinctive multi-token stem (`Golden Rainbow`) owned by no other
// series, take that series rather than requiring token containment in order.
func TestFamilyDDD2JamesGoldenRainbowMarketingName(t *testing.T) {
	rows := familyDDD2Dispatch(t, "james_golden_rainbow_heading.txt", "james_dict.tsv", "issnpx", 2)
	for _, r := range rows {
		if r.SeriesID != "S000003560" {
			t.Errorf("`The Golden Rainbow/A James Advised Mutual Fund` vs declared `James Balanced: Golden Rainbow Fund`: fund=%q issuer=%q item=%q series=%q want S000003560", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000121/1217673/0001017918-05-000120.txt: 11-29, 52-57, 125-152. Baron Select
// Funds' 2005 N-PX/A declares ZERO series in its SGML header — there is no
// <SERIES-AND-CLASSES-CONTRACTS-DATA> block at all — so the chassis never
// stamps. The body names the fund twice, under the registrant line:
//
//	                                BARON SELECT FUND
//	                       BARON CAPITAL PARTNERS FUND SERIES
//	<TABLE>
//	AMERIGROUP CORPORATION                           CUSIP:03073T102   TICKER: AGP            MEETING DATE: 05/11/05   TYPE: ANNUAL
//
// The CIK dictionary carries `BARON PARTNERS FUND` for S000000588 (first seen in
// this registrant's very next filing, 20060630). The banner is that name with
// `CAPITAL` inserted and `SERIES` appended, and no other series of this CIK
// carries `PARTNERS`, so the mapping is unambiguous.
//
// All 312 of the filing's 312 rows leave series_id blank.
//
// Fix in parseBroadridge (layout_broadridge.go) at the banner read: a centred
// all-caps line above the vote table is a fund heading and must be put to the
// series index (newISSSeriesIndex / issResolveFund), with the dictionary
// consulted when the header declares nothing — today the banner is dropped and
// fund_name comes out empty.
func TestFamilyDDD2BaronCapitalPartnersSeriesBanner(t *testing.T) {
	rows := familyDDD2Dispatch(t, "baron_capital_partners_series_heading.txt", "baron_dict.tsv", "broadridge", 4)
	for _, r := range rows {
		if r.SeriesID != "S000000588" {
			t.Errorf("`BARON CAPITAL PARTNERS FUND SERIES` vs dictionary `BARON PARTNERS FUND`: fund=%q issuer=%q item=%q series=%q want S000000588", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
