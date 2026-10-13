package main

import (
	"path/filepath"
	"testing"
)

// American Independence Funds Trust (CIK 0001324443), verbatim bytes from its
// 2016 N-PX, 000132/1324443/0001438934-16-000780.txt (period 20160630, md5
// 14b03e5f3bc3d66bd2ce78e6435f4661, 5,811 lines), broadridge layout.
//
// Fixture rx_dynamic_stock_2016.txt is `sed -n '1,229p;230,260p;4767,4867p;5789,5811p'`
// over that file, concatenated in that order and otherwise untouched:
//
//	1-229       the SGML header (8 <SERIES> declarations), the FORM N-PX
//	            preamble, and the document's own `<PAGE>` / `<TABLE>` /
//	            `<S> <C>` opener at lines 226-229. The opener is load-bearing
//	            for dispatch, not decoration -- the filing carries exactly one
//	            `<TABLE>` (line 228) and one `</TABLE>` (line 5793).
//	230-260     the filing's first two banners, kept as the CONTRAST: the
//	            silent `AI Boyd Watterson Core Plus Fund` (line 231, held no
//	            voting securities) and `AI Hillcrest Small Cap Value Fund`
//	            (line 237) with the first two ballots of its ABM INDUSTRIES
//	            INCORPORATED section (agenda 934326592, Security 000957100,
//	            Annual, 09-Mar-2016), cut immediately before ABM item 3 at
//	            line 261.
//	4767-4867   the `Rx Dynamic Stock Fund` banner as printed at line 4769,
//	            plus the whole of the two issuer sections that follow it --
//	            ACE LIMITED agenda 934280710 (Security H0023R105, Special,
//	            22-Oct-2015) and AETNA INC. agenda 934282005 (Security
//	            00817Y108, Special, 19-Oct-2015) -- cut immediately before the
//	            next issuer's rule at 4868 (BROADCOM LIMITED).
//	5789-5811   the `* Management position unknown` footer, the document's own
//	            `</TABLE>`, the SIGNATURES block and the trailing `</TEXT>` /
//	            `</DOCUMENT>` / `</SEC-DOCUMENT>` tags.
//
// Dictionary: all 53 cik_series.tsv rows this CIK carries, copied verbatim
// from the corpus dictionary (`grep -P '^0001324443\t' cik_series.tsv`).
//
// THE DEFECT. This CIK's known-registrant no_series residue (period >= 2006)
// was 310 rows. Commit c0c1d907 (the brand-acronym rung, family
// NS-1324443-ai-brand-acronym) resolved the 34 that sat under the `AI `
// banners -- the registrant abbreviating its own `American Independence`
// brand to the two-letter acronym `AI`. The remaining 276 rows, spread across
// BOTH of this CIK's in-scope filings, sit under ONE banner heading:
//
//	Rx Dynamic Stock Fund
//
// printed once per filing -- line 4769 of 0001438934-16-000780.txt (this
// fixture's source) and line 5745 of 0001438934-17-000220.txt. Both are
// single hits; there is no second spelling to key.
//
// It does not resolve because the string exists in no dictionary row of this
// registrant at all. `grep -i 'rx dynamic stock' cik_series.tsv` returns
// nothing, corpus-wide, at every CIK and every vintage. (The only `Rx Dynamic`
// rows the dictionary carries anywhere are CIK 1464413's `Rx Dynamic Growth
// Fund` and `Rx Dynamic Total Return Fund` -- Starboard Investment Trust, a
// completely different registrant, and NOT this fund under another name. A
// cross-registrant name rung reaching those would be a mislink, which is
// precisely why issRegistrantRenames is registrant-scoped.) No name-based rung
// can reach the printed heading, because it shares no distinctive word with
// the successor.
//
// It is nonetheless a real, externally-documented, SAME-REGISTRANT rename.
// SEC EDGAR full-text search surfaces 0001324443-15-000180, a 497 prospectus
// supplement filed 2015-12-15 under THIS SAME CIK 1324443 and titled
// "SUPPLEMENT TO THE PROSPECTUS FOR THE DYNAMIC STOCK FUND", whose body reads:
//
//	RX DYNAMIC STOCK FUND (formerly, the American Independence Stock Fund)
//	(Ticker Symbols: IFCSX, FMGRX, FMGCX)
//
// Those three tickers are an EXACT match to the class contracts this filing's
// OWN SGML header declares for series S000011458 (lines 56-75 of the source:
// C000031686 Institutional Class FMGRX, C000031722 Class A IFCSX, C000031723
// Class C FMGCX). So `Rx Dynamic Stock Fund` is an INTERIM (2015-2016) name
// for S000011458, sitting between the two vintages the dictionary did capture:
//
//	0001324443  S000011458  American Independence Stock Fund
//	            20110630    000132/1324443/0001438934-11-000405.txt
//	0001324443  S000011458  American Independence Navellier Defensive Alpha Fund
//	            20160630    000132/1324443/0001438934-16-000780.txt
//
// -- a rename that happened between N-PX snapshots and was never itself
// captured as a dictionary row.
//
// WHERE THE FIX BELONGS. This is the evidentiary shape issRegistrantRenames /
// issAuditedRenameAliases (layout_issnpx.go:8156-8527) already carries for
// CIKs 0001385533, 0000755221, 0000702340, 0000810573, 0001683471 and the
// American AAdvantage entries: an old, externally-documented registrant name
// mapped onto a name this same registrant's own pool already spells. So the
// fix is ONE entry in issRegistrantRenames["0001324443"] keying
// `rx dynamic stock fund` onto `American Independence Navellier Defensive
// Alpha Fund`, and no new plumbing: issAuditedRenameAliases is called from
// issFilingIndex, which broadridge builds at layout_broadridge.go:1621 exactly
// as every other layout does, and the table's own doc comment already states
// that the mechanism does not gate on period (the 0001683471 Roundhill MVP
// entry is a 2022 filing).
//
// It is in fact SIMPLER than that Roundhill precedent. There the successor had
// to be reached through issIndexDict(ix).registrantExactName, the dictionary
// rung. Here the successor `American Independence Navellier Defensive Alpha
// Fund` IS DECLARED IN THIS FILING'S OWN SGML HEADER for S000011458, so
// issAuditedRenameAliases resolves it on its FIRST lookup --
// lookupSeriesEntry(ix.byName, succ) -- and the dictionary rung is never
// reached at all.
//
// The parser currently reads the banner verbatim into the fund-name column and
// leaves series_id blank.
func TestFamilyNS1324443RxDynamicStockFundRenameResolves(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns1324443_rxdynamic_stock_fund_rename", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	const (
		fixture = "rx_dynamic_stock_2016.txt"
		heading = "Rx Dynamic Stock Fund"
		want    = "S000011458" // American Independence Navellier Defensive Alpha Fund
		// The banner that already resolves, on the brand-acronym rung landed
		// by c0c1d907, asserted as a contrast so a fix that reaches the Rx
		// Dynamic banner by loosening that rung is visible as a regression
		// here rather than corpus-wide.
		contrast   = "AI Hillcrest Small Cap Value Fund"
		contrastID = "S000052272"
	)

	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns1324443_rxdynamic_stock_fund_rename", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.CIK != "0001324443" || meta.PeriodOfReport != "20160630" {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}

	var under []VoteRow
	for _, r := range sink.buf {
		if r.FundName == heading {
			under = append(under, r)
		}
	}
	if len(under) == 0 {
		t.Fatalf("fixture precondition: no rows under %q (fixture emitted %d rows in total)", heading, len(sink.buf))
	}

	blank := 0
	var first VoteRow
	for _, r := range under {
		if r.SeriesID != want {
			if blank == 0 {
				first = r
			}
			blank++
		}
	}
	if blank > 0 {
		t.Errorf("banner %q: %d of %d rows carry series=%q, want %s -- `Rx Dynamic Stock Fund` is the INTERIM 2015-2016 name of the fund the dictionary spells `American Independence Stock Fund` (20110630) and then `American Independence Navellier Defensive Alpha Fund` (20160630), both series S000011458 of this same CIK 1324443. The rename is documented by this registrant's OWN 497 supplement 0001324443-15-000180 (filed 2015-12-15): \"RX DYNAMIC STOCK FUND (formerly, the American Independence Stock Fund) (Ticker Symbols: IFCSX, FMGRX, FMGCX)\" -- and those three tickers are exactly the class contracts THIS filing's own SGML header declares for S000011458 (C000031686 FMGRX, C000031722 IFCSX, C000031723 FMGCX). The printed name itself appears in NO dictionary row of this registrant at any vintage (grep -i 'rx dynamic stock' cik_series.tsv hits only CIK 1464413, Starboard Investment Trust, a different registrant), so no name rung can reach it and only the registrant-scoped audited rename table can. First unresolved row: issuer=%q item=%q meeting=%q desc=%.60q",
			heading, blank, len(under), first.SeriesID, want,
			first.IssuerName, first.ItemSeq, first.MeetingDate, first.VoteDescription)
	}

	// Contrast: nothing about the wanted fix may disturb the banner that the
	// brand-acronym rung (commit c0c1d907) already answers.
	seen := false
	for _, r := range sink.buf {
		if r.FundName != contrast {
			continue
		}
		seen = true
		if r.SeriesID != contrastID {
			t.Errorf("contrast banner %q regressed: series=%q, want %s (resolved by the acronymForBrand rung landed in c0c1d907; dictionary row `American Independence Hillcrest Small Cap Value Fund`)", contrast, r.SeriesID, contrastID)
			break
		}
	}
	if !seen {
		t.Errorf("contrast precondition: fixture emitted no rows under %q, so the %s contrast asserts nothing -- the fixture slice 230-260 should carry the ABM INDUSTRIES section of that banner", contrast, contrastID)
	}
}
