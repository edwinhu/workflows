package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 000106/1066980/0000950123-09-039075.txt (VANTAGEPOINT FUNDS, CIK 1066980,
// period 20090630, layout issnpx, 56,772 rows): verbatim source lines
// 35057-35075 (the SELECT VALUE FUND page heading, its `=====` banner and the
// head of the ACUITY BRANDS meeting) and 45813-45841 (the INTERNATIONAL FUND
// page heading, its ICA/period identity block, the banner under it and the
// head of the ACCOR meeting). Every byte is a line-range cut of the source;
// nothing is added.
//
// THE SHAPE. Each sub-adviser's report opens with a `<PAGE>` break, a centred
// page heading naming the fund, the sub-adviser, and then a `=====` banner.
// Source lines 45813-45828, verbatim between the `|` markers, which stand at
// column 0:
//
// |<PAGE>
// |
// |                              VOTE SUMMARY REPORT
// |                  FOR THE PERIOD JULY 1, 2008 - JUNE 30, 2009
// |                        VANTAGEPOINT INTERNATIONAL FUND
// |                          SUBADVISER: ARTISAN PARTNERS
// |
// |        (four blank lines)
// |
// |ICA File Number: 811-08941
// |Reporting Period: 07/01/2008 - 06/30/2009
// |The VantagePoint Funds
// |
// |
// |============================ THE VANTAGEPOINT FUNDS ============================
//
// The banner carries the REGISTRANT's name, not a fund's, so it resolves to
// nothing. The page heading above it carries the fund: `VANTAGEPOINT
// INTERNATIONAL FUND` is this filing's own declaration verbatim -- source
// lines 290-291 of the header declare `<SERIES-ID>S000008133` /
// `<SERIES-NAME>Vantagepoint International Fund` -- and the corpus dictionary
// carries the same name for this CIK (`0001066980 S000008133 Vantagepoint
// International Fund 20060630`). The control section in this fixture prints the
// same stack over a banner that DOES name a fund (`THE VANTAGEPOINT SELECT
// VALUE FUNDS`, S000020941), and it resolves today.
//
// WHERE IT FALLS THROUGH, in layout_issnpx.go, parseISSNPX. The page heading is
// never read as a heading at all: the bare-paragraph branch at :644-673 is the
// only path that would answer `VANTAGEPOINT INTERNATIONAL FUND` out of
// issPlainHeadingSeries, and it requires the NEXT line to be blank
// (`strings.TrimSpace(lines[i+1]) == ""`), while this vendor prints
// `SUBADVISER: ARTISAN PARTNERS` directly under the heading. The ruled banner
// two lines below is therefore the only boundary the loop sees, and
// commitBanner at :509-569 then sets `fund` and clears `fundSeries`
// unconditionally from it: issResolveFund answers nothing for the registrant's
// own name, `plain` is false because the banner is ruled, and issBrandCutStem
// leaves no stem, so the section runs to the next `<PAGE>` heading with a blank
// series and the bare registrant name in the fund_name column.
//
// This is commit 13467611 ('family NS-1066980-international-registrant-banner')
// read through the OTHER layout. That fix taught parseLabelValue, for the same
// registrant and the same INTERNATIONAL FUND section in the 2014-2016 filings,
// that a banner resolving to nothing must not erase a series a page heading
// above it already resolved. parseISSNPX has the analogous banner-commit logic
// and not the guard.
//
// ROWS REACHED, measured through the real dispatch on the whole filings with
// -cik-series and -series-map both applied (binary built from HEAD 69a773b7;
// layout=issnpx, status=ok, 56,772 rows on both):
//
//	0000950123-09-039075  1,733 blank = 1,143 under this banner (fund_name `THE VANTAGEPOINT FUNDS`)
//	                                  +   590 under `VANTAGEPOINT OPPORTUNITY FUND - TIMESSQUARE CAPITAL`, a different grammar and not this family
//	0000950123-09-039251  1,733 blank = 1,143 under this banner (the N-PX/A twin of the same period, byte-identical in this section)
//	                                  +   590 under the same TimesSquare banner
//
// The registrant banner appears exactly ONCE in each filing (source line 45828),
// so all 1,143 blank rows of that fund_name are this one section. The other ten
// ruled banners in the filing each name a fund and resolve.
func TestFamilyNS1066980cISSNPXRegistrantBanner(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	// The filing's own 30 declarations, verbatim from source lines 55-371. No
	// dictionary and no overlay is loaded: the filing's own header is the whole
	// of the evidence, and the sibling `Growth`, `Growth & Income` and
	// `Overseas Equity Index` names are kept so that the match the heading
	// relies on is tested against the real field of candidates.
	meta := FilingMeta{
		CIK:            "0001066980",
		CompanyName:    "VANTAGEPOINT FUNDS",
		PeriodOfReport: "20090630",
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
			{SeriesID: "S000008117", Name: "Vantagepoint Model Portfolio All-Equity Growth Fund"},
			{SeriesID: "S000008118", Name: "Vantagepoint Aggressive Opportunities Fund"},
			{SeriesID: "S000008119", Name: "Vantagepoint Model Portfolio Conservative Growth Fund"},
			{SeriesID: "S000008120", Name: "Vantagepoint Model Portfolio Long-Term Growth Fund"},
			{SeriesID: "S000008121", Name: "Vantagepoint Model Portfolio Savings Oriented Fund"},
			{SeriesID: "S000008122", Name: "Vantagepoint Model Portfolio Traditional Growth Fund"},
			{SeriesID: "S000008123", Name: "Vantagepoint Money Market Fund"},
			{SeriesID: "S000008124", Name: "Vantagepoint Overseas Equity Index Fund"},
			{SeriesID: "S000008125", Name: "Vantagepoint Low Duration Bond Fund"},
			{SeriesID: "S000008126", Name: "Vantagepoint Inflation Protected Securities Fund"},
			{SeriesID: "S000008127", Name: "Vantagepoint Asset Allocation Fund"},
			{SeriesID: "S000008128", Name: "Vantagepoint Broad Market Index Fund"},
			{SeriesID: "S000008129", Name: "Vantagepoint Core Bond Index Fund"},
			{SeriesID: "S000008130", Name: "Vantagepoint Equity Income Fund"},
			{SeriesID: "S000008131", Name: "Vantagepoint Growth & Income Fund"},
			{SeriesID: "S000008132", Name: "Vantagepoint Growth Fund"},
			{SeriesID: "S000008133", Name: "Vantagepoint International Fund"},
			{SeriesID: "S000020941", Name: "Vantagepoint Select Value Fund"},
			{SeriesID: "S000020942", Name: "Vantagepoint Discovery Fund"},
			{SeriesID: "S000020943", Name: "Vantagepoint Diversified Assets Fund"},
		},
	}

	dir := filepath.Join("testdata", "family_ns_1066980c_issnpx_registrant_banner")
	b, err := os.ReadFile(filepath.Join(dir, "vantagepoint2009_issnpx_registrant_banner.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows, err := parseISSNPX(string(stripHTML(b)), meta)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 4 {
		t.Fatalf("fixture precondition: %d rows, want 4 (two of ACUITY BRANDS, INC., two of ACCOR)", len(rows))
	}

	for _, r := range rows {
		switch r.IssuerName {
		case "ACUITY BRANDS, INC.":
			// The control section, whose banner names a declared fund. It
			// guards the fixture: if this ever goes blank the cut is broken,
			// not the grammar.
			if r.SeriesID != "S000020941" {
				t.Fatalf("fixture guard: the `===== THE VANTAGEPOINT SELECT VALUE FUNDS =====` section stopped resolving: item=%q series=%q fund=%q", r.ItemSeq, r.SeriesID, r.FundName)
			}
		case "ACCOR":
			if r.SeriesID != "S000008133" {
				t.Errorf("a `=====` banner carrying the REGISTRANT's own name erased the series the page heading above it names: item=%q series=%q fund=%q; want series S000008133 and the fund named at source line 45817, `VANTAGEPOINT INTERNATIONAL FUND`, which this filing declares verbatim at source lines 290-291",
					r.ItemSeq, r.SeriesID, r.FundName)
			}
		default:
			t.Fatalf("fixture guard: unexpected issuer %q", r.IssuerName)
		}
	}
}
