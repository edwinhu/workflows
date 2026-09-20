package main

import (
	"path/filepath"
	"testing"
)

// familyMislink4Dispatch runs the real dispatch on a family MISLINK4 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyMislink4Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink4", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink4", fixture), sink, make([]byte, headBytes))
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

// 000008/88064/0000088053-04-000603.txt: verbatim source lines 11-28, 63-69,
// 115 and 118, then five whole ProxyEdge sections cut by line range --
// 139-158 + 160, 1759-1780, 3550-3571, 5163-5193 and 17784-17804 (source line
// 159 is the first section's bare `<S> <C> <C> <C>` line, which the layout
// emits as a furniture row with `how_voted` `<C>` and which
// TestHowVotedVocabularyInvariant rightly refuses in testdata) -- each followed by
// one `</TABLE>` line copied verbatim from source line 5161 to close the table
// the line-range cut opened (the only bytes in the fixture that do not stand
// where the source prints them), then the filing's own last four lines.
// Dispatches to `splittable` (the precondition asserts it).
//
// Investment Trust (the former Scudder Investment Trust), 2004. The fixture is
// longer than the usual ~60 lines because the shape is a relation BETWEEN
// sections: three headings that resolve, one heading with no rows, and two
// headings that resolve to nothing and are stamped anyway. Each ProxyEdge
// section must be carried whole -- measured, dropping the three
// `Vote Group: UNASSIGNED` lines and their blanks flips the dispatch to
// `unknown:report-date` and the fixture stops exercising the layout at all.
//
// The defect. On the whole filing, with the registrant's 22 dictionary rows,
// the real dispatch emits:
//
//	2953 fund="Equity 500 Index Portfolio"   series="S000005708"
//	1428 fund="Scudder Small Co Stock Fund"  series="S000005708"
//	 531 fund="Scudder Growth & Income"      series="S000005706"
//	 457 fund="Scudder Capital Growth"       series="S000005705"
//	 443 fund="Scudder Large Co Growth"      series="S000005707"
//
// S000005708 is declared `DWS S&P 500 Index Fund`. The registrant declares
// S000005709 `DWS Small Cap Core Fund` and no name spelling `Small Co Stock`,
// and no name spelling `Equity 500 Index` at all.
//
// Neither stamp comes from the resolver. Measured on this filing's own index
// (issFilingIndex + issFormerKeys, dictionary rows backed in by cikSeries.back)
// through spIndex.resolve, which is the only chain layout_splittable.go
// consults:
//
//	"Scudder Capital Growth"      => S000005705
//	"Scudder Growth & Income"     => S000005706
//	"Scudder Large Co Growth"     => S000005707
//	"Scudder S&P 500 Index Fund"  => S000005708
//	"Equity 500 Index Portfolio"  => ""
//	"Scudder Small Co Stock Fund" => ""
//
// Both mislinked headings resolve to NOTHING. The stamp is the `ctx.page`
// fallback in spGroupRows (layout_splittable.go), which re-reads the section's
// "own printed banner" when the account label does not resolve. `ctx.page` is
// set in spReadContext by `ctx.page = lastBare` on a rule line, and it is
// carried forward unchanged by every later `spContext{fund: ..., page:
// ctx.page}`, so it is filing-wide state, not section state. Here it is set on
// the COVER PAGE, thousands of lines before the first vote table: source lines
// 115 and 118, verbatim, the last entry of the fiscal-year-end list and the
// underline of the line after it --
//
//	Scudder S&P 500 Index Fund
//	                ----------------
//
// -- so every heading in the filing that fails to resolve is stamped
// S000005708. Measured directly: a cut of the real filing carrying source lines
// 11-69, 113-118, 5163-5200 and 17784-17804 emits 3 rows at S000005708, and the
// same cut with source line 115 alone removed emits the same 3 rows blank.
//
// This is live from batch 105. Before the Scudder/DWS brand pair was added to
// issHistoricalBrandKey, `Scudder S&P 500 Index Fund` resolved to nothing too
// and the fallback had nothing to hand out; the pre-fix census recorded in
// family_ns16_test.go has both headings blank. The brand pair is right; the
// filing-wide fallback it feeds is the defect.
//
// Rows affected on this one filing: 4,381 -- 2,953 `Equity 500 Index
// Portfolio` plus 1,428 `Scudder Small Co Stock Fund`, both currently
// S000005708. Neither is in any no-series pool, so no lost-rows tier surfaces
// them.
//
// On the Equity 500 rows specifically. The filing's own prose, source lines
// 5169-5172 and carried verbatim in the fixture, says the S&P 500 Index Fund is
// a feeder whose master is the Equity 500 Index Portfolio and that the master's
// record is what follows. That is a genuine textual reason those rows belong to
// S000005708 -- but it is not a reason THIS stamp is right, because the parser
// never reads it: the identical S000005708 lands on the Small Co Stock rows,
// which the prose says nothing about. A master/feeder rung that read those four
// lines would be a different fix and would have to be measured on its own. A
// link key is never guessed, so both are asserted blank here.
//
// Fix in layout_splittable.go, spGroupRows: the `ctx.page` fallback must not be
// answerable by a banner from outside the section whose rows it is stamping --
// either by scoping `ctx.page` to the section (reset it where `ctx.fund` is
// overwritten in spReadProxyEdgeHeading / spReadContext) or by refusing the
// fallback whenever `ctx.page` names a fund the filing also prints as its own
// heading elsewhere.
func TestFamilyMislink4CoverPageBannerStamp(t *testing.T) {
	rows := familyMislink4Dispatch(t, "scudder_section_carryover.txt", "investment_trust_dict.tsv", "splittable", 5)
	want := map[string]string{
		"Scudder Capital Growth":      "S000005705",
		"Scudder Growth & Income":     "S000005706",
		"Scudder Large Co Growth":     "S000005707",
		"Equity 500 Index Portfolio":  "",
		"Scudder Small Co Stock Fund": "",
	}
	seen := map[string]bool{}
	for _, r := range rows {
		w, ok := want[r.FundName]
		if !ok {
			t.Errorf("unexpected fund in fixture: fund=%q series=%q", r.FundName, r.SeriesID)
			continue
		}
		seen[r.FundName] = true
		if r.SeriesID == w {
			continue
		}
		if w == "" {
			t.Errorf("a heading the resolver refuses was stamped from the filing's cover-page banner: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want blank", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
			continue
		}
		t.Errorf("a sibling heading the resolver answers lost its series: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want %s", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID, w)
	}
	for f := range want {
		if !seen[f] {
			t.Errorf("fixture precondition: no row emitted for heading %q", f)
		}
	}
}

// 000093/933691/0000933691-04-000204.txt: verbatim source lines 11-29, 49-55,
// 13376-13400 and 13409-13411, then the filing's own last four lines.
// Dispatches to
// `issnpx` (the precondition asserts it).
//
// JNL Series Trust, 2004. The census of the whole filing carries one heading
// whose text is TWO headings run together, and stamps all 1,613 of its rows
// with the FIRST:
//
//	1613 fund="JNL/MELLON CAPITAL MANAGEMENT BOND INDEX FUND JNL/MELLON CAPITAL MANAGEMENT ENHANCED S&P 500 INDEX FUND" series="S000001731"
//
// The bytes print two separate ruled banners, four blank lines apart, source
// lines 13380 and 13385, verbatim:
//
//	================ JNL/MELLON CAPITAL MANAGEMENT BOND INDEX FUND =================
//
//
//
//
//	========== JNL/MELLON CAPITAL MANAGEMENT ENHANCED S&P 500 INDEX FUND ===========
//
// The Bond Index banner owns NO rows -- the four lines under it are blank and
// the first issuer block (`3M CO`, source line 13388) follows the Enhanced
// banner. The later banner owns the rows that follow it, so S000001731, the
// Bond Index fund, is a wrong series on every one of the 1,613.
//
// The join is issBannerWrapVisible (layout_issnpx.go), in its index-aware
// branch, and nothing else -- measured on this fixture's own index:
//
//	issBannerWrapVisible(bond, enhanced, ix) = true
//	issBannerWrapVisible(bond, enhanced)     = false
//
// That branch joins when the continuation names nothing on its own and the
// JOIN names the same series the banner so far names. Both hold here for the
// wrong reason: the continuation resolves to nothing because the registrant
// declares `... ENHANCED S&P 500 STOCK INDEX FUND` and the filing prints no
// `STOCK`; and the join resolves to S000001731 only because the declared Bond
// Index name is a LEADING PREFIX of the joined string, so the rung that
// answers reads none of the continuation at all. Measured through
// issResolveFund on this fixture's index:
//
//	"... BOND INDEX FUND ... ENHANCED S&P 500 INDEX FUND" => S000001731 (decl `... BOND INDEX FUND`)
//	"... BOND INDEX FUND"                                 => S000001731
//	"... ENHANCED S&P 500 INDEX FUND"                     => ""
//	"... ENHANCED S&P 500 STOCK INDEX FUND"               => S000001733
//
// The honest series on these rows is BLANK. The heading that owns them is
// `... ENHANCED S&P 500 INDEX FUND`, which resolves to nothing: the only
// declaration it could be is S000001733, whose every spelling at this CIK
// carries a `STOCK` the printed heading omits, and no rung in the chain drops
// an interior token. `series_map_applied.tsv` assigns S000001733 to this exact
// filing at 0.9 confidence, so the overlay already disagrees with the parser;
// a rung that reached S000001733 from the printed spelling would be a strictly
// better answer than blank and would make this assertion wrong on purpose --
// but it is a separate, measurable change, and until it exists a link key is
// not guessed.
//
// Rows affected: 1,613 on this filing, all currently S000001731. They carry a
// series, so no no-series tier surfaces them.
//
// Fix in layout_issnpx.go, issBannerWrapVisible: the index-aware join must
// refuse a continuation that is itself a complete ruled banner, and must not
// accept a join whose resolution is reached by a rung that reads only the head
// of the joined string -- here, requiring that the joined resolution be
// something `sofar` alone does NOT already reach would refuse it.
func TestFamilyMislink4RunTogetherBanner(t *testing.T) {
	rows := familyMislink4Dispatch(t, "jnl_run_together_banner.txt", "jnl_dict.tsv", "issnpx", 3)
	for _, r := range rows {
		if r.SeriesID != "" {
			t.Errorf("two ruled banners were joined and the rows took the FIRST one's series: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want blank (the rows follow the ENHANCED S&P 500 banner, which resolves to nothing)", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
