package main

import (
	"path/filepath"
	"testing"
)

// familyNS4Dispatch runs the real dispatch on a family NS4 fixture, loading the
// registrant's own cik_series.tsv rows as the dictionary when one is named. The
// ProxyEdge-era filings of this family declare NO series in the SGML header, so
// the dictionary is the only index a fund heading can resolve against; the 2021
// AST filing declares its own and names no dictionary.
func familyNS4Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns4", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns4", fixture), sink, make([]byte, headBytes))
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

// 000081/814679/0001683863-21-004730.txt: 11-20, 53-63, 235-243, 731-743,
// 262981-262997. Advanced Series Trust, 2021, layout `issnpx`. 14,521 of this
// filing's 252,355 rows carry no series, and the whole mass of them is one
// banner shape, verbatim (lines 262981-262983 and 279464-279466):
//
//	=========   AST JP Morgan Tactical Preservation Portfolio (FKA AST    ==========
//	========= Goldman Sachs Multi Asset Portfolio) - Subadviser: Goldman  ==========
//	=========                Sachs Asset Management, L.P.                 ==========
//
// The layout joins the three centred lines correctly; the emitted fund_name is
// exactly `AST JP Morgan Tactical Preservation Portfolio (FKA AST Goldman Sachs
// Multi Asset Portfolio) - Subadviser: Goldman Sachs Asset Management, L.P.`
// and it resolves to nothing. The header declares the fund, verbatim (237-238):
//
//	<SERIES-ID>S000002009
//	<SERIES-NAME>AST J.P. MORGAN TACTICAL PRESERVATION PORTFOLIO
//
// and with the FKA parenthetical removed the SAME chain the layout already
// calls returns it -- measured on this filing's own index:
//
//	"AST JP Morgan Tactical Preservation Portfolio (FKA ...) - Subadviser: ..."  -> ""
//	"AST JP Morgan Tactical Preservation Portfolio - Subadviser: J.P. Morgan..." -> S000002009
//	"AST JP Morgan Tactical Preservation Portfolio"                              -> S000002009
//
// The chain ALREADY carries a trailing-parenthetical rung. This parenthetical is
// MEDIAL -- the sub-adviser dash clause follows it -- so that rung never sees it.
//
// Rows reached: 7,861 (`FKA AST JP Morgan Strategic Opportunities Portfolio`)
// plus 6,134 (`FKA AST Goldman Sachs Multi Asset Portfolio`) = 13,995 of the
// filing's 14,521 pool rows; the remaining 526 are the triple-parenthetical
// `AST Franklin 85/15 Diversified Allocation Portfolio (Large Cap Growth) (FKA
// AST Legg Mason Diversified Growth Portfolio) (Aggressive Growth Sleeve) -
// Subadviser: Clearbridge Investments, LLC`, whose base name is declared EXACTLY
// (S000045123) and which the same cut reaches.
//
// Fix in layout_issnpx.go, issResolveFundUncached: the existing `lessParen` /
// trailing-parenthetical rung must be generalised to a parenthetical anywhere in
// the banner -- cut one balanced `(...)` group and re-resolve, accepting only an
// exact declared hit on the remainder so a cut that creates an ambiguity still
// refuses.
func TestFamilyNS4ASTFKAParentheticalRefusesTheDeclaredPortfolio(t *testing.T) {
	rows := familyNS4Dispatch(t, "ast_fka_parenthetical_banner.txt", "", "issnpx", 4)
	for _, r := range rows {
		if r.SeriesID != "S000002009" {
			t.Errorf("a medial (FKA ...) parenthetical refused the declared portfolio: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000002009", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000081/810573/0000088053-05-000968.txt: 11-27, 61-68, 15401-15424. Scudder
// Variable Series II, 2005, layout `splittable` (the dispatcher does NOT skip
// this filing on binary 213 -- it parses ok and emits 18,099 rows, 14,544 of
// them with no series).
//
// The header declares NO series (`grep -c SERIES-ID` = 0), so cikDict.back puts
// the registrant's whole dictionary in. The ProxyEdge report names the account
// on one line, verbatim (line 15404):
//
//	Selected Accounts: SVS II Scudder Large Cap Value Portfolio
//
// and the layout reads it correctly -- the emitted fund_name is exactly that.
// The census of the filing's blank rows is two headings:
//
//	13457 "SVS II Scudder Large Cap Value Portfolio"
//	 1087 "SVS II Oak"
//
// while `SVS II Scudder Aggressive Growth Portfolio` in the same filing DOES
// resolve (3,555 rows, S000006259). The banner prints the registrant's initials
// AND its leading word -- `SVS II` + `Scudder`, for a registrant named SCUDDER
// VARIABLE SERIES II -- and only one of the two is stripped. Measured on this
// filing's own index through icrResolveFundShared:
//
//	"SVS II Scudder Large Cap Value Portfolio" -> ""
//	"SVS II Oak Strategic Equity Portfolio"    -> S000006273   (initials only)
//	"SVS II Large Cap Value"                   -> S000006255
//	"Scudder Large Cap Value"                  -> S000006255
//	"Large Cap Value"                          -> S000006255
//
// so the brand strip reaches a one-token registrant run or the `Portfolio` type
// token, but not a two-part run plus the type token in the same banner. The
// dictionary spells the fund `DWS Large Cap Value VIP` (S000006255) -- the
// Scudder-to-DWS rename is already bridged by the brand/type rungs; what is
// missing is the banner-side strip.
//
// Rows reached: 13,457 in this filing. (The 1,087-row `SVS II Oak` heading is a
// TRUNCATION of `SVS II Oak Strategic Equity Portfolio`, which resolves -- a
// separate splittable defect, not asserted here.)
//
// Fix in layout_issnpx.go, issResolveFundUncached's registrant-prefix strip (the
// rung guarded by -issnpx-registrant-prefix-strip, reached from splittable via
// icrResolveFundShared): the strip must consume a leading run built from the
// registrant's INITIALS AND its tokens interleaved, not either alone, and must
// still re-resolve through the type-token rung afterwards.
func TestFamilyNS4ScudderInitialsPlusBrandRunRefusesTheAccountName(t *testing.T) {
	rows := familyNS4Dispatch(t, "svs_brand_run_account.txt", "svs_dict.tsv", "splittable", 1)
	for _, r := range rows {
		if r.SeriesID != "S000006255" {
			t.Errorf("an initials-plus-brand run refused the account name: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000006255", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
