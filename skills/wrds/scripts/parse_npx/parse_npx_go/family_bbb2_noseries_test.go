package main

import (
	"path/filepath"
	"testing"
)

// familyBBB2Dispatch runs the real dispatch on a family BBB2 no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary.
func familyBBB2Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_bbb2", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_bbb2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000105/1050918/0001193125-14-326448.txt: 4-16, 41-62, 113-121, 163-167,
// 1824-1837. Oak Associates Funds' 2014 N-PX declares its seven series in the
// SGML header under their REGISTERED names, but the body's equals-rule headings
// print the funds' marketing names, which differ in the descriptor tail:
//
//	======================== Pin Oak Aggressive Stock Fund =========================
//
//	"AMAZON.COM, INC."
//
//	Ticker:       AMZN           Security ID:  023135106
//	"Meeting Date: MAY 21, 2014   Meeting Type: Annual"
//
// The declaration is `PIN OAK EQUITY FUND` (S000006539). Three of the seven
// headings diverge this way and resolve to nothing: `Pin Oak Aggressive Stock
// Fund` (417 rows), `White Oak Growth Stock Fund` vs `WHITE OAK SELECT GROWTH
// FUND` (356 rows) and `Black Oak Emerging Technology Select Portfolio` vs
// `BLACK OAK EMERGING TECHNOLOGY FUND` (264 rows) -- 1,037 of the filing's
// 2,546. The other four resolve, including `Red Oak Technology Select
// Portfolio` under the Portfolio/Fund type-word substitution. In every case the
// heading and the declaration agree on a two-word `<Colour> Oak` stem that is
// unique among this CIK's series and diverge only after it.
func TestFamilyBBB2OakPinOakDescriptorTail(t *testing.T) {
	rows := familyBBB2Dispatch(t, "oak_pin_oak_heading.txt", "oak_dict.tsv", "issnpx", 2)
	for _, r := range rows {
		if r.SeriesID != "S000006539" {
			t.Errorf("Pin Oak Aggressive Stock Fund: fund=%q issuer=%q item=%q series=%q want S000006539", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000009/92751/0001104659-18-053810.txt: 4-16, 51-57, 103-107, 158-166,
// 286-291, 2473-2492. The Alger Funds II 2018 N-PX carries four equals-rule
// fund banners that resolve and one that is WRAPPED over two banner lines, the
// first ending in a dangling hyphen and the second carrying the sub-adviser:
//
//	============= Alger Funds II - Alger Dynamic Opportunities Fund -  =============
//	=============                  Weatherbie Capital                  =============
//
//	2U, INC.
//
//	Ticker:       TWOU           Security ID:  90214J101
//	Meeting Date: JUN 26, 2018   Meeting Type: Annual
//
// The last banner before the issuer wins, so the fund name becomes the
// sub-adviser `Weatherbie Capital`, which is in neither the header nor the
// dictionary, and the 430 rows of that section leave series_id blank. The same
// fund's unwrapped banner at line 302 resolves 963 rows to S000026226.
func TestFamilyBBB2AlgerWrappedSubAdviserBanner(t *testing.T) {
	rows := familyBBB2Dispatch(t, "alger_weatherbie_wrapped_banner.txt", "alger_dict.tsv", "issnpx", 6)
	for _, r := range rows {
		if r.SeriesID != "S000026226" {
			t.Errorf("wrapped banner continued by the sub-adviser: fund=%q issuer=%q item=%q series=%q want S000026226", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
