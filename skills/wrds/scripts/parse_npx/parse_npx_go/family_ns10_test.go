package main

import (
	"path/filepath"
	"testing"
)

// familyNS10Dispatch runs the real dispatch on a family NS10 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS10Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns10", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns10", fixture), sink, make([]byte, headBytes))
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

// 000110/1109957/0001104659-20-083781.txt: 1-20, 39-44, 70-74, 190-204,
// 9726-9727, 9734-9760, 9784-9812 and the filing's own last five lines.
// Dispatches to `proxyedge` (the precondition asserts it).
//
// Cullen Funds Trust, 2020. 2,989 of 3,738 rows carry no series, and every one
// of them names an ISSUER, not a fund: the emitted fund_name is
// `ASCENDAS REAL ESTATE INVESTMENT TRUST`. The vendor prints the fund above its
// ballots (source line 9727 verbatim)
//
//	<P STYLE="font: 10pt Times New Roman, Times, Serif; margin: 0pt 0"><B>Cullen International High Dividend Fund</B></P>
//
// and the issuer in the ballot's own header band (source line 9737 verbatim):
//
//	<TD COLSPAN="9" STYLE="color: white; font-weight: bold; ...">ASCENDAS REAL ESTATE INVESTMENT TRUST</TD>
//
// peFundName (layout_proxyedge.go:221) calls a heading a fund when it contains
// " FUND", " PORTFOLIO", " TRUST", " ETF" or " SERIES", so an issuer whose own
// name ends in TRUST is taken for a fund and overwrites the real one -- and
// every ballot after it carries the issuer as its fund, with no series. The
// filing's FIRST section is stamped from the identical grammar
// (Cullen High Dividend Equity Fund => S000006835, 749 rows), because its first
// issuer is SUNTRUST BANKS, INC., which carries no such word.
//
// The fund printed here is declared by the filing itself:
//
//	<SERIES-ID>S000006836
//	<SERIES-NAME>Cullen International High Dividend Fund
//
// so the heading resolves exactly once the issuer stops displacing it.
//
// Rows reached: 2,989 in this filing; 12,927 family-wide over 8 filings.
//
// Fix in layout_proxyedge.go, parseProxyEdge: a bare heading that is followed
// by the ballot's identity block (peIdentityLabel on the next line) is the
// ISSUER and can never be the fund, whatever words it contains -- test that
// before the peFundName branch at :330, not after it at :343.
func TestFamilyNS10CullenIssuerBannerHijacksTheFundHeading(t *testing.T) {
	rows := familyNS10Dispatch(t, "cullen_issuer_banner_hijacks_fund.txt", "cullen_dict.tsv", "proxyedge", 2)
	for _, r := range rows {
		if r.SeriesID != "S000006836" {
			t.Errorf("an issuer named TRUST displaced the fund heading: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000006836", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000081/813900/0000892569-05-000726.txt: 11-30, 51-60, 11001-11017,
// 18309-18330 and the filing's own last four lines. Dispatches to `issnpx` at
// this size (the precondition asserts it); the WHOLE filing dispatches to
// `labelvalue`, and both layouts drop the heading the same way.
//
// Pacific Select Fund, 2005. 13,199 of 13,199 rows carry no series AND no fund
// name at all -- the layout emits FundName="" for every row. The filing prints
// the portfolio as a bare line above each block, not as a ruled `=====` banner
// (source line 18311 verbatim):
//
//	PACIFIC SELECT FUND - EQUITY INDEX PORTFOLIO
//
// 18 distinct portfolio headings are printed this way, 145 times in all. Three
// of them stand above the label/value blocks this grammar reads -- CONCENTRATED
// GROWTH (line 8655), EQUITY INDEX (18311) and SMALL-CAP INDEX (27562) -- and
// two of the three resolve against the registrant's own dictionary rows once
// handed to the resolver, measured through htmlDictionaryFund with
// cikDict.exactFallback on CIK 813900:
//
//	"PACIFIC SELECT FUND - EQUITY INDEX PORTFOLIO"     => S000026046
//	"PACIFIC SELECT FUND - SMALL-CAP INDEX PORTFOLIO"  => S000026047
//	"PACIFIC SELECT FUND - HEALTH SCIENCES PORTFOLIO"  => S000026043
//
// (CONCENTRATED GROWTH matches no dictionary name at this CIK and is a floor of
// its own.) The filing declares no <SERIES-ID>, so the dictionary is the whole
// vocabulary, and nothing but the missing heading stands between these rows and
// their series.
//
// Rows reached: the EQUITY INDEX and SMALL-CAP INDEX sections, which are the
// bulk of this filing's 13,199 rows; the family is one filing.
//
// Fix in layout_labelvalue.go, parseLabelValue: read the bare heading line that
// stands above a block and resolve it through icrResolveFundShared /
// htmlDictionaryFund, as the sibling text layouts do for their ruled banners.
func TestFamilyNS10PacificSelectPlainHeadingIsNeverRead(t *testing.T) {
	rows := familyNS10Dispatch(t, "pacific_select_plain_heading.txt", "pacific_select_dict.tsv", "issnpx", 7)
	for _, r := range rows {
		if r.SeriesID != "S000026046" {
			t.Errorf("a portfolio heading printed as a plain line was never read: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000026046", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
