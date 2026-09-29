package main

import (
	"path/filepath"
	"sort"
	"testing"
)

// FAMILY MISLINK31 -- THE HEADER ANSWER AND THE DICTIONARY CHAIN, BOTH HALVES AT
// ONCE.
//
// `icrResolveFundShared` (layout_icr.go:1235) chooses between an INEXACT answer
// derived from the filing's own SGML header declarations (`ix.hdrOnly`) and the
// dictionary-aware chain behind it. Two successive rules each fixed one half of
// the corpus by breaking the other:
//
//   - 53e97e10 ran the dictionary-aware chain FIRST and held an inexact hdrOnly
//     answer back. That fixed the filings in group A below and broke TIAA-CREF
//     (family MISLINK30) and its neighbours.
//   - d196d3db (family MISLINK30) restored TIAA-CREF by letting the header
//     answer win unless the dictionary spells the banner EXACTLY. That reverted
//     53e97e10's correct answers -- group A is wrong again on HEAD.
//
// Neither rule is a fix, because each is a global preference between two
// evidence sources and the corpus contains banners of both shapes. This file
// pins BOTH halves so the next rule cannot be measured on one of them: group A
// must start passing and group B must not stop.
//
// Group A -- an inexact hdrOnly answer must LOSE. Every banner here is a name
// the dictionary carries for one series of the registrant while the filing's own
// header declares a DIFFERENT, similarly-spelled sibling; letting the header's
// inexact answer win stamps the sibling.
//
// Group B -- an inexact hdrOnly answer must WIN. Every banner here is answered
// correctly out of the filing's own declarations, and the dictionary-aware chain
// reaches either a foreign registrant's series (SEI, T. Rowe Price -- the wrong
// ids below are owned by CIKs 0000908695, 0000827060, 0000875186, 0000872825 and
// 0000896647) or a same-CIK sibling.
//
// LAYOUTS. The defect is not icr-specific: `icrResolveFundShared` is the shared
// resolver entry point every text layout calls. These ten filings dispatch to
// FIVE different layouts, and the fixture of each dispatches to the same layout
// the real filing does, with ONE exception recorded on the Hartford case below.
//
// Same class as families MISLINK23 (2e2ec1c5) through MISLINK30 (d196d3db) and
// NS-1084380 (ce502d10) -- a row of one series is stamped with a wrong series --
// but unlike those, this one cannot be satisfied by moving the global preference
// in either direction.

// familyMislink31Dispatch runs the real dispatch on one family MISLINK31 fixture
// with that filing's own `cik_series.tsv` slice loaded, and asserts the
// fixture's own preconditions -- status, layout, CIK, period and declared-series
// count -- so a failure below is an assertion about the series id and never a
// broken fixture.
func familyMislink31Dispatch(t *testing.T, fixture, dict, layout, cik, period string, decls int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink31", dict))
	if err != nil {
		t.Fatal(err)
	}
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink31", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) == 0 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s, want ok/%s/>0", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg, layout)
	}
	if meta.CIK != cik || meta.PeriodOfReport != period || len(meta.SeriesDecls) != decls {
		t.Fatalf("fixture/dispatch precondition: cik=%s period=%s decls=%d, want %s/%s/%d", meta.CIK, meta.PeriodOfReport, len(meta.SeriesDecls), cik, period, decls)
	}
	return rows
}

// familyMislink31Assert checks that every row the fixture produced sits under one
// of the listed banners and carries that banner's series id, and that every
// listed banner produced at least one row. `wrong` names the id a broken rule
// stamps, and appears in the failure message so a regression reads as the
// specific rule that caused it rather than as a bare mismatch.
func familyMislink31Assert(t *testing.T, rows []VoteRow, want, wrong map[string]string, why string) {
	t.Helper()
	seen := map[string]int{}
	for _, r := range rows {
		w, ok := want[r.FundName]
		if !ok {
			t.Errorf("fixture precondition: unexpected fund banner %q (series %q)", r.FundName, r.SeriesID)
			continue
		}
		seen[r.FundName]++
		if r.SeriesID != w {
			note := ""
			if r.SeriesID == wrong[r.FundName] {
				note = " -- this is EXACTLY the id the broken rule stamps"
			}
			t.Errorf("banner %q -> series %q, want %s%s. %s (icrResolveFundShared, layout_icr.go:1235). row: issuer=%q item=%q cusip=%q date=%q desc=%q",
				r.FundName, r.SeriesID, w, note, why, r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.VoteDescription)
		}
	}
	banners := make([]string, 0, len(want))
	for b := range want {
		banners = append(banners, b)
	}
	sort.Strings(banners)
	for _, b := range banners {
		if seen[b] == 0 {
			t.Fatalf("fixture section: banner %q produced no rows", b)
		}
	}
}

func TestFamilyMislink31HdrVsDict(t *testing.T) {
	// ---------------------------------------------------------------- GROUP A --
	// Wrong on HEAD (d196d3db). The header answer must yield to the dictionary.

	// 000072/729528/0000051931-15-000675.txt (American Funds Insurance Series,
	// CIK 0000729528, period 20150630, layout `htmltable`).
	//
	// Every banner in this filing carries the reporting period on the same cell,
	// so the fund name the parser reads is e.g.
	// `International Fund  Reporting Period : July 01, 2014 - June 30, 2015`.
	// The registrant declares BOTH a plain sleeve and a `Managed Risk` sleeve of
	// the same name, and the wrong ids below (S000040666, S000038240, S000040667)
	// are the Managed Risk siblings; S000048970 is a later-vintage sibling of the
	// Global Growth and Income sleeve. `International Fund` and
	// `International Growth and Income Fund` both collapse onto S000040666, which
	// is the shape that proves the answer is coming from a tolerance rung and not
	// from a name: two DIFFERENT banners cannot both be one series.
	t.Run("0000729528", func(t *testing.T) {
		rows := familyMislink31Dispatch(t, "amfunds2015_reporting_period_banners.txt", "cikdict_amfunds.tsv", "htmltable", "0000729528", "20150630", 29)
		// The banner cell is `Fund Name : X<br><br>Reporting Period : ...`, so the
		// name the resolver is handed carries the period after a blank line. The
		// votes TSV shows it as two spaces only because sanitize() folds newlines.
		const rp = "\n\nReporting Period : July 01, 2014 - June 30, 2015"
		familyMislink31Assert(t, rows,
			map[string]string{
				"International Fund" + rp:                   "S000008792",
				"Asset Allocation Fund" + rp:                "S000008796",
				"Global Growth and Income Fund" + rp:        "S000013710",
				"Blue Chip Income and Growth Fund" + rp:     "S000008794",
				"International Growth and Income Fund" + rp: "S000023461",
			},
			map[string]string{
				"International Fund" + rp:                   "S000040666",
				"Asset Allocation Fund" + rp:                "S000038240",
				"Global Growth and Income Fund" + rp:        "S000048970",
				"Blue Chip Income and Growth Fund" + rp:     "S000040667",
				"International Growth and Income Fund" + rp: "S000040666",
			},
			"the dictionary names this sleeve exactly; the filing's own header answers only inexactly, through a same-CIK `Managed Risk`/later-vintage sibling")
	})

	// 000154/1545440/0001580642-21-004055.txt (Ultimus Managers Trust,
	// CIK 0001545440, period 20210630, layout `htmltable`).
	//
	// The banner prints the fund's TICKER in parentheses --
	// `Blue Current Global Dividend Fund (BCGDX)` -- and the registrant also
	// declares `Karner Blue Biodiversity Impact Fund`, whose id S000066472 is
	// what the tolerance rung reaches once the parenthesised ticker has spoiled
	// the exact match. `Blue Current Global Dividend Fund` is declared in this
	// filing's own header as S000046711 and is spelled exactly that way in
	// cik_series.tsv.
	t.Run("0001545440", func(t *testing.T) {
		rows := familyMislink31Dispatch(t, "ultimus2021_blue_current_ticker_banner.txt", "cikdict_ultimus.tsv", "htmltable", "0001545440", "20210630", 16)
		familyMislink31Assert(t, rows,
			map[string]string{"Blue Current Global Dividend Fund (BCGDX)": "S000046711"},
			map[string]string{"Blue Current Global Dividend Fund (BCGDX)": "S000066472"},
			"the banner is a declared name plus a parenthesised ticker, so the ticker must be peeled rather than allowed to push the answer onto the registrant's OTHER `Blue` sleeve")
	})

	// 000093/939934/0001135428-10-000369.txt (SEI Institutional Investments
	// Trust, CIK 0000939934, period 20100630, layout `pvtext`).
	//
	// NOT an icr filing: the fund name is a centred page heading repeated on
	// every page of the section, and layout_pvtext.go:1430 resolves it through
	// the same `icrResolveFundShared`. The registrant declares both
	// `SIIT WORLD EQUITY EX-US FUND` (S000006765) and
	// `SIIT SCREENED WORLD EQUITY EX-U.S. FUND` (S000019597); the banner here is
	// the FORMER with the house prefix dropped, and the wrong id is the latter.
	// `SCREENED` is the discriminating token, so a rung that may drop it can
	// never answer this family.
	t.Run("0000939934_2010", func(t *testing.T) {
		rows := familyMislink31Dispatch(t, "sei2010_world_equity_exus_pvtext.txt", "cikdict_sei2010.tsv", "pvtext", "0000939934", "20100630", 21)
		familyMislink31Assert(t, rows,
			map[string]string{"WORLD EQUITY EX-US FUND": "S000006765"},
			map[string]string{"WORLD EQUITY EX-US FUND": "S000019597"},
			"the dictionary and the header both spell this sleeve `WORLD EQUITY EX-US`; only a rung that drops `SCREENED` can reach the other one")
	})

	// 000078/787623/0001193125-18-263198.txt (Transamerica Funds,
	// CIK 0000787623, period 20180630, layout `icr`).
	//
	// Three banners, three shapes of the same defect:
	//
	//   - `Transamerica International Small Cap` is a declared sleeve
	//     (S000020970) whose name is a strict PREFIX of the sibling
	//     `Transamerica International Small Cap Value` (S000039596).
	//   - `Transamerica Balanced II Fund` (S000054678) loses to
	//     `Transamerica International Growth`'s id S000007796.
	//   - `Transamerica International Growth (fka Transamerica International`
	//     is the banner as the filing wraps it -- the continuation
	//     ` Equity Opportunities)` is on the next source line -- and its own
	//     series is S000007778, not the S000007796 stamped on it.
	//
	// Two distinct banners both stamped S000007796 is again the arithmetic that
	// proves a tolerance rung is answering: one series cannot be two funds.
	t.Run("0000787623", func(t *testing.T) {
		rows := familyMislink31Dispatch(t, "transamerica2018_intl_smallcap_balanced_ii.txt", "cikdict_transam.tsv", "icr", "0000787623", "20180630", 69)
		familyMislink31Assert(t, rows,
			map[string]string{
				"Transamerica International Small Cap":                              "S000020970",
				"Transamerica Balanced II Fund":                                     "S000054678",
				"Transamerica International Growth (fka Transamerica International": "S000007778",
			},
			map[string]string{
				"Transamerica International Small Cap":                              "S000039596",
				"Transamerica Balanced II Fund":                                     "S000007796",
				"Transamerica International Growth (fka Transamerica International": "S000007796",
			},
			"each banner is its own declared sleeve; a prefix/`fka` tolerance rung must not move the answer onto a same-CIK sibling")
	})

	// 000100/1005942/0000928816-23-001200.txt (Putnam Funds Trust,
	// CIK 0001005942, period 20230630, layout `htmltable`).
	//
	// `Putnam Dynamic Risk Allocation Fund` (S000024277) and
	// `Putnam Dynamic Asset Allocation Equity Fund` (S000024760) are both
	// declared here. `Risk`/`Asset ... Equity` is the whole of the difference,
	// and the wrong id is the second sleeve -- which the SAME fixture stamps
	// correctly on its own section in the full filing, so the rung is not
	// failing to see the right name, it is preferring the wrong one.
	t.Run("0001005942", func(t *testing.T) {
		rows := familyMislink31Dispatch(t, "putnam2023_dynamic_risk_allocation.txt", "cikdict_putnam.tsv", "htmltable", "0001005942", "20230630", 15)
		familyMislink31Assert(t, rows,
			map[string]string{"Putnam Dynamic Risk Allocation Fund": "S000024277"},
			map[string]string{"Putnam Dynamic Risk Allocation Fund": "S000024760"},
			"`Dynamic Risk Allocation` is declared in this filing's own header and spelled exactly in the dictionary; `Dynamic Asset Allocation Equity` is a different sleeve")
	})

	// 000088/885709/0000885709-12-000037.txt (Payden & Rygel Investment Group,
	// CIK 0000885709, period 20120630, layout `icr`).
	//
	// `Payden US Growth Leaders Fund` is S000011759. The wrong id S000031104 is
	// `Metzler/Payden European Emerging Markets Fund`, the registrant's OTHER
	// `Payden`-prefixed sleeve and the only other section in this filing with a
	// comparable row count -- a brand-word match with no fund word in common.
	t.Run("0000885709", func(t *testing.T) {
		rows := familyMislink31Dispatch(t, "payden2012_us_growth_leaders.txt", "cikdict_payden.tsv", "icr", "0000885709", "20120630", 23)
		familyMislink31Assert(t, rows,
			map[string]string{"Payden US Growth Leaders Fund": "S000011759"},
			map[string]string{"Payden US Growth Leaders Fund": "S000031104"},
			"`US Growth Leaders` shares no fund word with `European Emerging Markets`, so nothing but a brand-prefix rung can connect them")
	})

	// ---------------------------------------------------------------- GROUP B --
	// Correct on HEAD (d196d3db). The header answer must keep winning. Each of
	// these is what 53e97e10 broke, and the reason d196d3db was written.

	// 000093/939934/0001135428-23-000250.txt (SEI Institutional Investments
	// Trust, CIK 0000939934, period 20230630, layout `icr`).
	//
	// THE CROSS-REGISTRANT HALF. All four banners are declared by THIS filing's
	// own header, under the house `SIIT ` prefix the body drops:
	//
	//	<SERIES-ID>S000035814  <SERIES-NAME>SIIT Extended Market Index Fund
	//	<SERIES-ID>S000050969  <SERIES-NAME>SIIT Global Managed Volatility Fund
	//	<SERIES-ID>S000033123  <SERIES-NAME>SIIT Multi-Asset Real Return Fund
	//	<SERIES-ID>S000006770  <SERIES-NAME>SIIT SMALL MID CAP EQUITY FUND
	//
	// Three of the four wrong ids belong to OTHER REGISTRANTS entirely --
	// S000012941 and S000022882 to CIK 0000908695, S000028150 to CIK 0000827060,
	// S000008433 to CIK 0000875186 -- and `cikdict_sei2023.tsv` carries their
	// rows on purpose, so the wrong answer is reachable here exactly as it is in
	// production. (S000008433 is the only one whose name is not also a sibling
	// of this registrant: it is a foreign `Small Mid Cap Equity` sleeve.) A rule
	// that lets the dictionary outrank the filing's own declarations hands a
	// registrant's rows to a fund it does not own.
	t.Run("0000939934_2023", func(t *testing.T) {
		rows := familyMislink31Dispatch(t, "sei2023_crosscik_wrong_ids.txt", "cikdict_sei2023.tsv", "icr", "0000939934", "20230630", 28)
		familyMislink31Assert(t, rows,
			map[string]string{
				"Extended Market Index Fund":     "S000035814",
				"Global Managed Volatility Fund": "S000050969",
				"Multi-Asset Real Return Fund":   "S000033123",
				"SMALL MID CAP EQUITY FUND":      "S000006770",
			},
			map[string]string{
				"Extended Market Index Fund":     "S000012941",
				"Global Managed Volatility Fund": "S000022882",
				"Multi-Asset Real Return Fund":   "S000028150",
				"SMALL MID CAP EQUITY FUND":      "S000008433",
			},
			"this filing's own header declares the banner under the `SIIT ` prefix, and no dictionary rung may outrank that with a FOREIGN registrant's series")
	})

	// 000031/313212/0001206774-17-002693.txt (T. Rowe Price International Funds,
	// Inc., CIK 0000313212, period 20170630, layout `icr`).
	//
	// The other cross-registrant pair. `International Discovery Fund` and
	// `New Asia Fund` are bare banners; the header declares them as
	// `T. Rowe Price International Discovery Fund` (S000001491) and
	// `T. Rowe Price New Asia Fund` (S000001493). The wrong ids S000006604 and
	// S000004706 are owned by CIKs 0000872825 and 0000896647 and are carried in
	// `cikdict_trowe.tsv` for that reason.
	t.Run("0000313212", func(t *testing.T) {
		rows := familyMislink31Dispatch(t, "trowe2017_intl_discovery_new_asia.txt", "cikdict_trowe.tsv", "icr", "0000313212", "20170630", 24)
		familyMislink31Assert(t, rows,
			map[string]string{
				"International Discovery Fund": "S000001491",
				"New Asia Fund":                "S000001493",
			},
			map[string]string{
				"International Discovery Fund": "S000006604",
				"New Asia Fund":                "S000004706",
			},
			"a registrant-prefix strip against this filing's own declarations settles both banners, so a foreign registrant's identically-named fund must never be reached")
	})

	// 000100/1006415/0001104659-20-099615.txt (Hartford Mutual Funds Inc/CT,
	// CIK 0001006415, period 20200630).
	//
	// LAYOUT DIVERGENCE -- THE ONE EXCEPTION, AND IT MATTERS TO THE FIXER. The
	// real filing dispatches to `labelvalue`: it is a MIXED document whose
	// sections are printed in two grammars, and the `#  Proposal  Mgt Rec
	// Vote Cast  Sponsor` header that `matchLabelValue` keys on first appears at
	// source line 21287, inside the Climate Opportunities section. This fixture
	// keeps that labelvalue block (so the signature is present) but on the
	// reduced body `parseISSNPX` no longer reads zero rows, so it does not
	// decline and the fixture dispatches to `issnpx` instead. Both layouts reach
	// the AARP section through `icrSupplement` and both resolve it through
	// `icrResolveFundShared`, and the fixture stamps the SAME two ids the real
	// filing does -- but a fixer reading this file should know the production
	// path is labelvalue.
	//
	// `Hartford AARP Balanced Retirement Fund (formerly, Hartford Multi-Asset
	// Income Fund)` is S000045314. The wrong id S000003571 is
	// `Hartford Multi-Asset Income and Growth Fund`, which this filing ALSO
	// declares and ALSO reports under its own banner: the parenthesised
	// `formerly,` clause names a fund that is not this one, and a dictionary rung
	// that reads it as the fund name merges two live sleeves. The Climate
	// Opportunities banner is the same shape without the trap and is asserted
	// alongside it.
	t.Run("0001006415", func(t *testing.T) {
		rows := familyMislink31Dispatch(t, "hartford2020_aarp_formerly_banner.txt", "cikdict_hartford.tsv", "issnpx", "0001006415", "20200630", 40)
		familyMislink31Assert(t, rows,
			map[string]string{
				"Fund Name: Hartford AARP Balanced Retirement Fund (formerly, Hartford Multi-Asset Income Fund)":      "S000045314",
				"Fund Name: Hartford Climate Opportunities Fund (formerly Hartford Environmental Opportunities Fund)": "S000053012",
			},
			map[string]string{
				"Fund Name: Hartford AARP Balanced Retirement Fund (formerly, Hartford Multi-Asset Income Fund)": "S000003571",
			},
			"the banner's leading name is what this filing's header declares; the `formerly` clause names a DIFFERENT sleeve that reports separately in the same filing")
	})

	// 000088/883939/0001193125-14-321103.txt (RidgeWorth Funds, CIK 0000883939,
	// period 20140630, layout `icr`).
	//
	// Every other banner in this filing carries the `RidgeWorth ` brand prefix;
	// this one alone is bare -- `Fund Name : Core Bond Fund` -- and the header
	// declares `RidgeWorth Core Bond Fund` as S000004692. The wrong id
	// S000004699 is a same-CIK bond sibling. This is the minimal case for the
	// brand-prefix strip working off the filing's OWN declarations.
	t.Run("0000883939", func(t *testing.T) {
		rows := familyMislink31Dispatch(t, "ridgeworth2014_core_bond_bare_banner.txt", "cikdict_ridgeworth.tsv", "icr", "0000883939", "20140630", 33)
		familyMislink31Assert(t, rows,
			map[string]string{"Core Bond Fund": "S000004692"},
			map[string]string{"Core Bond Fund": "S000004699"},
			"the bare banner plus the registrant prefix is an exact declared name, so nothing may prefer a same-CIK bond sibling to it")
	})
}
