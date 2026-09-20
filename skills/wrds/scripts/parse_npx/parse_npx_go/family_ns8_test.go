package main

import (
	"path/filepath"
	"testing"
)

// familyNS8Dispatch runs the real dispatch on a family NS8 fixture, loading the
// registrant's own cik_series.tsv rows as the dictionary when one is named.
func familyNS8Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns8", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns8", fixture), sink, make([]byte, headBytes))
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

// 000094/948630/0000088053-05-000977.txt: 11-20, 22-28, 63-69, 78-80, 127-141,
// 143-144, 189-223 and the filing's own last four lines.
//
// Scudder Advisor Funds II, 2005, layout `splittable`. All 6,603 of this
// filing's rows carry no series, and every one of them is stamped with the
// MASTER portfolio's ProxyEdge account name:
//
//	6603 blank "Scudder Inv Portfolio EAFE Equity Index Portfolio"
//
// The filing declares no <SERIES-ID>, so cikDict.back puts the registrant's two
// dictionary rows in (DWS EAFE Equity Index Fund S000005734, DWS U.S. Bond Index
// Fund S000005735). The filing is a feeder: it prints TWO ProxyEdge banners, the
// feeder's own and then the master's, and the second one wins (source lines
// 129-141 verbatim):
//
//	ProxyEdge -  Investment Company Report                   Report Date: 08/03/2005
//	Meeting Date Range: 07/01/2004 to 06/30/2005
//	Selected Accounts: Scudder Adv Funds II - EAFE Equity Index Fund
//	...
//	Selected Accounts: Scudder Inv Portfolio EAFE Equity Index Portfolio
//
// `Scudder Inv Portfolio` is the MASTER trust's brand (Scudder Investment
// Portfolios), not the registrant's words, so the registrant-prefix strip rung
// refuses the whole banner. Measured on this filing's own index through
// icrResolveFundShared / issResolveFund:
//
//	"Scudder Inv Portfolio EAFE Equity Index Portfolio" -> ""
//	"Scudder Adv Funds II - EAFE Equity Index Fund"     -> ""
//	"EAFE Equity Index Portfolio"                       -> S000005734 (exact)
//	"EAFE Equity Index Fund Premier"                    -> S000005734 (exact)
//
// The remainder therefore resolves exactly once handed over, and the family's
// sibling filing (0000088053-04-000655.txt) prints the banner without the master
// prefix (`Selected Accounts: EAFE Equity Index Fund Premier`) and stamps all
// 9,608 of its rows S000005734 — which is why this is a prefix-strip defect and
// not a resolver floor.
//
// Rows reached: 6,603, the whole of this filing's pool rows.
//
// Fix in layout_issnpx.go, issResolveFundUncached's registrant-prefix strip:
// admit a leading run that mixes registrant words with a master-trust brand
// (`Scudder Inv Portfolio`) when the remainder, after the existing type-word
// retry, resolves EXACTLY against a declared or dictionary name.
func TestFamilyNS8ScudderAdvisorIIMasterAccountPrefixRefusesTheBanner(t *testing.T) {
	rows := familyNS8Dispatch(t, "scudder_advisor_ii_master_account.txt", "scudder_advisor_ii_dict.tsv", "splittable", 7)
	for _, r := range rows {
		if r.SeriesID != "S000005734" {
			t.Errorf("the master trust's brand prefix refused the ProxyEdge account name: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000005734", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
