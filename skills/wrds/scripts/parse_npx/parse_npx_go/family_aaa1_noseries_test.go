package main

import (
	"path/filepath"
	"testing"
)

// familyAAADispatch runs the real dispatch on a family AAA no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary.
func familyAAADispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_aaa1", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_aaa1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000120/1208252/0001111830-09-000754.txt: 14-26, 55-83, 232-256. CM Advisers
// Family of Funds' 2009 N-PX declares TWO series in its SGML header
// (S000010533 CM Advisers Fund, S000010534 CM Advisers Fixed Income Fund), so
// the chassis' single-series stamp never fires. Broadridge repeats the fund's
// name at column 0 once per page, immediately ABOVE the dashed rule that opens
// the issuer block (43 occurrences in the real filing):
//
//	                                                                                     Page 1 of 64
//	CM ADVISORS FUND
//	- --------------------------------------------------------------------------------
//	  3M COMPANY
//	- --------------------------------------------------------------------------------
//	       SECURITY:      88579Y101                                                 AGENDA NUMBER:         933025985
//
// parseBroadridge reads its heading slot relative to the block opener, which
// lands on the ISSUER two lines above it; the page banner one rule further up
// is never offered to issResolveFund. All 494 rows of the filing carry the
// issuer as fund_name and a blank series. The banner spells `ADVISORS` where
// the header spells `Advisers`, and the dictionary carries both for
// S000010533.
func TestFamilyAAA1CMAdvisorsPageBanner(t *testing.T) {
	rows := familyAAADispatch(t, "cm_advisors_page_banner.txt", "cm_dict.tsv", "broadridge", 3)
	for _, r := range rows {
		if r.SeriesID != "S000010533" {
			t.Errorf("CM Advisors Fund page banner: fund=%q issuer=%q item=%q series=%q want S000010533", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000031/315774/0001275125-04-000299.txt: 14-26, 62-68, 111-148. Forum Funds'
// 2004 N-PX declares no series at all and is backed by the dictionary, which
// carries 76 names for CIK 315774. The filing DOES print a fund heading for
// each of its portfolios, bare at column 0, one blank line above the issuer
// that opens the section (17 such headings, every one of them a dictionary
// name):
//
//	AUSTIN GLOBAL EQUITY FUND
//
//	ABN AMRO HOLDING NV
//	<TABLE>
//	<S>       <C>         <C>                                                       <C>                           <C>
//	          CUSIP/CINS: N0030P459                                                                 MEETING TYPE: AGM
//
// No rule stands over or under the heading and the block opener is the
// `CUSIP/CINS:` line inside a <TABLE>, so none of parseBroadridge's heading
// slots reach lines[i-2] of the issuer. All 500 rows of the filing carry a
// blank fund_name and a blank series. `Austin Global Equity Fund` is
// S000004566 in the dictionary, spelled exactly as the heading prints it.
func TestFamilyAAA1ForumBareFundHeading(t *testing.T) {
	rows := familyAAADispatch(t, "forum_bare_fund_heading.txt", "forum_dict.tsv", "broadridge", 2)
	for _, r := range rows {
		if r.SeriesID != "S000004566" {
			t.Errorf("Austin Global Equity Fund: fund=%q issuer=%q item=%q series=%q want S000004566", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000100/1004655/0000932471-04-000909.txt: 14-26, 60-68, 95-97, 9775-9812.
// Vanguard Whitehall Funds' 2004 N-PX is a single-fund filing whose cover
// block names the fund in the column-gap form parseVanguard reads:
//
//	Fund             VANGUARD INTERNATIONAL EXPLORER FUND
//
// That resolves to S000004407 and stamps the rows above. 9,000 lines later a
// WRAPPED PROPOSAL LINE begins with the same word at column 0:
//
//	FOR AND ON BEHALF OF THE TERRA FIRMA CAPITAL PARTNERS II
//	FUND   OR AS NOVATED TO SUCH OTHER COMPANY FORMED AT THE
//	DIRECTION OF TERRA FIRMA  SUBJECT AND PURSUANT TO THE
//
// vanguardFundLabel (layout_vanguard.go:733) accepts `FUND  ` plus anything
// without a colon, so the continuation is read as a new fund banner. The
// branch at layout_vanguard.go:251 then flushes and sets fund/fundSeries
// unconditionally, clearing the series even though the slot resolves to
// nothing. Every row after that line -- 522 of the filing's 2,457 -- carries
// `OR AS NOVATED TO SUCH OTHER COMPANY FORMED AT THE` as fund_name and a blank
// series.
func TestFamilyAAA1VanguardNovatedProseFund(t *testing.T) {
	rows := familyAAADispatch(t, "vanguard_novated_prose_fund.txt", "vg_dict.tsv", "vanguard", 5)
	for _, r := range rows {
		if r.SeriesID != "S000004407" {
			t.Errorf("prose line read as a fund banner: fund=%q issuer=%q item=%q series=%q want S000004407", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000089/896435/0000950129-05-008709.txt: 14-26, 55-61, 44551-44568. AIM
// Variable Insurance Funds' 2005 N-PX declares no series and is backed by the
// dictionary's 124 names for CIK 896435. Every section carries an equals-rule
// heading and 23 of them resolve; this one does not:
//
//	========================== AIM V.I. TOTAL RETURN FUND ==========================
//
//	AIR PRODUCTS & CHEMICALS, INC.
//
//	Ticker:       APD            Security ID:  009158106
//
// The dictionary's ONLY name for S000000197 is `INVESCO VIF - Total Return
// Fund`: the registrant's later brand spelling, where this filing prints the
// contemporaneous `AIM V.I.` prefix its 23 resolving siblings also use. The
// stem `Total Return Fund` is unique among this CIK's series (the one other
// Total Return name is `Total Return Bond Fund`, S000064655), so the brand
// prefix is the whole of the difference. 707 rows leave series_id blank.
func TestFamilyAAA1AIMVITotalReturnBrandPrefix(t *testing.T) {
	rows := familyAAADispatch(t, "aim_vi_total_return.txt", "aim_dict.tsv", "issnpx", 5)
	for _, r := range rows {
		if r.SeriesID != "S000000197" {
			t.Errorf("AIM V.I. Total Return Fund: fund=%q issuer=%q item=%q series=%q want S000000197", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
