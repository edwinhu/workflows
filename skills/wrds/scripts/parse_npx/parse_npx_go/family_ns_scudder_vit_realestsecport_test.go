package main

import (
	"path/filepath"
	"testing"
)

// Scudder Investments VIT Funds (CIK 0001006373, filing agent 0000088053).
// Filing 000100/1006373/0000088053-04-000667.txt (period 20040630, splittable)
// emits 12,903 rows under four ProxyEdge `Selected Accounts:` banners:
//
//	6,262 rows  `Scudder VIT EAFE Equity Index`   blank  <- floor, see below
//	4,602 rows  `VIT Small Cap Index Fund`        S000006223
//	1,937 rows  `Scudder VIT Equity 500 Index`    S000006221
//	  102 rows  `Scudder VIT Real Est Sec Port`   blank  <- this test
//
// # The chassis is not the problem
//
// Two of the four banners already stamp correctly on HEAD, and they do it
// through the same VIT-prefix-strip and dictionary-name grammar this banner
// needs: `Scudder VIT Equity 500 Index` reaches S000006221 `DWS Equity 500
// Index VIP`, and `VIT Small Cap Index Fund` reaches S000006223 `DWS Small Cap
// Index VIP`. Only the third abbreviates its fund words -- `Real Est Sec Port`
// for `Real Estate Securities Portfolio` -- and no rung expands `Est`, `Sec` or
// `Port`, so the dictionary name `DWS RREEF Real Estate Securities VIP` is
// never reached and the 102 rows keep a blank series_id.
//
// # Why S000006222
//
//  1. The filing's own cover page (lines 66-70 of the real filing, reproduced
//     verbatim in the fixture) names the four series it reports:
//
//     Scudder EAFE Equity Index Fund
//     Scudder Equity 500 Index Fund
//     Scudder Real Estate Securities Portfolio
//     Scudder Small Cap Index Fund
//     Each a Series of Scudder Investments VIT Funds
//
//     `Scudder Real Estate Securities Portfolio` is the filing's OWN name for
//     this fund, and `Scudder VIT Real Est Sec Port` is that name with the
//     registrant's VIT marker inserted and its last three words abbreviated.
//     Note the parser does not read this cover page today -- it is identity
//     evidence, not the resolution route.
//
//  2. This CIK carries exactly five dictionary rows, three distinct ids, and
//     exactly one of them is a real-estate fund:
//
//     S000006222  DWS RREEF Real Estate Securities VIP  (20060630)
//
//     The other two are already spoken for by the two banners that resolve.
//     The 20060630 vintage is a later rename -- `DWS RREEF ... VIP` is not a
//     string this 2004 filing ever prints -- so the match has to run through
//     the shared `Real Estate Securities` words, which is exactly what the
//     abbreviation blocks.
//
// # What this test does NOT claim
//
// The largest blank banner in the filing, `Scudder VIT EAFE Equity Index`
// (6,262 rows), is FLOOR. The cover page declares a fourth series, `Scudder
// EAFE Equity Index Fund`, but CIK 0001006373's dictionary carries no fourth
// id: the fund was gone before EDGAR began tagging series in 2006, so there is
// no S-id to stamp. No name rung can invent one and this test asserts nothing
// about those rows.
//
// The sibling 2005 filing 0000088053-05-000983.txt spells the banner in full
// -- `Selected Accounts: Scudder VIT Real Estate Securities Portfolio` at line
// 78005 -- but its block is the two-line `NO PROXIES RECEIVED OR VOTED FOR THIS
// FUND` and emits ZERO rows, so it cannot carry a fixture. It is still useful
// as corroboration: the same vendor, the same registrant, one year apart, calls
// this fund `Real Estate Securities Portfolio`.
//
// # Fixture
//
//	scudder_vit_2004_realestsecport.txt -- four verbatim excerpts of
//	000100/1006373/0000088053-04-000667.txt, concatenated with no edits:
//	lines 1-125 (the SGML header and the FORM N-PX cover page with its
//	four-series declaration), lines 63826-63854 (the `Scudder VIT Equity 500
//	Index` banner and its first ballot -- NVIDIA, 2 voted items -- the working
//	CONTROL), lines 76675-76713 (the `Scudder VIT Real Est Sec Port` banner at
//	real-filing line 76679 and its first ballot -- CATELLUS DEVELOPMENT
//	CORPORATION, 5 voted items) and lines 113595-113598 (the trailing document
//	tags). md5 of the assembled fixture equals md5 of those four ranges taken
//	from the copy on WRDS.
//
//	dict.tsv -- all five cik_series.tsv rows this CIK carries, copied verbatim.
//
// In the fixture the control stamps S000006221 on both its rows and the target
// leaves all five of its rows blank, reproducing the real filing's split.
func TestFamilyNSScudderVITRealEstSecPort(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns_scudder_vit_realestsecport", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	const (
		fixture     = "scudder_vit_2004_realestsecport.txt"
		period      = "20040630"
		heading     = "Scudder VIT Real Est Sec Port"
		want        = "S000006222" // DWS RREEF Real Estate Securities VIP
		declared    = "Scudder Real Estate Securities Portfolio"
		control     = "Scudder VIT Equity 500 Index"
		controlWant = "S000006221"
		wantRows    = 5
		wantCtlRows = 2
	)

	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns_scudder_vit_realestsecport", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.CIK != "0001006373" || meta.PeriodOfReport != period {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}

	var under, ctl []VoteRow
	for _, r := range sink.buf {
		switch r.FundName {
		case heading:
			under = append(under, r)
		case control:
			ctl = append(ctl, r)
		}
	}

	// The control proves the chassis reads this vendor's banner grammar: same
	// filing, same layout, same VIT-prefix shape, already resolving today. If it
	// ever stops, the target's failure below is not about the abbreviation.
	if len(ctl) != wantCtlRows {
		t.Fatalf("control precondition: %d rows under %q, want %d (fixture emitted %d rows in total)",
			len(ctl), control, wantCtlRows, len(sink.buf))
	}
	for _, r := range ctl {
		if r.SeriesID != controlWant {
			t.Fatalf("control precondition: heading %q resolves to %q, want %q -- the VIT-prefix rung this test depends on has changed",
				control, r.SeriesID, controlWant)
		}
	}

	if len(under) != wantRows {
		t.Fatalf("fixture precondition: %d rows under %q, want %d (fixture emitted %d rows in total)",
			len(under), heading, wantRows, len(sink.buf))
	}
	for _, r := range under {
		if r.SeriesID != want {
			t.Errorf("heading %q (fund_name=%q): series=%q, want %q -- the filing's own cover page declares %q, this CIK's dictionary carries exactly one real-estate series (%s %q), and the banner is that name with `Securities Portfolio` abbreviated to `Sec Port`",
				heading, r.FundName, r.SeriesID, want, declared, want, "DWS RREEF Real Estate Securities VIP")
			break
		}
	}
}
