package main

import (
	"path/filepath"
	"testing"
)

const ns1510337EurozoneDir = "family_ns1510337_eurozone_etf_fund_suffix"

// ns1510337EurozoneDispatch runs the fixture through the same top-level entry
// point production uses -- processFile, which sniffs the layout itself -- with
// the CIK's real cik_series.tsv rows loaded and no overlay, so nothing below
// depends on a hand-built FilingMeta or a hand-picked reader.
func ns1510337EurozoneDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns1510337EurozoneDir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1510337EurozoneDir, fixture), sink, make([]byte, headBytes))
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

// 000151/1510337/0001445546-15-003840.txt (FIRST TRUST EXCHANGE-TRADED ALPHADEX
// FUND II, CIK 1510337, period 20150630, manifest layout `twoband`): all 668 of
// the filing's rows carry no series_id, and every one of them is stamped with
// the same fund_name, `First Trust Eurozone AlphaDEX(R) Fund`.
//
// ONE HEADING OWNS THE WHOLE FILING. The body prints exactly one fund banner,
// between two rules immediately under the Item 1 heading (fixture source lines
// 305-309, verbatim):
//
//	Item 1.  Proxy Voting Record
//
//	------------------------------------------------------------------------
//	First Trust Eurozone AlphaDEX(R) Fund
//	------------------------------------------------------------------------
//	<TABLE>
//
// Everything after it is <TABLE> blocks of meetings for that one fund. There is
// no second banner, no <PAGE>-separated sibling section, and no per-row fund
// cell, so there is exactly one candidate series for every row in the filing.
//
// AND THE FILING'S OWN HEADER NAMES IT. The SGML
// <SERIES-AND-CLASSES-CONTRACTS-DATA> block declares 19 series for this
// registrant (fixture source lines 38-231), one of which is spelled, verbatim:
//
//	<SERIES-ID>S000047035
//	<SERIES-NAME>First Trust Eurozone AlphaDEX ETF
//	<CLASS-CONTRACT-TICKER-SYMBOL>FEUZ
//
// That is the fund. FEUZ is the First Trust Eurozone AlphaDEX product, and it is
// the ONLY declared series of the 19 whose name contains `Eurozone` -- the other
// 18 are Emerging Markets, Europe, Latin America, Brazil, China, Japan, South
// Korea, Developed Markets ex-US, Asia Pacific ex-Japan, Australia, Canada,
// Germany, Hong Kong, Switzerland, Taiwan, United Kingdom, Developed Markets
// ex-US Small Cap and Emerging Markets Small Cap. So no collision is possible:
// nothing else this registrant declares could claim these rows, and a Europe /
// Eurozone mix-up is not available to the resolver by accident.
//
// WHY THE MATCH FAILS. normalizeSeriesName (header.go:239-261) folds case, the
// trademark and registered marks (`(R)` and the registered-mark glyphs) and
// punctuation, so the banner's `AlphaDEX(R)` and the header's `AlphaDEX` do
// converge. What it does NOT do -- by the explicit design its own doc comment
// states -- is strip a generic suffix noun. Folding `Fund` onto `ETF` globally
// would wrongly merge genuinely distinct registered series elsewhere in the
// corpus, so the function leaves the trailing word alone. After normalisation
// the two strings are therefore:
//
//	banner    FIRST TRUST EUROZONE ALPHADEX FUND
//	declared  FIRST TRUST EUROZONE ALPHADEX ETF
//
// which differ in exactly one word. The banner resolves to nothing, twoband
// falls through, and the rows are emitted with a blank series_id and the printed
// banner text as fund_name.
//
// THIS IS THE REGISTRANT RENAMING ITS OWN PRODUCT MID-LIFE, NOT TWO FUNDS. The
// vendor's plain-text template kept the older `... Fund` house style for the
// section heading while the registrant's SGML header carries the current
// registered name, `... ETF`; the dictionary row itself comes from the CIK's
// 2018 filing, by which date the header spelling had settled. The corpus sees
// the same registrant, the same CIK, the same ticker and the same 19-series
// header in both places.
//
// WHAT A FIX MUST NOT DO. Widening normalizeSeriesName to drop `Fund`/`ETF`
// globally is the wrong shape and the doc comment at header.go:239-261 already
// says why -- `First Trust Europe AlphaDEX Fund` (S000031796) and a
// hypothetical `First Trust Europe AlphaDEX ETF` must stay distinct wherever
// both are declared. The evidence this filing adds is narrower: a banner that
// resolves to nothing, differing from exactly one declared series of the
// filing's own header by exactly the generic suffix noun, with no other declared
// series within that distance, is that series. Collision withdraws the claim.
//
// THE ASSERTION BELOW IS FIX-DIRECTION-AGNOSTIC. It reads only series_id, never
// fund_name -- keeping the printed banner text as the emitted fund_name while
// stamping S000047035 is a perfectly good fix, and so is rewriting it to the
// declared name.
func TestFamilyNS1510337EurozoneETFFundSuffix(t *testing.T) {
	const (
		fixture = "eurozone_2015_etf_fund_suffix.txt"
		// The one banner the body prints, verbatim from source line 308.
		banner = "First Trust Eurozone AlphaDEX(R) Fund"
		// The one series of the 19 declared that it names.
		wantID = "S000047035"
		// MEASURED, not derived from the printed item count. The fixture's three
		// meetings print 1 + 3 + 5 = 9 agenda items, and parseTwoBand emits 2 of
		// them: `inItem = false` at layout_twoband.go:180 closes the item table on
		// the first line that is not a whole vote row, and both of the shapes that
		// trip it appear here -- the wrapped AGENDA ITEM continuation at source
		// lines 324-326 (which drops meeting 2's items 2 and 3) and the
		// blank-MGMT-REC/VOTE-CAST item at source line 335 (which drops all five
		// of meeting 3's). Those are DIFFERENT defects of this layout, not this
		// one, and this test deliberately does not assert them: widening the count
		// here would make a red bar ambiguous between the suffix fold and the row
		// reader. The guard is a fixture tripwire only -- it says the cut still
		// reaches parseTwoBand and still yields the rows the assertion below is
		// about.
		wantRows = 2
	)

	rows := ns1510337EurozoneDispatch(t, fixture, "dict.tsv", "twoband", wantRows)

	// THE DEFECT. One banner, one candidate series, so every row resolves or
	// none does.
	bad := 0
	var first VoteRow
	for _, r := range rows {
		if r.SeriesID == wantID {
			continue
		}
		if bad == 0 {
			first = r
		}
		bad++
	}
	if bad > 0 {
		t.Errorf("%d of %d rows do not carry series_id %q; the first is issuer=%q cusip=%q meeting=%q item=%q series_id=%q fund=%q.\n"+
			"  The body prints exactly one fund banner, %q (source line 308), and the filing's own SGML header declares %s as %q -- the only one of its 19 declared series naming Eurozone.\n"+
			"  normalizeSeriesName folds the (R) but not the trailing generic noun, so FIRST TRUST EUROZONE ALPHADEX FUND never meets FIRST TRUST EUROZONE ALPHADEX ETF and twoband falls through.",
			bad, len(rows), wantID, first.IssuerName, first.CUSIP, first.MeetingDate, first.ItemSeq, first.SeriesID, first.FundName, banner, wantID, "First Trust Eurozone AlphaDEX ETF")
	}
}
