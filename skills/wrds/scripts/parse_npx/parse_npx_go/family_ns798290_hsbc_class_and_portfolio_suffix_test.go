package main

import (
	"path/filepath"
	"testing"
)

const ns798290HSBCDir = "family_ns798290_hsbc_class_and_portfolio_suffix"

// ns798290HSBCDispatch runs the fixture through the same top-level entry point
// production uses -- processFile, which sniffs the layout itself -- with the
// CIK's real cik_series.tsv rows loaded and no overlay, so nothing below depends
// on a hand-built FilingMeta or a hand-picked reader.
func ns798290HSBCDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns798290HSBCDir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns798290HSBCDir, fixture), sink, make([]byte, headBytes))
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

// 000079/798290/0001206774-21-002147.txt (HSBC FUNDS, CIK 798290, period
// 20210630, manifest layout `issnpx`): 585 of the filing's rows carry no
// series_id, and every one of them is stamped with the same fund_name, the
// banner text `HSBC Opportunity Fund (Class A, C & I Shares) and Portfolio`.
// That one banner is the whole of this CIK's known-registrant no_series residue
// in scope (period >= 20060101) -- ns_lost_report.py --rank puts CIK 798290 at
// 585 rows across 1 filing, and the ballot rows between the banner at source
// line 360 and the next real banner (`HSBC Strategic Income Fund`, source line
// 1876) are exactly those 585.
//
// EVERY OTHER BANNER IN THE BODY RESOLVES, BECAUSE EVERY OTHER BANNER IS A
// DECLARED NAME PRINTED VERBATIM. The `<pre>` block prints seven fund banners
// as a rule of `=` with the fund name centred inside it, and six of them carry
// no proxy voting activity at all (`There is no proxy voting activity for the
// fund, ...`) and so emit no rows:
//
//	HSBC High Yield Fund                    source line  353   0 rows (no activity)
//	HSBC Opportunity Fund (Class A, C & I
//	  Shares) and Portfolio                 source line  360   585 rows, blank
//	HSBC Strategic Income Fund              source line 1876   0 rows (no activity)
//	HSBC U.S. Government Money Market Fund  source line 1882   0 rows (no activity)
//	HSBC U.S. Treasury Money Market Fund    source line 1888   0 rows (no activity)
//	HSBC Ultra Short Bond Fund              source line 1894   0 rows (no activity)
//	HSBC ESG Prime Money Market Fund        source line 1900   0 rows (no activity)
//
// So this is not a layout that fails to read banners, and it is not a filing
// whose header is missing. It is one banner whose spelling no rung of the issnpx
// resolution chain reaches.
//
// AND THE FILING'S OWN HEADER NAMES IT. The SGML
// <SERIES-AND-CLASSES-CONTRACTS-DATA> block declares nine series for this
// registrant (fixture source lines 53-247), three of which spell Opportunity:
//
//	<SERIES-ID>S000005038   <SERIES-NAME>HSBC Opportunity Fund
//	                        <CLASS-CONTRACT-NAME>A Shares  (C000013749)
//	                        <CLASS-CONTRACT-NAME>C Shares  (C000013751)
//	<SERIES-ID>S000053727   <SERIES-NAME>HSBC Opportunity Fund Class I
//	<SERIES-ID>S000055061   <SERIES-NAME>HSBC Opportunity Portfolio
//
// THE BANNER IS THE DECLARED NAME WITH A SHARE-CLASS PARENTHETICAL AND A TIER
// CONJUNCT HUNG OFF THE END OF IT:
//
//	banner    HSBC Opportunity Fund | (Class A, C & I Shares) | and Portfolio
//	declared  HSBC Opportunity Fund
//
// The registrant votes one book of proxies for the retail fund, its Class I
// sleeve and the master portfolio together, and the vendor prints all three in
// one banner. S000005038 is the fund the section's rows belong to; the other two
// are the sleeve and the master feeding the same book.
//
// HALF THE CUT ALREADY WORKS. Probed against the fixture with the real dict
// loaded, issResolveFund answers:
//
//	"HSBC Opportunity Fund (Class A, C & I Shares) and Portfolio" -> nil
//	"HSBC Opportunity Fund and Portfolio"                         -> nil
//	"HSBC Opportunity Fund (Class A, C & I Shares)"               -> S000005038
//	"HSBC Opportunity Fund"                                       -> S000005038
//
// issParenGroupCuts (layout_issnpx.go:2284), reached from the trailing-group
// rung at layout_issnpx.go:3718, already strips the share-class parenthetical
// and feeds the remainder back through the whole chain. The parenthetical is not
// the defect. The remainder `HSBC Opportunity Fund and Portfolio` is, and
// nothing in the chain reads a trailing ` and <TypeWord>` tier conjunct off a
// BANNER.
//
// WHICH RUNG REFUSES, AND WHY. The one rung shaped for a trailing `and` run is
// issDropTrailingConjunct (layout_issnpx.go:7212). It refuses twice over:
//
//   - It is DECLARATION-side. Its only call site is the index build at
//     layout_issnpx.go:1944, which registers a DECLARED name carrying `... and
//     <words> <TypeWord>` under its conjunct-free key in ix.lessConjunct (`Mid
//     Cap Value and Restructuring Fund` -> `mid cap value fund`). Here the
//     conjunct is in the banner and not in the declaration, so ix.lessConjunct
//     never holds a key that could answer.
//
//   - And applied to the banner key directly it still returns nothing. After
//     issDropTypeWord (layout_issnpx.go:8269) takes `portfolio` off, the stem is
//     `hsbc opportunity fund and` -- the `and` is its LAST token, at index
//     len(toks)-1, and the scan at layout_issnpx.go:7219 starts at
//     `i := len(toks) - 2`, so that `and` is never visited. Measured:
//
//     issDropTrailingConjunct("hsbc opportunity fund and portfolio")            = ("", false)
//     issDropTrailingConjunct("mid cap value and restructuring fund")           = ("mid cap value fund", true)
//
//     The shape the rung was written for is `A and B <Type>`, where the conjunct
//     joins two halves of one name. This banner's shape is `A <Type> and
//     <Type2>`, where the conjunct joins two TIERS of one fund, and the second
//     conjunct is the type word itself.
//
// Nothing else reaches it either: issHeadingWithinDecl (layout_issnpx.go:3029)
// refuses because `portfolio` (and `class`, `shares`) are not words S000005038's
// declaration says; issBrandCutStem (layout_issnpx.go:319) and issCutGluedBrand
// (layout_issnpx.go:2458) cut a LEADING registrant or former-conformed brand and
// this defect is a suffix; issBrandPrefixGenericSuffixSeries
// (layout_issnpx.go:2972), the chain's last rung, strips exactly one leading
// token and one trailing token and cannot reach across ` and `.
//
// The banner therefore resolves to nothing, issnpx falls through, and the 585
// rows are emitted with a blank series_id and the printed banner text as
// fund_name.
//
// THE FIX A LATER CHANGE SHOULD IMPLEMENT: a filing-scoped, suffix-only tier
// conjunct cut. A banner that resolves to nothing and that, after dropping a
// trailing ` and <TypeWord>` run, is spelled exactly as one series the filing's
// OWN header declares, is that series -- provided the remainder is two tokens or
// more and no second declared series answers it. The evidence must come from the
// filing's own <SERIES-AND-CLASSES-CONTRACTS-DATA> block, never the corpus
// dictionary and never a sibling CIK, for the same reason tbGenericTypeNounSeries
// (layout_twoband.go) and issBrandPrefixGenericSuffixSeries are scoped that way:
// folding a tier word globally would merge genuinely distinct registered series
// elsewhere in the corpus -- and this very registrant declares both `HSBC
// Opportunity Fund` and `HSBC Opportunity Portfolio`, so the cut must land on
// the remainder BEFORE the conjunct and never on the conjunct's own tier.
//
// THE FIXTURE. Built verbatim from the real filing bytes, no line rewritten:
//
//	full source lines    1- 352  the complete SGML header, including the whole
//	                             <SERIES-AND-CLASSES-CONTRACTS-DATA> block
//	                             (lines 53-247) and the HTML cover page
//	full source line   353       `<pre>` open + the HSBC High Yield Fund banner
//	full source lines  354- 359  its no-activity paragraph and blank lines
//	full source line   360       THE BANNER
//	full source lines  361- 404  the section's first TWO real meetings --
//	                             ACCELERON PHARMA INC. (JUN 16 2021 annual,
//	                             items 1a/1b/1c/2/3/4) and ADVANCED DRAINAGE
//	                             SYSTEMS, INC. (JUL 23 2020 annual, items
//	                             1a-1e/2/3/4/5) -- cut at the real
//	                             `-----` meeting boundary at line 404
//	full source lines 1908-1995  the file's own `========== END NPX REPORT`
//	                             marker, `</pre>`, and the closing HTML/SGML
//	                             tags, so processFile sniffs a complete,
//	                             well-formed issnpx document
//
// Fixture line numbers 1-404 are the full filing's own line numbers unchanged;
// the banner is at fixture line 360 as well. The cut yields 15 rows (6 + 9),
// MEASURED by dispatching the fixture, not derived.
//
// THE ASSERTION BELOW IS FIX-DIRECTION-AGNOSTIC. It reads only series_id, never
// fund_name -- keeping the printed banner text as the emitted fund_name while
// stamping S000005038 is a perfectly good fix, and so is rewriting it to the
// declared name.
func TestFamilyNS798290HSBCClassAndPortfolioSuffix(t *testing.T) {
	const (
		fixture = "hsbc_opportunity_class_and_portfolio_2021.txt"
		// The banner, verbatim from fixture source line 360 (which is also full
		// source line 360), inner text only, with the file's `&amp;` entity
		// resolved the way the reader resolves it.
		banner = "HSBC Opportunity Fund (Class A, C & I Shares) and Portfolio"
		// The one of the filing's nine declared series whose rows these are.
		wantID = "S000005038"
		// MEASURED on the fixture, not derived: ACCELERON PHARMA INC. yields 6
		// rows and ADVANCED DRAINAGE SYSTEMS, INC. yields 9. The guard is a
		// fixture tripwire only -- it says the cut still sniffs as issnpx and
		// still yields the rows the assertion below is about.
		wantRows = 15
	)

	rows := ns798290HSBCDispatch(t, fixture, "dict.tsv", "issnpx", wantRows)

	// THE DEFECT. One banner owns every row of this section, and the filing's
	// own header declares the fund it names, so every row resolves or none does.
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
			"  The section banner is %q (fixture source line 360) and the filing's own SGML header declares %s as %q.\n"+
			"  issParenGroupCuts already strips the share-class parenthetical and `HSBC Opportunity Fund` alone resolves to %s; what refuses is the trailing tier conjunct ` and Portfolio`. issDropTrailingConjunct (layout_issnpx.go:7212) is declaration-side (indexed at layout_issnpx.go:1944) and, applied to the banner key directly, returns (\"\", false) because after issDropTypeWord removes `portfolio` the `and` is the stem's last token and the scan at layout_issnpx.go:7219 starts at len(toks)-2. A filing-scoped, suffix-only ` and <TypeWord>` cut is the reach this filing calls for.",
			bad, len(rows), wantID, first.IssuerName, first.CUSIP, first.MeetingDate, first.ItemSeq, first.SeriesID, first.FundName, banner, wantID, "HSBC Opportunity Fund", wantID)
	}
}
