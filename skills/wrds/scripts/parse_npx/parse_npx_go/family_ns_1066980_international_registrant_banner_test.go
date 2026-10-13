package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 000106/1066980/0001193125-15-304087.txt (VANTAGEPOINT FUNDS, CIK 1066980,
// period 20150630, layout labelvalue, 59,923 rows): verbatim source lines
// 67407-67423 (the SELECT VALUE FUNDS page heading, its `=====` banner and the
// head of the ALLEGHANY CORPORATION meeting), 105311-105314 (the tail of the
// Discovery Fund vendor table and its `</TABLE>`, the bytes that really stand
// between the two sections) and 105315-105347 (the INTERNATIONAL FUND page
// heading, its embedded `FORM N-Px REPORT` block, the banner under it and the
// head of the ACTELION LTD. meeting). Every byte is a line-range cut of the
// source; nothing is added.
//
// The layout is called directly rather than through processFile for the reason
// familyMislink18Parse already records: these filings reach labelvalue only
// because their ISS proposal-column header sits far past signatureHeadBytes
// (128 KB, text_parser.go:135), so matchISSNPX never sees it. An excerpt short
// enough to be a fixture puts both that header and the literal `FORM N-Px
// REPORT` inside the window, and issnpx claims it instead. Measured through
// processFile on a variant of this excerpt carrying the filing's own SEC
// header: status=ok, layout=issnpx, the same four rows, and issnpx resolves
// BOTH sections (S000020941 and S000008133). An excerpt routed there
// reproduces nothing.
//
// THE SHAPE. Each sub-adviser's report opens with a `<PAGE>` break, a bare
// centred page heading naming the fund with the registrant's own prefix
// dropped, the sub-adviser, and then a `=====` banner. Source lines
// 105315-105335, verbatim between the `|` markers, which stand at column 0:
//
// |<PAGE>
// |
// |                               INTERNATIONAL FUND
// |
// |ARTISAN PARTNERS LIMITED PARTNERSHIP
// |
// |******************************* FORM N-Px REPORT *******************************
// |
// |ICA File Number: 811-08941
// |Reporting Period: 07/01/2014 - 06/30/2015
// |The VantagePoint Funds
// |
// |        (eight blank lines)
// |
// |============================ The VantagePoint Funds ============================
//
// The banner carries the REGISTRANT's name, not a fund's, so it resolves to
// nothing. The page heading above it carries the fund: `INTERNATIONAL FUND` is
// answered S000008133 by icrResolveFundShared out of the filing's own
// `<SERIES-NAME>Vantagepoint International Fund` (source lines 415-416) --
// measured, with no dictionary and no overlay loaded. The control section in
// this fixture prints the same stack over a banner that DOES name a fund
// (`The VantagePoint Select Value Funds`, S000020941), and it resolves today.
//
// WHERE IT FALLS THROUGH, in layout_labelvalue.go, parseLabelValue. The
// bare-line branch at :463-486 already reads the page heading and already sets
// `fund` and `curSeries` from it -- deleting ONLY the banner line from this
// fixture yields fund `INTERNATIONAL FUND` / series S000008133 on both rows.
// The banner branch at :268-320 then overwrites `curSeries` unconditionally
// with `lvResolveBanner(name)`, which is "" for the registrant's own name, and
// the section goes out blank. The branch already has the fallback this case
// needs, at :313-315 -- `if curSeries == "" { curSeries = fundCue }` -- but
// `fundCue` is written only by the `FUND:` cue line at :325-327, so a heading
// recorded through the bare-line branch leaves it empty and there is nothing to
// restore. No new resolution rung is required: the shared chain already answers
// the name.
//
// This is the DICT-OVERRIDE rule (HEAD, `339d6bf7`) read the other way round: a
// banner that resolves to nothing must not erase a series the filing's own
// bytes, a few lines above, already resolved.
//
// ROWS REACHED, measured through the real dispatch on the whole filings with
// -series-map and -cik-series both applied (parse_npx_go built from HEAD
// a59eff4e; layout=labelvalue on all three):
//
//	0001193125-14-324748  2,587 blank = 2,584 under this banner (heading `INTERNATIONAL FUND`, source line 92216; banner 92234)
//	                                  +     3 under `WALTER SCOTT & PARTNERS LIMITED`, a different grammar and not this family
//	0001193125-15-304087  1,064 blank = 1,064 under this banner (heading source line 105317; banner 105335)
//	0001193125-16-694812  1,922 blank =   961 under this banner (heading `Select Value Fund`, source line 87863; banner 87881)
//	                                  +   961 under this banner (heading `International Fund`, source line 124357; banner 124375)
//
// 5,569 of the 5,573 blank rows across the three filings are this shape. The
// 2016 filing shows the heading in mixed case and shows the same registrant
// banner opening two DIFFERENT funds' sections, which is why the heading and
// not the banner has to be the evidence.
//
// NOT the shape this family was first reported as. The banner
// `============= VantagePoint Opportunity Fund - TimesSquare Capital ==============`
// (source line 91894 here, 66704 and 100110 in the sibling filings) resolves on
// HEAD: measured, it carries S000008118 on 707 rows here, 726 in 2014 and 754
// in 2016, and none of them is blank.
func TestFamilyNS1066980RegistrantBannerErasesPageHeadingSeries(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	// The filing's own 30 declarations, verbatim from source lines 43-508. No
	// dictionary and no overlay is loaded: the filing's own header is the whole
	// of the evidence, and the sibling `Growth`, `Growth & Income` and
	// `Model Portfolio ... Growth` names are kept so that the suffix match the
	// heading relies on is tested against the real field of candidates.
	meta := FilingMeta{
		CIK:            "0001066980",
		CompanyName:    "VANTAGEPOINT FUNDS",
		PeriodOfReport: "20150630",
		SeriesDecls: []SeriesDecl{
			{SeriesID: "S000008107", Name: "Vantagepoint 500 Stock Index Fund"},
			{SeriesID: "S000008108", Name: "Vantagepoint Mid/Small Company Index Fund"},
			{SeriesID: "S000008109", Name: "Vantagepoint Milestone 2010 Fund"},
			{SeriesID: "S000008110", Name: "Vantagepoint Milestone 2015 Fund"},
			{SeriesID: "S000008111", Name: "Vantagepoint Milestone 2020 Fund"},
			{SeriesID: "S000008112", Name: "Vantagepoint Milestone 2025 Fund"},
			{SeriesID: "S000008113", Name: "Vantagepoint Milestone 2030 Fund"},
			{SeriesID: "S000008114", Name: "Vantagepoint Milestone 2035 Fund"},
			{SeriesID: "S000008115", Name: "Vantagepoint Milestone 2040 Fund"},
			{SeriesID: "S000008116", Name: "Vantagepoint Milestone Retirement Income Fund"},
			{SeriesID: "S000008117", Name: "Vantagepoint Model Portfolio Global Equity Growth Fund"},
			{SeriesID: "S000008118", Name: "Vantagepoint Aggressive Opportunities Fund"},
			{SeriesID: "S000008119", Name: "Vantagepoint Model Portfolio Conservative Growth Fund"},
			{SeriesID: "S000008120", Name: "Vantagepoint Model Portfolio Long-Term Growth Fund"},
			{SeriesID: "S000008122", Name: "Vantagepoint Model Portfolio Traditional Growth Fund"},
			{SeriesID: "S000008124", Name: "Vantagepoint Overseas Equity Index Fund"},
			{SeriesID: "S000008125", Name: "Vantagepoint Low Duration Bond Fund"},
			{SeriesID: "S000008126", Name: "Vantagepoint Inflation Focused Fund"},
			{SeriesID: "S000008128", Name: "Vantagepoint Broad Market Index Fund"},
			{SeriesID: "S000008129", Name: "Vantagepoint Core Bond Index Fund"},
			{SeriesID: "S000008130", Name: "Vantagepoint Equity Income Fund"},
			{SeriesID: "S000008131", Name: "Vantagepoint Growth & Income Fund"},
			{SeriesID: "S000008132", Name: "Vantagepoint Growth Fund"},
			{SeriesID: "S000008133", Name: "Vantagepoint International Fund"},
			{SeriesID: "S000020941", Name: "Vantagepoint Select Value Fund"},
			{SeriesID: "S000020942", Name: "Vantagepoint Discovery Fund"},
			{SeriesID: "S000020943", Name: "Vantagepoint Diversifying Strategies Fund"},
			{SeriesID: "S000027311", Name: "Vantagepoint Milestone 2045 Fund"},
			{SeriesID: "S000038249", Name: "Vantagepoint Milestone 2050 Fund"},
			{SeriesID: "S000045351", Name: "Vantagepoint High Yield Fund"},
		},
	}

	dir := filepath.Join("testdata", "family_ns_1066980_international_registrant_banner")
	b, err := os.ReadFile(filepath.Join(dir, "vantagepoint2015_international_registrant_banner.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows, err := parseLabelValue(string(stripHTML(b)), meta)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 4 {
		t.Fatalf("fixture precondition: %d rows, want 4 (two of ALLEGHANY CORPORATION, two of ACTELION LTD.)", len(rows))
	}

	for _, r := range rows {
		switch r.IssuerName {
		case "ALLEGHANY CORPORATION":
			// The control section, whose banner names a declared fund. It
			// guards the fixture: if this ever goes blank the cut is broken,
			// not the grammar.
			if r.SeriesID != "S000020941" {
				t.Fatalf("fixture guard: the `===== The VantagePoint Select Value Funds =====` section stopped resolving: item=%q series=%q fund=%q", r.ItemSeq, r.SeriesID, r.FundName)
			}
		case "ACTELION LTD.":
			if r.SeriesID != "S000008133" {
				t.Errorf("a `=====` banner carrying the REGISTRANT's own name erased the series the page heading above it resolved: item=%q series=%q fund=%q; want series S000008133 and the fund named at source line 105317, `INTERNATIONAL FUND`, which this filing declares as `Vantagepoint International Fund` at source lines 415-416",
					r.ItemSeq, r.SeriesID, r.FundName)
			}
		default:
			t.Fatalf("fixture guard: unexpected issuer %q", r.IssuerName)
		}
	}
}
