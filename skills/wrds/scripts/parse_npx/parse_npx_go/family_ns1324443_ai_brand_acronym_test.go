package main

import (
	"path/filepath"
	"testing"
)

const ns1324443AmIndepDir = "family_ns1324443_ai_brand_acronym"

// ns1324443AmIndepDispatch runs the real dispatch on a fixture in this family's
// testdata dir with the named dictionary loaded, asserting the fixture's own
// preconditions -- status, layout, row count -- so a failure in the body of the
// test below is an assertion about the fund each row was filed under and never a
// broken fixture. Same mechanism as ns1039803ProFundsDispatch, pointed at its own
// testdata dir.
func ns1324443AmIndepDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns1324443AmIndepDir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1324443AmIndepDir, fixture), sink, make([]byte, headBytes))
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

// American Independence Funds Trust, CIK 0001324443, filing
// 000132/1324443/0001438934-16-000780.txt (period 20160630, layout `broadridge`
// -- the filing's own document is named BRDTY2_0001324443_2016.txt and the
// dispatch reads it as broadridge, not issnpx).
//
// Every vote-table banner in this filing abbreviates the registrant's own BRAND
// -- the first two words of `American Independence Funds Trust` -- down to the
// two-letter token `AI`: `AI Hillcrest Small Cap Value Fund`, `AI Navellier
// International Fund`, `AI Kansas Tax-Exempt Bond Fund`, `AI Navellier Large Cap
// Growth Fund`, `AI U.S. Inflation-Protected Fund`, `AI Boyd Watterson Core Plus
// Fund`, `AI JAForlines Risk-Managed Allocation Fund`. The abbreviation is the
// registrant's own, not a guess: this same CIK's dictionary rows at the NEXT
// vintage print it themselves -- `AI International Fund` (S000011459, 20170630)
// and `AI Large Cap Growth Fund` (S000050130, 20170630), both in dict.tsv.
//
// Most of those banners resolve on HEAD, and they resolve because the filing's
// own SEC-HEADER declares their series, which is a route that never has to read
// the abbreviated spelling. Running HEAD over the whole real filing (1279 rows)
// attributes:
//
//	  7  S000011460  American Independence Boyd Watterson Short-Term Enhanced Bond Fund
//	  7  S000011462  AI Kansas Tax-Exempt Bond Fund
//	298  S000011459  AI Navellier International Fund
//	365  S000050130  AI Navellier Large Cap Growth Fund
//	  7  S000021676  AI U.S. Inflation-Protected Fund
//	370  (blank)     AI Hillcrest Small Cap Value Fund
//	225  (blank)     Rx Dynamic Stock Fund
//
// ROOT CAUSE, read off the real bytes. `AI Hillcrest Small Cap Value Fund` is the
// one abbreviated banner whose series the header does NOT declare, so it can only
// be answered through the dictionary -- and the dictionary rung that exists for
// exactly this shape cannot read a two-letter brand acronym. The dictionary knows
// the fund under its spelled-out name (dict.tsv line 53, the only row of this
// CIK's 53 that carries the token `Hillcrest`):
//
//	0001324443  S000052272  American Independence Hillcrest Small Cap Value Fund  20170630
//
// and the rung chain resolves that spelling on this very filing's fallback.
// Measured directly against cikDict.exactFallback for this filing's meta:
//
//	"American Independence Hillcrest Small Cap Value Fund"  -> "S000052272"
//	"AI Hillcrest Small Cap Value Fund"                     -> ""
//	"Hillcrest Small Cap Value Fund"                        -> ""
//
// The acronym rung is acronymForBrand (cik_series.go:671), which gates on
// issRegistrantAcronym (layout_issnpx.go:7816). That predicate requires the token
// to spell the registrant's every WORD in order and checks
// `len(tok) != len(reg)`: registrantKey `american independence funds trust` is
// FOUR words, so it demands a four-letter `aift`, and the two-letter `ai` fails
// that check -- and the `len(tok) < 3` clause besides. Measured:
//
//	issRegistrantAcronym("ai", "american independence funds trust") = false
//	acronymForBrand("AI Hillcrest Small Cap Value Fund")            = nil
//
// issCutBrandBeforeAcronym (layout_issnpx.go:7832) calls the same predicate and
// fails the same way. The generic entity words the brand does not include
// (`Funds Trust`) are exactly what makes a full-registrant-name acronym the wrong
// shape here: `AI` stands for the BRAND, the leading words before the entity-type
// suffix.
//
// And cutting the token is not by itself enough, which is why the third probe
// line above is also blank. brandPrefixed cannot restore what came off, because
// the brand prefix this dictionary yields carries the entity word too -- measured
// on the same fallback, `brandPrefixes = [american independence funds]`, so
// prepending it gives `american independence funds hillcrest small cap value
// fund`, no row of this CIK. A rung that reads this banner has to restore the
// registrant's BRAND (`american independence`) rather than a dictionary-derived
// prefix.
//
// DISAMBIGUATION, against the same CIK's whole dictionary. Exactly one of the 53
// rows in dict.tsv carries the token `Hillcrest`, and it is S000052272's. No
// other series of this CIK at any vintage carries it. So a rung that cuts `AI`
// and restores the brand cannot pick the wrong series on this banner.
//
// FIXTURE. ai2016_hillcrest_small_cap_value.txt is three verbatim slices of the
// real filing, concatenated with nothing synthesised and nothing edited (md5
// 645ac9651ce6cd1c9aee61d69c9e25a8, byte-identical to the same sed recipe run on
// WRDS over /wrds/sec/archives/000132/1324443/0001438934-16-000780.txt):
//
//	sed -n -e '1,230p' -e '236,266p' -e '5789,5811p'
//
//	1-230        the <SEC-DOCUMENT> opener, the whole SEC-HEADER including the
//	             SERIES-AND-CLASSES-CONTRACTS-DATA block declaring all seven
//	             series the header knows (S000052272 is NOT among them -- that is
//	             the point), the N-PX masthead naming the registrant, <PAGE>, the
//	             single <TABLE> the whole report is printed inside and its
//	             <S>/<C> column ruler -- ending immediately before the filing's
//	             FIRST banner, so the dead silent-banner sleeve `AI Boyd Watterson
//	             Core Plus Fund` (raw lines 231-235) is excluded entirely and the
//	             only fund section in the fixture is the one under test
//	236-266      the blank line before it, the `AI Hillcrest Small Cap Value Fund`
//	             banner at raw 237, the ABM INDUSTRIES INCORPORATED meeting
//	             printed under it (agenda 934326592, security 000957100, ticker
//	             ABM, annual meeting 09-Mar-2016) and its four ballots -- item 1
//	             DIRECTOR with its three named nominees, then items 2, 3 and 4
//	5789-5811    the filing's own `* Management position unknown` footnote,
//	             </TABLE>, <PAGE>, the SIGNATURES block, and the </TEXT>
//	             </DOCUMENT> </SEC-DOCUMENT> closers
//
// dict.tsv is all 53 real cik_series.tsv rows for this CIK, verbatim from
// /scratch/nyu/eddyhu/npx-reconcile-corpus/cik_series.tsv (md5
// 5cb342183427d4693446d0abda766e8d) -- every rename at every vintage included, so
// nothing below is made unambiguous by hiding a spelling.
//
// This test is RED on HEAD: no rung recognises a brand-only acronym, so all six
// rows come back with a blank series_id.
func TestFamilyNS1324443AIBrandAcronym(t *testing.T) {
	rows := ns1324443AmIndepDispatch(t, "ai2016_hillcrest_small_cap_value.txt", "dict.tsv", "broadridge", 6)

	// The dictionary declares American Independence Hillcrest Small Cap Value
	// Fund as S000052272, and the banner over these rows is that name with the
	// brand `American Independence` abbreviated to `AI`. Every row of the section
	// must carry that series.
	const hillcrest = "S000052272"
	seen := 0
	for i, r := range rows {
		if r.IssuerName != "ABM INDUSTRIES INCORPORATED" || r.CUSIP != "000957100" || r.MeetingDate != "20160309" {
			t.Errorf("row %d: the fixture's own identity block has moved: issuer=%q cusip=%q date=%q want %q / %q / %q",
				i+1, r.IssuerName, r.CUSIP, r.MeetingDate, "ABM INDUSTRIES INCORPORATED", "000957100", "20160309")
			continue
		}
		seen++
		if r.SeriesID != hillcrest {
			t.Errorf("row %d (cusip %s meeting %s item %q): the banner `AI Hillcrest Small Cap Value Fund` abbreviates this registrant's brand `American Independence` to `AI`, and no rung reads a brand-only acronym, so the row lost its series: series=%q fund=%q want %q",
				i+1, r.CUSIP, r.MeetingDate, r.ItemSeq, r.SeriesID, r.FundName, hillcrest)
		}
	}
	if seen != 6 {
		t.Errorf("the fixture's own ABM INDUSTRIES block has moved: found %d rows at cusip 000957100 / meeting 20160309, want 6", seen)
	}
}
