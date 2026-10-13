package main

import (
	"path/filepath"
	"testing"
)

const ns1018593PhoenixDir = "family_ns1018593_phoenix_overseas_bare_banner"

// ns1018593PhoenixDispatch runs the fixture through the same top-level entry
// point production uses -- processFile, which sniffs the layout itself -- with
// the CIK's real cik_series.tsv rows loaded and no overlay, so nothing below
// depends on a hand-built FilingMeta or a hand-picked reader.
func ns1018593PhoenixDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns1018593PhoenixDir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1018593PhoenixDir, fixture), sink, make([]byte, headBytes))
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

// 000101/1018593/0000950123-06-010887.txt (PHOENIX ASSET TRUST, CIK 1018593,
// period 20060630, manifest layout `issnpx`): the filing's first section banner
// prints the shared brand token and nothing else --
//
//	=================================== PHOENIX ====================================
//
// -- and every ballot row of the vote table under it carries a blank series_id.
// Those rows are the whole of this CIK's known-registrant no_series residue:
// ns_lost_report.py --rank puts CIK 1018593 at 562 rows across 1 filing, which
// is the ADVANCED MICRO DEVICES ballot printed beneath that one bare banner.
//
// THE BARE BRAND TOKEN IS NOT A FUND NAME. The filing's SGML
// <SERIES-AND-CLASSES-CONTRACTS-DATA> block (fixture source lines 62-155)
// declares exactly five series, and every one of them begins with PHOENIX:
//
//	S000001373  PHOENIX RISING DIVIDENDS FUND
//	S000001374  PHOENIX SMALL-MID CAP FUND
//	S000001375  PHOENIX OVERSEAS FUND
//	S000001376  PHOENIX INTERMEDIATE BOND FUND
//	S000001377  PHOENIX CA INTERMEDIATE TAX-FREE BOND FUND
//
// So `PHOENIX` on its own is the registrant's brand prefix, shared by all five
// declarations and distinguishing none of them. No heading-resolution rung of
// the issnpx chain can match it to a series by spelling: a prefix common to
// five candidates is ambiguous five ways, and the rungs that resolve on a
// shared lead (issBrandCutStem, issHeadingWithinDecl) all require a residual
// stem after the brand cut, of which this banner has none. The banner resolves
// to nothing, issnpx falls through, and its rows are emitted with a blank
// series_id and the printed banner text `PHOENIX` as fund_name.
//
// BUT THE FILING'S OTHER FOUR BANNERS CLOSE THE ELIMINATION. The body prints
// five `=`-ruled section banners and no more (fixture source lines 184, 200,
// 205, 210, 226):
//
//	line 184  PHOENIX                                              <- bare, blank
//	line 200  PHOENIX CALIFORNIA INTERMEDIATE TAX-FREE BOND FUND   -> S000001377
//	line 205  PHOENIX INTERMEDIATE BOND FUND                       -> S000001376
//	line 210  PHOENIX RISING DIVIDENDS                             -> S000001373
//	line 226  PHOENIX SMALL-MID CAP FUND                           -> S000001374
//
// Four of the five declared series are therefore each named by a banner of
// their own somewhere in this filing. (Banners 2 and 3 are followed by no vote
// table at all -- the two funds cast no votes in the period -- so they
// contribute no rows; their resolution is visible in the heading text, not in
// the output. Banners 4 and 5 do carry ballots and do resolve today, which the
// rows this test measures confirm.)
//
// PHOENIX OVERSEAS FUND, S000001375, is the ONE declared series that no banner
// in the filing names anywhere. By elimination the bare `PHOENIX` banner is
// that series: it is the only claim left unspoken, and the vendor's truncated
// banner simply never printed the word `OVERSEAS`. The registrant's own history
// makes the shape unsurprising -- the Overseas fund is the former
// PHOENIX-KAYNE INTERNATIONAL sleeve (the trust's FORMER CONFORMED NAME is
// PHOENIX-KAYNE FUNDS, fixture source line 55), and the series carries the only
// non-domestic mandate of the five.
//
// WHY NOTHING EXISTING FIRES. Every rung in the issnpx chain resolves a heading
// by reading the heading's own words against a candidate name -- the heading is
// a declared name, or a declared name less a brand run, or a declared name with
// a parenthetical or type noun folded. A bare shared prefix defeats all of them
// by construction, because the words it prints are true of five candidates at
// once. What settles this banner is not the heading's spelling but the SET of
// claims the rest of the filing has already made: the closed five-series
// declaration, minus the four series other banners in the same filing name,
// leaves exactly one. That is a filing-scoped bookkeeping argument, and the
// resolution chain has no rung that performs it.
//
// THE FIX A LATER CHANGE SHOULD IMPLEMENT. A section banner that reaches the
// end of the chain unresolved, and that is spelled as a pure shared prefix of
// the filing's own declarations (not a name in its own right), may be claimed by
// elimination when: the filing's declaration set is closed and small; every
// OTHER banner in the same filing resolves; and the declarations those banners
// resolve to leave exactly ONE declared series unclaimed. Exactly one residual
// candidate is the whole of the licence -- two unclaimed series, or any sibling
// banner that itself failed to resolve, withdraws the claim, since the
// bookkeeping is only sound when the books balance. Evidence must come from the
// filing's own header and its own banners, never the corpus dictionary and never
// a sibling CIK: eliminating against a dictionary that spans 2006-2019 for this
// registrant (32 rows, the Virtus-era series among them) would leave dozens of
// series unclaimed and the argument would say nothing.
//
// THE ASSERTION BELOW IS FIX-DIRECTION-AGNOSTIC. It selects the rows by their
// issuer (the AMD ballot is printed under the bare banner and nowhere else) and
// reads only series_id, never fund_name -- keeping `PHOENIX` as the emitted
// fund_name while stamping S000001375 is a perfectly good fix, and so is
// rewriting it to the declared name.
func TestFamilyNS1018593PhoenixOverseasBareBanner(t *testing.T) {
	const (
		fixture = "phoenix2006_bare_banner.txt"
		// The banner's inner text, verbatim from fixture source line 184.
		banner = "PHOENIX"
		// The one declared series no banner in the filing names.
		wantID = "S000001375"
		// The issuer whose ballot is printed under the bare banner, and under no
		// other banner in this filing.
		issuer = "ADVANCED MICRO DEVICES, INC."
		// MEASURED on the fixture, not derived: 2 rows under the bare banner (AMD,
		// items 1.1-1.2), 0 under banners 2 and 3, 2 under PHOENIX RISING DIVIDENDS
		// (3M COMPANY, 01.1-01.2), 3 under PHOENIX SMALL-MID CAP FUND (99 CENTS ONLY
		// STORES, 01.1-01.3). The guard is a fixture tripwire only: it says the cut
		// still sniffs as issnpx and still yields the rows the assertion is about.
		wantRows    = 7
		wantIssuer  = 2
		wantSibling = 5
	)

	rows := ns1018593PhoenixDispatch(t, fixture, "dict.tsv", "issnpx", wantRows)

	// PRECONDITION, not the defect: the four named banners still resolve, which
	// is what makes the elimination argument available in the first place. If a
	// sibling banner regressed to a blank, the count below moves and this test
	// should be re-measured rather than believed.
	var target []VoteRow
	sibling := 0
	for _, r := range rows {
		if r.IssuerName == issuer {
			target = append(target, r)
			continue
		}
		if r.SeriesID != "" {
			sibling++
		}
	}
	if len(target) != wantIssuer || sibling != wantSibling {
		t.Fatalf("fixture precondition: %d rows for issuer %q (want %d), %d resolved rows under the other banners (want %d)",
			len(target), issuer, wantIssuer, sibling, wantSibling)
	}

	// THE DEFECT. The bare banner owns every row of this section, and exactly one
	// declared series is left for it to be, so every row resolves or none does.
	bad := 0
	var first VoteRow
	for _, r := range target {
		if r.SeriesID == wantID {
			continue
		}
		if bad == 0 {
			first = r
		}
		bad++
	}
	if bad > 0 {
		t.Errorf("%d of %d rows under the bare banner do not carry series_id %q; the first is issuer=%q cusip=%q meeting=%q item=%q series_id=%q fund=%q.\n"+
			"  The banner is %q (fixture source line 184) -- the brand prefix shared by all five series the filing's own SGML header declares, and a name in its own right for none of them, so no spelling-based rung of the issnpx chain can reach it.\n"+
			"  The filing's other four banners name S000001377, S000001376, S000001373 and S000001374, leaving %s (PHOENIX OVERSEAS FUND) as the only declared series unclaimed anywhere in the filing. Claiming a bare shared-prefix banner by elimination against a closed declaration set, when exactly one series is left and every sibling banner resolved, is the reach this filing calls for.",
			bad, len(target), wantID, first.IssuerName, first.CUSIP, first.MeetingDate, first.ItemSeq, first.SeriesID, first.FundName, banner, wantID)
	}
}
