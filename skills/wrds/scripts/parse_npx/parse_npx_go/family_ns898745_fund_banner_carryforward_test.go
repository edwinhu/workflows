package main

import (
	"path/filepath"
	"testing"
)

// 000089/898745/0000898745-11-000564.txt (Principal Funds, Inc., period
// 20110630, 709,824 lines): 1-841, 437217-438087, 455212-457773,
// 709818-709824. Every range is a whole vendor page cut at the
// `<!--$$/page=-->` rule, copied byte for byte off /wrds/sec/archives.
//
// A full-file dispatch on this binary emits 9,562 rows, 124 of them with an
// empty series_id, and every one of the 124 carries the same pair:
//
//	124 ||Principal Investors Fund, Inc|Location(s): Essex Investment Management Company, LLC
//
// The count is 124 with and without -series-map, so the overlay is not in it.
//
// The export is the Broadridge/ProxyEdge page grammar. It prints the
// registrant's own `FUND:` banner ONCE, in the title block of the run's first
// page, and reprints only the shorter run-parameter strip (`Vote Summary
// Report` / `Report was run from` / `Location(s)` / `Institution Account(s)`)
// on every page after it. layout_htmltable.go already holds the banner across
// those pages: htmlExplicitFundBanner sets bannerFund, and the
// `Institution Account(s):` labelled cell is then skipped rather than adopted
// (layout_htmltable.go:309-316, the Principal Variable Contracts Funds 2011
// family). That guard is what makes the first 1,119 rows of this very run
// resolve.
//
// What breaks it is a heading that names an ISSUER, not a fund. At source line
// 455598, mid-run, the vote table prints
//
//	<B><FONT size=2 face="sans-serif">STEC, Inc.</FONT></B></TD>
//
// as a centred bold colspan=10 row. It is adopted as a fund heading, which
// both files its own 6 rows under S000007211 (Principal LifeTime Strategic
// Income Fund -- a fund this run has nothing to do with) and clears
// bannerFund. From the next page on, `Institution Account(s): Principal
// Investors Fund, Inc` is adopted instead. That value is not a fund at all: it
// is this registrant's FORMER CONFORMED NAME, carried in the filing's own SGML
// header ("FORMER CONFORMED NAME: PRINCIPAL INVESTORS FUND INC", name change
// 20001012). It matches no declared series, so series_id goes empty and stays
// empty for the remaining 124 rows of the run.
//
// Blanking that one heading in a copy of this fixture and re-running turns all
// 33 rows into S000007176 with no other change, which is the direct evidence
// that the banner carry-forward is intact and only its authority is being lost:
//
//	33 S000007176|Principal Funds, Inc. - SmallCap Growth Fund II
//
// The run is safe to attribute, and the safety is decidable from the filing
// alone rather than from a "most-recently-seen banner" guess -- the failure
// mode of the sibling floor 1064642-streettracks-continuation-banner-
// misattribution, where funds interleave without reliable banner boundaries.
// Here they do not interleave:
//
//   - The filing prints 60 `FUND:` lines. The Essex run opens at line 437225
//     with `FUND:  Principal Funds, Inc. - SmallCap Growth Fund II` and the
//     NEXT `FUND:` line in the whole file is at 468418, which names the SAME
//     fund (`Principal Funds, Inc. &#150; SmallCap Growth Fund II`). No banner
//     of any kind falls between them, so no fund change is marked or implied.
//   - `SUB-ADVISOR:  Essex Investment Management Company, LLC` is printed once,
//     at 437227, and no other SUB-ADVISOR line appears before 468418. All 51
//     Essex mentions in the file lie inside this one run.
//   - `Institution Account(s):` takes 7 distinct values across the filing --
//     Real Estate Fund (4025), SmallCap Blend Fund (17379), SmallCap Growth
//     Fund (70234), Pif Small Cap Fund (143734), PFI SMALLCAP GROWTH FUND I -
//     PMC (179817), Principal Investors Fund, Inc (437239), PFI SMALLCAP
//     GROWTH FUND II - PMC (468478) -- and EVERY change of value has a `FUND:`
//     banner between it and the value before it. Inside the Essex run the
//     value never changes.
//
// All 124 blank rows of the real filing, and all 21 of this fixture, therefore
// belong to `SmallCap Growth Fund II`, which CIK 0000898745 declares itself:
//
//	0000898745	S000007175	SmallCap Growth Fund I	20080630
//	0000898745	S000007176	SmallCap Growth Fund II	20080630
//
// principal_dict.tsv carries all 167 cik_series.tsv rows this CIK has ever
// declared, not just the two, so nothing here can pass by a single-series
// fallback: 121 distinct series ids are in scope and only one is right.
func TestFamilyNS898745FundBannerCarryForwardLostToIssuerHeading(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns898745_fund_banner_carryforward", "principal_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	const fixture = "principal_essex_banner_carryforward.txt"
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns898745_fund_banner_carryforward", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || len(sink.buf) != 33 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=33 error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	for i, r := range sink.buf {
		if r.SeriesID != "S000007176" {
			t.Errorf("row %d of the Essex run under `FUND:  Principal Funds, Inc. - SmallCap Growth Fund II` (source line 437225): fund=%q issuer=%q cusip=%q date=%q item=%q series=%q want S000007176",
				i, r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq, r.SeriesID)
		}
	}
}
