package main

import (
	"path/filepath"
	"testing"
)

const ns1411903JavelinDir = "family_ns1411903_javelin_jets_dash"

// ns1411903JavelinDispatch runs the fixture through the same top-level entry
// point production uses -- processFile, which sniffs the layout itself -- with
// NO dictionary and NO overlay loaded, so every resolution below has to come
// from the filing's own SGML header declarations. The fixture needs nothing
// else: the two series the banners name are declared in the fixture's own
// <SERIES-AND-CLASSES-CONTRACTS-DATA> block.
func ns1411903JavelinDispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1411903JavelinDir, fixture), sink, make([]byte, headBytes))
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

// 000141/1411903/0001354488-10-002855.txt (Javelin Exchange-Traded Trust, CIK
// 1411903, period 20100630) and its sibling 0001354488-11-003288.txt (period
// 20110902) are claimed by the `proxyedge` layout -- MEASURED, not inferred from
// the banner's `==========` rules, which read like the ISS-NPX plain-text style
// but are not: the body is the Broadridge ProxyEdge ballot-detail export as
// rendered by Issuer Direct's EDGARizerAgent, one logical column per <td>, and
// the manifest records `proxyedge` for both filings. Every row of both -- 1188
// on the 2010 filing and 1120 on the 2011 -- carries a blank series_id, and
// every one of them is stamped with the same fund_name, `Javelin
// Exchange-Traded Trust`, which is the REGISTRANT's name, not a fund's.
//
// THIS IS A REGRESSION, and its cause is a commit that never touched a line the
// earlier diagnosis of this family pointed at. Binary 364 left these rows
// resolved (0/1186 blank on the 2010 filing, 19/1120 on the 2011); binary 365 --
// the first to carry e7b6d25e -- blanked them, and 7d168ae5, which rewrote
// peClauseNumber's enumerator test into peEnumerator, did not recover them
// (still 1188/1188 blank at HEAD). peClauseNumber is not the gate that fires
// here. e7b6d25e also introduced peBallotProse and the two constants it opens
// with, and it is the LENGTH test -- the very first line of the function, before
// any enumerator or punctuation test is reached -- that refuses both of this
// filing's banners.
//
// THE BANNERS. The body prints one per fund section, centered between two rule
// runs the vendor spells as literal equals signs, inside the vote table's own
// flow. After stripHTMLCells each arrives as ONE whole cell on ONE line,
// verbatim (fixture source lines 210-212 and 390, `–` being an em dash, originally
// the entity &#8211;):
//
//	========== Javelin Exchange-Traded Trust – JETS Contrarian Opportunities Index Fund ==========
//	========== Javelin Exchange-Traded Trust – JETS Dow Jones Islamic Market International Index Fund ==========
//
// Each names the registrant, then an em dash, then one of the two series the
// filing's own SGML header declares (fixture source lines 45-55):
//
//	<SERIES-ID>S000025052
//	<SERIES-NAME>JETS(SM) Dow Jones Islamic Market International Index Fund
//	<SERIES-ID>S000028148
//	<SERIES-NAME>JETS(SM) Contrarian Opportunities Index Fund
//
// THE RESOLUTION CHAIN ALREADY HANDLES THIS SHAPE, RULES AND ALL. Asked
// directly, icrResolveFundShared over the index issFilingIndex builds from this
// filing's own header returns S000028148 for the first banner line and
// S000025052 for the second -- both with the `==========` runs still attached,
// both with `(SM)` present on the declared side and absent on the printed side.
// normalizeSeriesName folds the service mark, and the registrant-prefix strip
// (issBrandCutStem / lookupSeriesStrippingRegistrant, reached from issResolveFund)
// cuts `Javelin Exchange-Traded Trust –`. Nothing in the resolver is missing.
//
// WHERE IT DIES. parseProxyEdge's bare-heading scan (layout_proxyedge.go:1120)
// only reaches the resolver if peFundName says the line names a fund, and
// peFundName asks peBallotProse first:
//
//	layout_proxyedge.go:566  func peFundName(s string) bool {
//	layout_proxyedge.go:567    if peBallotProse(s) {
//	layout_proxyedge.go:568      return false
//
//	layout_proxyedge.go:586    peHeadingRunes = 90
//	layout_proxyedge.go:587    peHeadingWords = 14
//	layout_proxyedge.go:606    if len([]rune(s)) > peHeadingRunes || len(strings.Fields(s)) > peHeadingWords {
//	layout_proxyedge.go:607      return true
//
// MEASURED on the two lines above: the Contrarian banner is 94 runes / 11 words
// and the Islamic one is 108 runes / 14 words. Both exceed peHeadingRunes = 90,
// so peBallotProse returns true on its first test, peFundName returns false, and
// the banner is discarded as a ballot's own resolution text. The word test is
// not what fires -- 14 is not > 14 -- and neither is the `;"` clause test nor
// peClauseNumber, which is why replacing peClauseNumber's logic changed nothing
// here.
//
// AND THE LENGTH IS THE VENDOR'S, NOT THE FUND'S. The two rule runs cost 22
// runes of the 94 and 108 (`========== ` and ` ==========`), and the registrant
// prefix the resolver is built to cut costs another 32 (`Javelin
// Exchange-Traded Trust – `). The NAME inside is 44 and 58 runes, comfortably
// inside the 90-rune budget peHeadingRunes was chosen for. The gate is measuring
// the banner's decoration and its registrant prefix and charging them against a
// limit set for the fund name alone.
//
// WHY THE ROWS STILL CARRY A FUND NAME. With both banners refused, the last
// thing the scan accepted is the cover page's own masthead line, `Javelin
// Exchange-Traded Trust` (fixture source line 206, 29 runes, and `TRUST`
// satisfies peFundWord), so `fund` holds the registrant's name and `fundSeries`
// holds the empty string icrResolveFundShared returns for it. Every row after it
// is stamped with that pair. The blank is not a resolver miss on the fund it
// names -- it is the wrong heading having been accepted.
//
// WHAT A FIX MUST NOT DO. Raising peHeadingRunes outright is the wrong shape:
// e7b6d25e added the limit because a foreign ballot's resolution paragraph
// (CapitaLand Mall Trust's general mandate, one 2.4 KB cell containing `THE
// TRUST DEED DATED 29 OCTOBER 2001`) satisfies peFundWord and, taken for a
// banner, blanks every row after it. The evidence this filing adds is narrower:
// the length being measured includes decoration the resolver strips anyway. A
// fix that measures the candidate NAME -- after the rule runs are cut, or after
// the registrant prefix is -- refuses the 2.4 KB paragraph exactly as before.
//
// THE ASSERTIONS BELOW ARE FIX-DIRECTION-AGNOSTIC. They read only series_id,
// never fund_name: keeping the printed banner text (rules and all) as the
// emitted fund_name while stamping the right series is a perfectly good fix, and
// so is rewriting fund_name to the declared name.
func TestFamilyNS1411903JavelinJETSDashBanner(t *testing.T) {
	const (
		fixture = "javelin_2010_jets_dash_banner.txt"
		// The two banners the body prints, verbatim from fixture source lines
		// 210-212 and 390 as they arrive after stripHTMLCells.
		contrarianBanner = "========== Javelin Exchange-Traded Trust – JETS Contrarian Opportunities Index Fund =========="
		islamicBanner    = "========== Javelin Exchange-Traded Trust – JETS Dow Jones Islamic Market International Index Fund =========="
		contrarianID     = "S000028148"
		islamicID        = "S000025052"
		// MEASURED. The fixture keeps the first ballot of the Contrarian section
		// (ANGLOGOLD ASHANTI, 1 agenda item) and the first ballot of the Islamic
		// section (SCOTTISH AND SOUTHERN ENERGY, the first 2 of its items), so
		// parseProxyEdge emits 1 + 2 = 3 rows. This is a fixture tripwire only:
		// it says the cut still reaches parseProxyEdge with one ballot under
		// each of the two banners.
		wantRows = 3
	)

	rows := ns1411903JavelinDispatch(t, fixture, "proxyedge", wantRows)

	// Which banner owns a row is told by its issuer, since each section keeps
	// exactly one ballot. ANGLOGOLD sits under the Contrarian banner; SCOTTISH
	// AND SOUTHERN sits under the Islamic one.
	want := map[string]struct {
		id     string
		banner string
	}{
		"ANGLOGOLD ASHANTI LIMITED":               {contrarianID, contrarianBanner},
		"SCOTTISH AND SOUTHERN ENERGY PLC, PERTH": {islamicID, islamicBanner},
	}

	for _, r := range rows {
		w, ok := want[r.IssuerName]
		if !ok {
			t.Fatalf("fixture drift: unexpected issuer %q (cusip=%q meeting=%q item=%q)", r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq)
		}
		if r.SeriesID == w.id {
			continue
		}
		t.Errorf("issuer=%q cusip=%q meeting=%q item=%q carries series_id=%q fund=%q; want %s.\n"+
			"  The section's banner is %q, and the filing's own SGML header declares %s under this CIK.\n"+
			"  peBallotProse (layout_proxyedge.go:606) refuses that line on its length -- %d runes against peHeadingRunes=90 -- so peFundName (layout_proxyedge.go:567) never lets the bare-heading scan reach the resolver, which resolves the line correctly when asked. 22 of those runes are the vendor's ========== rules and 32 are the registrant prefix the resolver strips anyway.",
			r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq, r.SeriesID, r.FundName, w.id, w.banner, w.id, len([]rune(w.banner)))
	}
}
