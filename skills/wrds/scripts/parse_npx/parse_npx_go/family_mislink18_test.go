package main

import (
	"os"
	"path/filepath"
	"testing"
)

// familyMislink18Parse runs the real layout parser -- parseLabelValue, the one
// the WHOLE filing dispatches to -- over a verbatim excerpt, with the named
// dictionary rows loaded (dict "" means no dictionary at all).
//
// The layout is called directly rather than through processFile for the reason
// TestFamilyYY2MLIGWrappedBanner and TestLabelValueWrappedYear already record:
// these filings reach labelvalue only because their ISS proposal-column header
// sits far past signatureHeadBytes (128 KB, text_parser.go:135), so matchISSNPX
// never sees it. Any excerpt short enough to be a fixture puts that header
// inside the window and would be claimed by issnpx instead -- issnpx's own
// plain-heading branch refuses both headings below, so an excerpt routed there
// reproduces nothing. The measured dispatch of each whole filing is quoted per
// test.
func familyMislink18Parse(t *testing.T, fixture, dict string, meta FilingMeta) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	if dict != "" {
		d, err := loadCIKSeries(filepath.Join("testdata", "family_mislink18", dict))
		if err != nil {
			t.Fatal(err)
		}
		cikDict = d
	}
	b, err := os.ReadFile(filepath.Join("testdata", "family_mislink18", fixture))
	if err != nil {
		t.Fatal(err)
	}
	rows, err := parseLabelValue(string(stripHTML(b)), meta)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		t.Fatal("fixture precondition: no rows parsed")
	}
	return rows
}

// familyMislink18BannerHolds asserts that every row of the excerpt carries the
// `=`-ruled banner the filing printed over the section, and that the issuer
// heading promoted over it keeps its own identity fields.
func familyMislink18BannerHolds(t *testing.T, rows []VoteRow, wantFund, wantSeries, promotedIssuer, promotedCUSIP string) {
	t.Helper()
	for i, r := range rows {
		if r.FundName != wantFund || r.SeriesID != wantSeries {
			t.Errorf("row %d (issuer=%q item=%q): fund_name=%q series_id=%q want %q / %q -- the enclosing `=`-ruled banner",
				i+1, r.IssuerName, r.ItemSeq, r.FundName, r.SeriesID, wantFund, wantSeries)
		}
	}
	var seen int
	for i, r := range rows {
		if r.CUSIP != promotedCUSIP {
			continue
		}
		seen++
		if r.IssuerName != promotedIssuer {
			t.Errorf("row %d (item=%q security id=%q): issuer_name=%q want %q -- the issuer line was consumed as a fund heading, so the block kept the PREVIOUS issuer's name",
				i+1, r.ItemSeq, r.CUSIP, r.IssuerName, promotedIssuer)
		}
	}
	if seen == 0 {
		t.Errorf("fixture precondition: no row carries security id %s (of %d rows)", promotedCUSIP, len(rows))
	}
}

// 000106/1066980/0000950123-11-081606.txt (VANTAGEPOINT FUNDS, CIK 1066980,
// period 20110630, layout labelvalue, 66,624 rows): verbatim source lines
// 61510-61512 (the fund banner and the two blanks under it) and 65180-65215
// (the rule that closes the 3M block, the whole ECOLAB INC. meeting, and the
// head of the EDISON INTERNATIONAL meeting).
//
// The section is opened at source line 61510 by
//
//	==================== THE VANTAGEPOINT 500 STOCK INDEX FUND =====================
//
// which resolves to the declared `Vantagepoint 500 Stock Index Fund`,
// S000008107 (source line 45-46). Every meeting under it is introduced by a
// bare, unruled, unlabelled ISSUER line above the `Ticker:`/`Security ID:`
// pairs -- source lines 65182 and 65205 verbatim:
//
//	ECOLAB INC.
//
//	Ticker:       ECL            Security ID:  278865100
//
//	EDISON INTERNATIONAL
//
//	Ticker:       EIX            Security ID:  281020107
//
// Nothing distinguishes the two lines. `EDISON INTERNATIONAL` is nonetheless
// taken as a FUND heading by layout_labelvalue.go, parseLabelValue, the
// bare-line branch at :437-455: the branch offers a lone cell to
// lvResolveBanner and adopts it as the fund whenever that answers. The comment
// there states the rule the branch means to enforce -- "only a heading the same
// rules the ruled banners go through answer EXACTLY is read this way, so an
// issuer never is" -- but lvResolveBanner is icrResolveFundShared, the whole
// fuzzy chain, not an exact match. `international` is the distinctive token of
// exactly one declared name, `Vantagepoint International Fund` (S000008133,
// source line 310-311), so the chain answers and the issuer becomes the fund.
//
// Measured on this filing (real dispatch, no dictionary), three issuer headings
// are promoted and each one takes the whole remainder of its section:
//
//	rows 4378-8794   n=4,417   EDISON INTERNATIONAL  S000008133  (section: THE VANTAGEPOINT 500 STOCK INDEX FUND, S000008107)
//	rows 14897-29472 n=14,576  EDISON INTERNATIONAL  S000008133  (section: THE VANTAGEPOINT BROAD MARKET INDEX FUND, S000008128)
//	rows 50705-59749 n=9,045   ESSILOR INTERNATIONAL S000008133  (section: THE VANTAGEPOINT OVERSEAS EQUITY INDEX FUND, S000008124)
//
// So this family DOES move rows across funds: 28,038 of the filing's 66,624
// rows carry S000008133, a fund that cast none of them. A wrong series is worse
// than a blank one.
//
// The promotion also costs the promoted meeting its own issuer. Because the
// line is consumed as a heading, `issuer` is never reassigned, and EDISON's
// votes come out under the PREVIOUS issuer's name with EDISON's own security id
// -- the first row of the 4,417-row run reads issuer `ECOLAB INC.` with
// Security ID 281020107.
//
// Recommended fix, layout_labelvalue.go, parseLabelValue, :437-455: a lone cell
// standing where this grammar prints its ISSUER heading -- directly above a
// blank and a `Ticker:`/`Security ID:`/`Meeting Date:` identity block -- is an
// issuer, and must not be offered to lvResolveBanner at all. Only a lone cell
// with no identity block under it is a heading candidate (which is the Pacific
// Select shape the branch was written for). Resolution is not evidence of
// heading-hood; position is.
func TestFamilyMislink18VantagepointIssuerPromotedToFund(t *testing.T) {
	meta := FilingMeta{
		CIK:         "0001066980",
		CompanyName: "VANTAGEPOINT FUNDS",
		SeriesDecls: []SeriesDecl{
			{SeriesID: "S000008107", Name: "Vantagepoint 500 Stock Index Fund"},
			{SeriesID: "S000008108", Name: "Vantagepoint Mid/Small Company Index Fund"},
			{SeriesID: "S000008124", Name: "Vantagepoint Overseas Equity Index Fund"},
			{SeriesID: "S000008125", Name: "Vantagepoint Low Duration Bond Fund"},
			{SeriesID: "S000008128", Name: "Vantagepoint Broad Market Index Fund"},
			{SeriesID: "S000008130", Name: "Vantagepoint Equity Income Fund"},
			{SeriesID: "S000008131", Name: "Vantagepoint Growth & Income Fund"},
			{SeriesID: "S000008132", Name: "Vantagepoint Growth Fund"},
			{SeriesID: "S000008133", Name: "Vantagepoint International Fund"},
			{SeriesID: "S000020941", Name: "Vantagepoint Select Value Fund"},
			{SeriesID: "S000020942", Name: "Vantagepoint Discovery Fund"},
		},
	}
	rows := familyMislink18Parse(t, "vantagepoint2011_edison_international.txt", "", meta)
	familyMislink18BannerHolds(t, rows,
		"THE VANTAGEPOINT 500 STOCK INDEX FUND", "S000008107",
		"EDISON INTERNATIONAL", "281020107")
}

// 000091/914036/0001193125-17-265188.txt (LINCOLN VARIABLE INSURANCE PRODUCTS
// TRUST, CIK 914036, period 20170630, layout labelvalue, 17,672 rows): verbatim
// source lines 38331-38350 (the fund banner and the head of the ADO PROPERTIES
// S.A. special meeting) and 38393-38412 (the tail of ADO's annual meeting, the
// rule, and the head of the ALEXANDRIA REAL ESTATE EQUITIES, INC. meeting).
//
// Same grammar, same branch, and here the promoting evidence is the
// registrant's DICTIONARY rather than its declared names, which is why the
// fixture ships `lvip_dict.tsv` (the 311 cik_series rows of CIK 914036; the
// four that carry `Real Estate` are S000016761 at four vintages, among them
// `LVIP Clarion Global Real Estate Fund` and `LVIP BlackRock Real Estate
// Fund`). Source line 38331 opens the section:
//
//	===================== LVIP Clarion Global Real Estate Fund =====================
//
// and source line 38399 is an ordinary issuer heading of that section:
//
//	ALEXANDRIA REAL ESTATE EQUITIES, INC.
//
// Measured on this filing (real dispatch, dictionary loaded), three REIT issuer
// names are promoted inside the S000016761 section:
//
//	rows 18-50     n=33   ALEXANDRIA REAL ESTATE EQUITIES, INC.
//	rows 51-635    n=585  ASCENDAS REAL ESTATE INVESTMENT TRUST
//	rows 636-1090  n=455  LINK REAL ESTATE INVESTMENT TRUST
//
// 1,073 rows of the filing carry an issuer name in fund_name. Unlike the
// Vantagepoint case the SERIES does not move: every promoted heading resolves
// to S000016761, which is the enclosing section's own id, so the harm here is
// the fund_name column and the block boundary rather than a wrong link key.
// The boundary harm is the same: ALEXANDRIA's own 12 votes come out under
// issuer `ADO PROPERTIES S.A.` with Security ID 015271109.
//
// The sibling filings of this registrant flagged by the detector --
// 0001193125-14-316680.txt (BOARDWALK / RIOCAN / SUNTEC / THE LINK, 8,967
// rows), 0001193125-15-297287.txt (1,031) and 0001193125-18-263082.txt (5,161,
// seven names) -- are the same shape.
//
// Same fix location: layout_labelvalue.go, parseLabelValue, :437-455.
func TestFamilyMislink18LincolnIssuerPromotedToFund(t *testing.T) {
	meta := FilingMeta{
		CIK:            "0000914036",
		CompanyName:    "LINCOLN VARIABLE INSURANCE PRODUCTS TRUST",
		PeriodOfReport: "20170630",
		SeriesDecls: []SeriesDecl{
			{SeriesID: "S000002803", Name: "LVIP Mondrian International Value Fund"},
			{SeriesID: "S000002812", Name: "LVIP Delaware Bond Fund"},
			{SeriesID: "S000015969", Name: "LVIP Wellington Capital Growth Fund"},
			{SeriesID: "S000015971", Name: "LVIP MFS Value Fund"},
			{SeriesID: "S000015973", Name: "LVIP Wellington Mid-Cap Value Fund"},
			{SeriesID: "S000016761", Name: "LVIP Clarion Global Real Estate Fund"},
			{SeriesID: "S000025309", Name: "LVIP Global Income Fund"},
		},
	}
	rows := familyMislink18Parse(t, "lvip2017_alexandria_real_estate.txt", "lvip_dict.tsv", meta)
	familyMislink18BannerHolds(t, rows,
		"LVIP Clarion Global Real Estate Fund", "S000016761",
		"ALEXANDRIA REAL ESTATE EQUITIES, INC.", "015271109")
}
