package main

import (
	"path/filepath"
	"testing"
)

// familyMislinkAvantisDispatch runs the real dispatch on the family
// MISLINK-AVANTIS fixture with NO dictionary and no series-map overlay -- the
// filing declares all 41 of its series in its own header, so the index this
// test exercises is the filing's own -- and asserts the fixture's own
// preconditions (status, layout and row count), so a failure below is an
// assertion about the series id and never a broken fixture.
func familyMislinkAvantisDispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink_avantis", fixture), sink, make([]byte, headBytes))
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

// 000171/1710607/0001710607-22-000173.txt: verbatim source lines 1-513 (the SEC
// document opener, the whole SGML header including all 41 <SERIES-ID>/
// <SERIES-NAME> declarations, and the document's <TYPE>/<TEXT>/<html>/<body>
// opener), 516-518 (the FORM N-PX title and the registrant/reporting-period
// lines), 931906-931944 plus 932057 (the bare `Avantis International Equity`
// banner and the head of the 1&1 AG block under it, with the interior vote rows
// of that block trimmed and the block's own closing `</table>` kept),
// 1326710-1326748 plus 1326861 (the same for the `Avantis International Equity
// ETF` banner, whose first block is the same 1&1 AG meeting), and the filing's
// own last four lines 3045945-3045948. Every byte is verbatim; only whole lines
// were dropped. Source lines 931906-931944 and 1326710-1326748 are byte-identical
// to each other except for the banner line itself.
//
// American Century ETF Trust, CIK 1710607, period 20220630, layout `htmltable`.
// The registrant declares, in this one header, a sibling PAIR that differs only
// in its trailing product-type word:
//
//	<SERIES-ID>S000066456	<SERIES-NAME>Avantis International Equity ETF   (source lines 142-143)
//	<SERIES-ID>S000066463	<SERIES-NAME>Avantis International Equity Fund  (source lines 227-228)
//
// and it prints TWO separate vote-summary sections for them, both as
// `<br style='page-break-after:always;'><p align='center'>...</p>` banners that
// `htmlBareFundLine` (layout_htmltable.go:5796) reads:
//
//	source line  931906  Avantis International Equity       <- the Fund, S000066463
//	source line 1326710  Avantis International Equity ETF   <- the ETF,  S000066456
//
// The current tree stamps S000066456 on BOTH. Parsed whole, the real filing
// yields `Avantis International Equity || S000066456` for 44,661 rows beside
// `Avantis International Equity ETF || S000066456` for 51,541 -- the Fund's
// votes moved onto the ETF, which is worse than leaving them blank. None of the
// five Fund-side ids (S000066455, S000066460, S000066461, S000066462,
// S000066463) carries a single row of that filing.
//
// THE RUNG IS PROBED, not judged by eye. On the index this filing builds from
// its own 41 header declarations, `issResolveFund` answers
// `Avantis International Equity` -> S000066456, and the rung that answers is the
// COMMON-SUFFIX drop -- `layout_issnpx.go:3662-3666`, the inline
//
//	// The last word every declared name shares, missing from the banner.
//	if ix.lessSuffix != nil {
//		if d, seen := ix.lessSuffix[key]; seen {
//			return banner, d
//		}
//
// step of `issResolveFundUncached`. Measured on that index:
//
//	ix.commonSuffix = "etf"
//	ix.lessSuffix["avantis international equity"] -> S000066456 "Avantis International Equity ETF"
//
// The index is built at `layout_issnpx.go:1891-1903` from `issCommonLastWord`
// (`layout_issnpx.go:1954`): 32 of this registrant's 41 declared names end in
// `ETF`, which clears that function's two-thirds bar, so every declared name is
// ALSO keyed with a trailing ` etf` removed. Every other named single-argument
// rung was probed against this key on this index -- `issSplicedDecl`,
// `issUniqueNamePrefix`, `issSleeveStemDecl`, `issDistinctiveStemDecl`,
// `issLeadingStemDecl` and the 23 others -- and all returned nil, and the
// icr-side chain (`icrResolveFundVintage`, `icrResolveDeclaredSuffix`,
// `icrResolveQualified`) returns "" for this key, so `icrResolveFundShared`
// reaches its `issResolveFund` call and the whole defect is this one map lookup.
//
// Dropping a generic trailing word is the point of the rung, and the word
// dropped here is generic. What the rung is missing is the mirror guard: `put`
// into `ix.lessSuffix` only ever sees ONE claimant for
// `avantis international equity`, because `strings.CutSuffix(key, " etf")` fires
// on `Avantis International Equity ETF` and CANNOT fire on `Avantis
// International Equity Fund`, so the collision that would have made the map
// entry refuse is never recorded. There is no equivalent here of the
// `issSizeDiscriminator`/`issStyleDiscriminator` evidence the splice rung reads:
// nothing asks whether the registrant declares a SIBLING series that is this
// same stem plus a DIFFERENT trailing word, which is precisely the evidence that
// the bare banner is that sibling's and not the suffixed one's. The standing
// safety argument on `issCommonLastWord` -- "a series declared WITHOUT the word
// is found by the exact reading before this index is consulted" -- holds only
// for a banner spelled exactly as that series is declared; it does not reach a
// banner printed as the bare STEM, which is exactly what this registrant prints.
//
// The same registrant repeats the shape across five pairs in this one filing
// (S000066454/S000066462 Emerging Markets Equity, S000066456/S000066463
// International Equity, S000066457/S000066455 International Small Cap Value,
// S000066458/S000066460 U.S. Equity, S000066459/S000066461 U.S. Small Cap
// Value) -- each keyed into `lessSuffix` by the ETF half alone, and each printed
// by the filing as a bare-stem section beside an exact `... ETF` section -- and
// across six filings (0001710607-20-000175, -20-000178, -21-000098,
// -22-000173, -23-000209).
//
// Fix location: `layout_issnpx.go:1891-1903` (refuse the `lessSuffix` key when
// another declared series answers to the same stem under a different trailing
// word), or equivalently the consulting rung at `layout_issnpx.go:3663`. The
// sibling section asserted below is measured on the same dispatch: the banner
// `Avantis International Equity ETF` equals a declared name exactly, the exact
// lookup answers it before any suffix rung is reached, and it must keep its id.
func TestFamilyMislinkAvantisInternationalEquityBareBanner(t *testing.T) {
	rows := familyMislinkAvantisDispatch(t, "avantis_intl_equity.txt", "htmltable", 4)
	var bare, etf int
	for _, r := range rows {
		switch r.FundName {
		case "Avantis International Equity":
			bare++
			if r.SeriesID != "S000066463" {
				t.Errorf("the bare banner is the FUND's section: the registrant declares `Avantis International Equity Fund` (S000066463) and `Avantis International Equity ETF` (S000066456) in the same header and prints a separate section for each, and the suffixed one has its own banner at source line 1326710, so dropping the registrant's dominant `ETF` suffix here moves the Fund's votes onto the ETF: issuer=%q cusip=%q date=%q desc=%q series=%q want S000066463",
					r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
			}
		case "Avantis International Equity ETF":
			etf++
			if r.SeriesID != "S000066456" {
				t.Errorf("the sibling banner equals a declared name exactly, so it must keep its id: issuer=%q series=%q want S000066456", r.IssuerName, r.SeriesID)
			}
		default:
			t.Errorf("unexpected section %q (series %q)", r.FundName, r.SeriesID)
		}
	}
	if bare != 2 || etf != 2 {
		t.Fatalf("fixture sections: bare=%d etf=%d want 2/2", bare, etf)
	}
}
