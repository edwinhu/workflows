package main

import (
	"path/filepath"
	"testing"
)

// familyNSTDAXCrossCIKFragmentDispatch runs the real dispatch on the family
// fixture with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyNSTDAXCrossCIKFragmentDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns_tdax_crosscik_fragment", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns_tdax_crosscik_fragment", fixture), sink, make([]byte, headBytes))
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

// 000138/1385533/0000891092-09-003339.txt: verbatim source lines 1-1215,
// 754291-754319, 1216-1437 and 2148, then the filing's own last four lines
// (1354161-1354164). Every byte stands where the source prints it; the only
// edit is the splice, which brings the filing's own prose row up beside the
// filing's own first meeting so one 1,471-line fixture carries both a section
// BEFORE the fragment and a section AFTER it. Dispatches to `htmltable` (the
// precondition asserts it).
//
// TDX Independence Funds, Inc., CIK 1385533, period 20090630. The filing's own
// header declares five series -- S000016521..S000016525, `TDX Independence 2010
// Exchange-Traded Fund` through `TDX Independence In-Target Exchange-Traded
// Fund` -- and prints its sections under banners spelling them differently:
// `TDAX Independence 2010 ETF Composite` (source line 215). That banner resolves
// to S000016521 through the registrant-rename rung (see WHAT THE TWO SECTIONS
// NOW ASSERT below), which is what both of this fixture's sections carry.
//
// THE DEFECT. Deep inside the proxy-vote body this vendor word-wraps an ISS
// vote-rationale paragraph one fragment per `<i><font size=2>` element, inside
// a table row whose other cells are all `&nbsp;`. Source lines 754299-754309
// print one such cell:
//
//	<td align=left colspan="10">
//	 &nbsp; &nbsp; &nbsp;<i><font size=2>the</font></i>
//	<i><font size=2>context of</font></i>
//	<i><font size=2>the</font></i>
//	<i><font size=2>global</font></i>
//	<i><font size=2>economic</font></i>
//	</td>
//
// That is the sentence `... the context of the global economic downturn.`
// broken over five elements. To layout_htmltable it is a row with ONE filled
// cell, which is the shape a bare section banner has, so htmlBareFundLine is
// offered the cell's lines and the line `global` is offered to the resolver as
// a banner. Probed on the real filing with the real dictionary, the instrumented
// dispatch reports:
//
//	htmlBareFundLine pre="...\nthe\n\ncontext of\n\nthe\n\nglobal\n\neconomic\n"
//	  -> name="global"     id="S000008807" ok=true
//	htmlBareFundLine pre="...\nthe\n\ncontext of\n\nthe global\n\neconomic\n"
//	  -> name="the global" id="S000008807" ok=true
//
// and layout_htmltable.go:437 then opens a section on it, so every vote row
// below inherits `curFund` = the prose fragment and `curSeries` = S000008807.
//
// THE RUNG is the sibling-registrant rung inside issResolveFundUncached
// (layout_issnpx.go:2849-2853), which calls cikSeries.crossCIK on the banner as
// printed. `global` and `the global` both normalise to `global`, and the corpus
// dictionary answers that key with exactly one series of exactly one registrant:
//
//	0000088525 S000008807 GLOBAL                  20060630
//	0000088525 S000008807 Global                  20100630
//	0000088525 S000008807 MSCI EAFE Equal Weight  20110630
//
// Every existing guard passes on the way in, which is why this is a NEW defect
// and not a regression of the shipped ones. The vintage guard passes:
// 20060630 <= 20090630. The ABANDONMENT guard passes: the next differently-named
// redeclaration of S000008807 is 20110630, strictly AFTER the filing's period, so
// the name was live at 20090630 -- unlike SYNTAX ETF TRUST's 2023 `EQUITY`, whose
// 20130630 rename predates that filing and which the shipped guard refuses.
// Corpus uniqueness passes: `global` is one of 18 single-token dictionary names
// the whole corpus answers unambiguously. The own-brand-infix guard passes: no
// declaration of CIK 1385533 spells `global` at any vintage.
//
// So every guard crossCIK has is a guard about WHICH series a banner names, and
// the text it was handed is not a banner at all. Exactness and corpus-uniqueness
// are real evidence about a printed fund name and no evidence whatever about a
// word chopped out of a sentence; a rung whose whole defence is the quality of
// the match cannot defend itself against a match on the wrong input.
//
// MEASURED ON THE REAL PARSER, both WITH and WITHOUT `-series-map`
// (series_map_applied.tsv, 2026-09-22) -- byte-identical output either way:
//
//	filing 0000891092-09-003339, 8,242 rows
//	  3,625 rows S000008807 fund_name `global`
//	  3,381 rows S000008807 fund_name `the global`
//	  1,236 rows blank
//	  ZERO rows carry any of the filer's own five declared series.
//
// So 7,006 of 8,242 rows -- 85.0% of the filing -- are filed under a Guggenheim
// series by way of a sentence fragment, and the filer's own funds appear nowhere.
// The filer's duplicate report of the same period, 0000891092-10-000935, repeats
// it exactly: 7,006 more rows, 14,012 across the nine N-PX filings of CIK
// 1385533 (101,652 rows), i.e. 13.8% of everything this registrant reports.
//
// The reachable vocabulary bounds how far this generalises: 18 single-token and
// 370 one-or-two-token dictionary names are corpus-unique, so `balanced`,
// `equity`, `common` and `shelby` are all one wrapped sentence away from the
// same stamp. A corpus-wide row count needs a full parse and is not claimed here.
//
// WHAT THE TWO SECTIONS NOW ASSERT. Both of this fixture's sections are the
// SAME banner's -- `TDAX Independence 2010 ETF Composite`, opened at source
// line 215, read once before the spliced prose row and once after it -- and
// that banner resolves today. It reaches S000016521 through the registrant-
// rename rung: issRegistrantRenames carries a 0001385533 entry keying `tdax
// independence <N> etf composite` to the header's own declared `TDX Independence
// <N> Exchange-Traded Fund`, evidenced by the filing header's `FORMER CONFORMED
// NAME: TDAX Funds, Inc.` beside `COMPANY CONFORMED NAME: TDX Independence
// Funds, Inc.` (source lines 24 and 48). That is the subject of
// TestFamilyNSTDAXIndependenceETFCompositeBanner and is not what this test is
// about; this test's earlier comment asserted blank on the stated ground that
// "nothing in the chain can reach S000016521 from it", and that ground no longer
// holds.
//
// So the contrast is carried by INVARIANCE ACROSS THE PROSE ROW rather than by
// blankness. The section before the fragment fixes what the banner's own
// resolution is; the section after it must still read the same, because the
// prose row is not a heading and must neither rename the open section to a
// fragment of English nor re-point it at a sibling registrant. The fixture
// offers no still-unresolvable banner to serve as a blank foil -- it prints
// exactly one banner, the resolvable one -- so the defect assertion is stated
// positively against the banner's own values and negatively against the two
// values the defect produced: fund_name `global` / `the global` and series
// S000008807. Either of those reappearing fails the test, and so does a blank,
// which would mean the refusal had CLEARED the open section instead of leaving
// it standing.
//
// Fix in layout_htmltable.go, on the path that feeds htmlBareFundLine: a
// one-filled-cell row whose cell holds a word-wrapped prose RUN -- several
// sibling inline elements whose text does not stand as a line of its own -- is
// body text, not a section banner, and its fragments must never be offered to
// the resolver. Position and markup are the evidence, the way
// htmlIssuerIdentityCell already reads this layout's cell shape. Alternatively,
// or in addition, in layout_issnpx.go: the sibling rung must refuse a banner
// that is a bare stopword-led fragment (`the global`) or a single common word
// carrying no type word, brand or number -- text no registrant ever prints as a
// section heading.
func TestFamilyNSTDAXCrossCIKProseFragmentBanner(t *testing.T) {
	rows := familyNSTDAXCrossCIKFragmentDispatch(t, "tdax_prose_fragment_global.txt", "tdax_crosscik_dict.tsv", "htmltable", 3)
	const (
		banner = "TDAX Independence 2010 ETF Composite"
		series = "S000016521"
	)
	for _, r := range rows {
		switch r.IssuerName {
		case "Greenlight Capital Re, Ltd.":
			// The contrast: the section the filing's own `TDAX Independence
			// 2010 ETF Composite` banner opened, read BEFORE the prose row.
			// This fixes what the banner resolves to on its own.
			if r.SeriesID != series || r.FundName != banner {
				t.Errorf("contrast section regressed: issuer=%q item=%q desc=%.40q fund=%q series=%q want fund=%q series=%q (CIK 1385533's own header declares S000016521 as `TDX Independence 2010 Exchange-Traded Fund`, and issRegistrantRenames keys the banner's `TDAX`/`ETF Composite` spelling onto it)", r.IssuerName, r.ItemSeq, r.VoteDescription, r.FundName, r.SeriesID, banner, series)
			}
		case "BT Group plc":
			// The defect: the same section, read AFTER the wrapped prose row.
			// It must read exactly as it did before the prose row -- the
			// fragment is body text and changes nothing.
			if r.SeriesID != series {
				t.Errorf("a word chopped out of an ISS rationale sentence was read as a fund banner and moved the open section off the filer's own series: issuer=%q cusip=%q item=%q desc=%.40q fund=%q series=%q want %q (fund_name is a fragment of `... the context of the global economic downturn.` at source lines 754299-754309; S000008807 is CIK 0000088525's `GLOBAL`, and CIK 1385533 declares only S000016521..S000016525 -- a blank here would mean the refusal CLEARED the open section instead of leaving it standing)", r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.FundName, r.SeriesID, series)
			}
			if r.SeriesID == "S000008807" {
				t.Errorf("the prose fragment cross-CIK matched a SIBLING registrant's series: issuer=%q item=%q fund=%q series=%q (S000008807 is CIK 0000088525's `GLOBAL`; no rung may reach it from this filing)", r.IssuerName, r.ItemSeq, r.FundName, r.SeriesID)
			}
			if r.FundName != banner {
				t.Errorf("prose was recorded as the section's fund name: issuer=%q item=%q fund=%q want %q (a one-filled-cell row holding a word-wrapped sentence is body text, not a section banner, so the banner opened at source line 215 must still stand)", r.IssuerName, r.ItemSeq, r.FundName, banner)
			}
		default:
			t.Errorf("fixture precondition: unexpected issuer %q", r.IssuerName)
		}
	}
}
