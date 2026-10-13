package main

import (
	"path/filepath"
	"testing"
)

// 000142/1420040/0000910472-10-000863.txt: verbatim source lines 1-136 (the
// whole SGML header, carrying all FOUR `<SERIES>` declarations the filing makes
// -- S000020971 Dunham Real Estate Stock Fund (line 53-54), S000020973 Dunham
// Small Cap Growth Fund (70-71), S000022888 Dunham Monthly Distribution Fund
// (87-88), S000028743 Dunham Loss Averse Growth Fund (104-105) -- down through
// `<TEXT>` and the `<BODY>` tag) and 4758-4839 (the second section's `<TABLE>`
// open, its `Registrant:` banner, the file-number and reporting-period cells,
// the `Selected Accounts` band, the DATA DOMAIN, INC. ballot header with its
// Security / Ticker / ISIN / Meeting Date / Agenda cells, the column header band
// and the first two ballot lines -- item 1 DIRECTOR and its sub-item 1
// RONALD D. BERNAL, 46300 / 0 / 0 / 0). Every byte is a line-range cut of the
// source; the five closing lines `</TABLE>`, `</BODY>`, `</HTML>`, `</TEXT>`,
// `</DOCUMENT>` are the only added ones, and they close markup the cut opened.
//
// Dunham Funds, CIK 1420040, period 20100830, dispatches to `proxyedge`.
// Measured on the real filing with parse_npx_go_415 (`-cik-series` and
// `-series-map` both supplied): 253 rows, and ALL 253 carry a BLANK series_id
// and the same fund_name --
//
//	Registrant:  Dunham Monthly Distribution Fund  Item 1, Exhibit J
//
// THE GRAMMAR. This registrant prints each section banner as a single bold cell
// that glues three things together: the `Registrant:` label, the fund's declared
// name, and the exhibit pointer for that section of the filing. Four of them,
// one per declared series (real source lines 243, 4759, 10127, 10173):
//
//	Registrant: &nbsp;&nbsp;&nbsp;Dunham Real Estate Stock Fund &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Item 1, Exhibit I
//	Registrant: &nbsp;&nbsp;&nbsp;Dunham Monthly Distribution Fund &nbsp;&nbsp;Item 1, Exhibit J
//	Registrant: Dunham Loss Averse Growth Fund &nbsp;&nbsp;Item 1, Exhibit K
//	Registrant: Dunham Small Cap Growth Fund &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Item 1, Exhibit L
//
// Each of those four names is declared VERBATIM in this filing's own SGML
// header, so nothing has to be guessed: strip the `Item N, Exhibit X` tail and
// the banner resolves off the header alone.
//
// WHY IT FAILS. The `Registrant:` branch of the identity-label loop
// (layout_proxyedge.go ~1330) hands the banner's value to `peRegistrantFund`
// (layout_proxyedge.go ~890), which knows exactly one shape: a ` - ` separated
// `<REGISTRANT> - <FUND>` pair. It has no notion of a trailing form-item
// suffix, so the tail rides along into the fund name -- and because the glued
// string matches no declared series, `icrResolveFundShared` and
// `htmlDictionaryFund` both return nothing and every row beneath the banner goes
// out with a blank series_id.
//
// The htmltable layout already solves precisely this for this vendor's other
// vintage: `htmlCutFormItemSuffix` (layout_htmltable.go ~7143) cuts the
// `Item 1` tail off `Registrant: Dunham Funds - <Fund>  Item 1`. The proxyedge
// path never calls it.
//
// This test asserts over fund_name AND series_id, because the header in this
// fixture is the filing's real one and declares all four series -- so the blank
// series_id reproduces here exactly as it does on WRDS, rather than collapsing
// onto a single-series fallback.
func TestFamilyNS1420040DunhamRegistrantItemSuffix(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	const (
		dir     = "family_ns1420040_dunham_registrant_item_suffix"
		fixture = "dunham_monthly_distribution_item_exhibit_2010.txt"
		banner  = "Dunham Monthly Distribution Fund"
		series  = "S000022888"
	)

	ch := make(chan *ParseResult, 8192)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", dir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.CIK != "0001420040" || len(meta.SeriesDecls) != 4 {
		t.Fatalf("fixture precondition: cik=%q series declarations=%d, want CIK 0001420040 declaring 4 series (source lines 49-120)",
			meta.CIK, len(meta.SeriesDecls))
	}
	if meta.Layout != "proxyedge" {
		t.Fatalf("fixture guard: the cut dispatched to %q, not `proxyedge` -- the real filing dispatches to `proxyedge`, so the defect below is no longer being measured on the same code path",
			meta.Layout)
	}
	if len(rows) == 0 {
		t.Fatalf("fixture guard: no rows read out of the DATA DOMAIN, INC. ballot under source line 4759's banner")
	}

	bad := 0
	for i, r := range rows {
		if r.FundName == banner && r.SeriesID == series {
			continue
		}
		bad++
		t.Errorf("row %d carries the exhibit pointer glued onto the fund: fund=%q series=%q issuer=%q cusip=%q date=%q desc=%q -- want %q / %s, the name this filing's own header declares at source lines 87-88",
			i, r.FundName, r.SeriesID, r.IssuerName, r.CUSIP, r.MeetingDate,
			truncate(r.VoteDescription, 60), banner, series)
	}
	if bad > 0 {
		t.Errorf("%d of %d rows in the cut lose their series: `peRegistrantFund` (layout_proxyedge.go ~890) strips only a ` - ` separated registrant/fund pair and leaves the `Item 1, Exhibit J` tail of source line 4759 on the fund name, which then resolves against nothing. `htmlCutFormItemSuffix` (layout_htmltable.go ~7143) already cuts this exact tail for the htmltable layout. On the real filing this is all 253 rows, under all four banners (source lines 243, 4759, 10127, 10173)",
			bad, len(rows))
	}
}
