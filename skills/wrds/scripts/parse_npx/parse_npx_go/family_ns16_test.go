package main

import (
	"path/filepath"
	"testing"
)

// familyNS16Dispatch runs the real dispatch on a family NS16 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS16Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns16", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns16", fixture), sink, make([]byte, headBytes))
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

// 000008/88064/0000088053-04-000603.txt: verbatim source lines 11-28, 52-69,
// 3550-3577, plus one `</TABLE>` line to close the table the line-range cut
// opened -- the only byte in the fixture that is not verbatim -- then verbatim
// source lines 5174-5177 (the filing's only `ProxyEdge -  Investment Company
// Report` line, which is what matchSplitTable keys on, with its own
// row-less banner) and the filing's own last four lines. Dispatches to
// `splittable` (the precondition asserts it).
//
// Investment Trust (the former Scudder Investment Trust), 2004. 5,355 of 5,812
// rows carry no series. The registrant's whole dictionary spells the successor
// brand -- all 22 rows are `DWS …` or `Deutsche …` -- while every printed
// banner spells the contemporaneous `Scudder` brand, which the filing's own
// header records three times as a FORMER CONFORMED NAME (source lines 53, 57,
// 61, verbatim):
//
//	FORMER CONFORMED NAME:	SCUDDER INVESTMENT TRUST
//	FORMER CONFORMED NAME:	SCUDDER GROWTH & INCOME FUND
//	FORMER CONFORMED NAME:	SCUDDER COMMON STOCK FUND INC
//
// The banner itself, source line 3554, verbatim:
//
//	Selected Accounts: Scudder Large Co Growth
//
// census, real dispatch on the whole filing, registrant's 22 dictionary rows:
//
//	2953 blank "Equity 500 Index Portfolio"
//	1428 blank "Scudder Small Co Stock Fund"
//	 531 blank "Scudder Growth & Income"
//	 443 blank "Scudder Large Co Growth"
//	 457 NAMED "Scudder Capital Growth" => S000005705
//
// The stems resolve bare and the branded forms do not -- measured through
// icrResolveFundShared / issPlainHeadingSeries / lvResolveBanner on this
// filing's own index plus the registrant's 22 dictionary rows:
//
//	"Large Co Growth"              shared=S000005707 plain=S000005707 lv=S000005707
//	"Scudder Large Company Growth" shared=S000005707 plain=S000005707 lv=S000005707
//	"Scudder Large Co Growth"      shared=""         plain=""         lv=""
//	"Growth & Income"              shared=S000005706 plain=S000005706 lv=S000005706
//	"Scudder Growth & Income"      shared=""         plain=""         lv=""
//
// so the missing hop is the brand and nothing else: S000005707 is declared
// `DWS Large Company Growth Fund`, and the `Co`/`Company` abbreviation already
// composes on the bare stem.
//
// Rows reached: 974 -- `Scudder Large Co Growth` (443) and `Scudder Growth &
// Income` (531) of the measured filing; the family is 2 filings and 6,555 pool
// rows. `Equity 500 Index Portfolio` (2,953) and `Scudder Small Co Stock Fund`
// (1,428) stay blank after the fix and are a name sub-floor beside it.
//
// Fix in layout_issnpx.go, issHistoricalBrandKey: it carries five
// predecessor/successor brand families (Wells Fargo/Allspring, Goldman
// CORE/Structured, Smith Barney/Legg Mason Partners, AIM/INVESCO, TDX) and no
// `Scudder`/`DWS`/`Deutsche` pair, so a Scudder-branded banner reaches the
// dictionary's DWS spelling only through whatever incidental rung happens to
// answer it.
func TestFamilyNS16ScudderBrandBannerUnresolved(t *testing.T) {
	rows := familyNS16Dispatch(t, "scudder_brand_banner_unresolved.txt", "investment_trust_dict.tsv", "splittable", 4)
	for _, r := range rows {
		if r.SeriesID != "S000005707" {
			t.Errorf("a Scudder-branded banner did not reach the registrant's DWS dictionary spelling: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000005707", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000086/864508/0000950152-05-007270.txt: verbatim source lines 11-29, 44-59
// and 1562-1580, plus the filing's own last four lines. Dispatches to `pvtext`
// (the precondition asserts it).
//
// American Performance Funds, 2005. 9,932 of 9,932 rows carry no series. Every
// one of the seven `Account Number:` values is a vendor account CODE followed
// by the fund name on the same line -- the NS14 §3 Hancock shape, except that
// here the name IS printed. All seven, source lines 95, 1564, 3935, 10783,
// 11895, 14543 and 16000, verbatim:
//
//	Account Number: BOk-APequity American Performance Equity Fund
//	Account Number: BOk-APgrowth American Performance Growth Equity
//	Account Number: BOk-APbalagg American Performance Bal-Aggresive
//	Account Number: BOk-APbalanc American Performance Balanced
//	Account Number: BOk-APbalgro American Performance Balanced-Growth
//	Account Number: BOk-APbalval American Performance Balanced-Value
//	Account Number: BOk-APcap American Performance Small Cap Equity
//
// pvTextResolveAccount is handed the whole value, code included, and no rung
// answers it. The name alone resolves -- measured through
// icrResolveFundShared / issPlainHeadingSeries / lvResolveBanner on this
// filing's own index plus the registrant's 34 dictionary rows:
//
//	"BOk-APgrowth American Performance Growth Equity" shared="" plain="" lv=""
//	"American Performance Growth Equity"  shared=S000008944 plain=S000008944 lv=S000008944
//	"American Performance Balanced"       shared=S000008937 plain=S000008937 lv=S000008937
//	"American Performance Small Cap Equity"           shared="" plain="" lv=""
//
// S000008944 is declared `Growth Equity Fund` and S000008937 `Balanced Fund`,
// so the registrant-prefix strip answers both once the code is off the front.
//
// Rows reached: 1,766 on the safe pair -- `BOk-APgrowth` (1,174) and
// `BOk-APbalanc` (592); the family is 2 filings and 6,302 pool rows. Three
// further accounts are a name sub-floor (`Small Cap Equity` 2,680 is ambiguous
// between S000011445 `U.S. Small Cap Equity Fund` and S000008940 `U.S. Tax
// Efficient Small Cap Equity Fund`; `Bal-Aggresive` 2,648 and
// `Balanced-Growth` 1,321 name no series at this CIK), and two more must be
// refused rather than recovered, because stripping the code makes them collide
// with the pair above: `Equity Fund` (767) also answers S000008944 and
// `Balanced-Value` (750) also answers S000008937.
//
// Fix in layout_pvtext.go, in the `Account Number:` reader that feeds
// pvTextResolveAccount: an account value that is a code token followed by a
// name must be resolved on the name, with the collision guard deciding the
// remainder.
func TestFamilyNS16APFundsAccountCodePrefix(t *testing.T) {
	rows := familyNS16Dispatch(t, "apfunds_account_code_prefix.txt", "apfunds_dict.tsv", "pvtext", 7)
	for _, r := range rows {
		if r.SeriesID != "S000008944" {
			t.Errorf("an account value that is a code token followed by the fund name was not resolved on the name: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000008944", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
