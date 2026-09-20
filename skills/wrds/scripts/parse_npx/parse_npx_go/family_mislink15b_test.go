package main

import (
	"path/filepath"
	"testing"
)

// familyMislink15bDispatch runs the real dispatch on a fixture in the named
// testdata directory with that directory's dictionary and series-map overlay
// loaded, and asserts the fixture's own preconditions -- status, layout and row
// count -- so a failure below is an assertion about the series id and never a
// broken fixture. It is familyMislink15Dispatch with the directory a parameter,
// because this test asserts over BOTH the family MISLINK15 fixture (which must
// stay refused) and its own (which must be accepted).
func familyMislink15bDispatch(t *testing.T, dir, fixture, dict, overlay, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", dir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap, err = loadSeriesOverlay(filepath.Join("testdata", dir, overlay))
	if err != nil {
		t.Fatal(err)
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", dir, fixture), sink, make([]byte, headBytes))
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

// 000103/1033669/0000930413-17-002976.txt: verbatim source lines 1-19 (the SEC
// document opener through the registrant's FISCAL YEAR END), 39-53 (the
// series-and-classes openers and the whole <SERIES> block of S000010297),
// 67-79 (the WHOLE <SERIES> block of S000051021, the sibling control), 106-122
// (the header closers through <PRE>), 124-134 and 157-159 (the FORM N-PX cover
// head and the reporting-period line), 5440-5452 (the
// `Lazard Emerging Markets Equity Advantage Portfolio` banner and the head of the
// AAC TECHNOLOGIES block under it), 72698-72710 (the
// `Lazard Real Assets and Pricing Opportunities Portfolio` banner and the head of
// the 3M COMPANY block under it) and the filing's own last five lines. 109 lines,
// every byte verbatim. TWO header <SERIES> blocks are carried on purpose: a
// fixture declaring exactly one series takes the chassis' single-series stamp and
// every row of both sections comes out S000051021, which would have made the
// assertion below vacuous. Measured on the one-series cut before it was widened.
//
// Lazard Retirement Series, Inc., CIK 1033669, period 20170630. Source line
// 72698 verbatim:
//
//	============ Lazard Real Assets and Pricing Opportunities Portfolio ============
//
// The dictionary records S000057374 at TWO vintages only, both years after this
// filing (`lazard_dict.tsv`, the 48 rows CIK 0001033669 has in cik_series.tsv,
// verbatim):
//
//	S000057374  Lazard Retirement Real Assets and Pricing Opportunities Portfolio  20200630
//	S000057374  Lazard Retirement Real Assets Portfolio                            20210630
//
// That is DICTIONARY LAG, not a future sleeve: the 20200630 name is this banner
// plus exactly one inserted token, `Retirement`, which is a token of the filing's
// own COMPANY CONFORMED NAME (`LAZARD RETIREMENT SERIES INC`). Under the MISLINK7
// ownBrandInfix rule that is the filer's own sleeve printed short of its brand --
// the same evidence that makes the sibling `Lazard Emerging Markets Equity
// Advantage Portfolio` resolve to header-declared S000051021, whose SERIES-NAME
// is `Lazard Retirement Emerging Markets Equity Advantage Portfolio`. The overlay
// row (`lazard_overlay.tsv`, the filing's row in series_map_applied.tsv with the
// filing key rewritten to the fixture's own relpath) must therefore be STAMPED
// despite the 20200630 vintage: 3,921 rows in the real filing.
//
// MEASURED, not assumed: the current tree already stamps it. Running the real
// dispatch on the full 87,233-line filing with `lazard_dict.tsv` and that one
// overlay row loaded prints
// `Lazard Real Assets and Pricing Opportunities Portfolio -> S000057374 n=3921`.
// batch 135's `overlayFutureVintage` (`series_overlay.go:122`) cannot refuse it,
// because the predicate reads `meta.SeriesDecls` and this filing's header
// declares five series of its own (`grep -c '^<SERIES-ID>'` -> 5), so
// `cikSeries.back` never fires, every decl the predicate sees is UNDATED, and
// `first` stays empty. The refusal is confined to filings whose header declares
// nothing and whose decls are therefore the dated dictionary backfill -- family
// MISLINK15's MAXIM filing (`grep -c SERIES-ID` -> 0).
//
// So this test is a BOUNDARY GUARD, not a red-then-green fix: it pins both
// directions of a distinction that today holds only as a side effect of which
// decls carry dates. Spelling the vintage predicate over the dictionary instead
// of `meta.SeriesDecls` -- the obvious "strengthening" -- would refuse this row
// and lose the 3,921, and this test is what fails if anyone does it.
func TestFamilyMislink15bLazardBrandInfixVintageLagAccepted(t *testing.T) {
	rows := familyMislink15bDispatch(t, "family_mislink15b", "lazard_real_assets.txt", "lazard_dict.tsv", "lazard_overlay.tsv", "issnpx", 5)
	var real, sib int
	for _, r := range rows {
		switch r.FundName {
		case "Lazard Real Assets and Pricing Opportunities Portfolio":
			real++
			if r.SeriesID != "S000057374" {
				t.Errorf("the banner is the 20200630 declared name of S000057374 less exactly one inserted token, `Retirement`, which is a token of this filer's own COMPANY CONFORMED NAME `LAZARD RETIREMENT SERIES INC` -- the MISLINK7 ownBrandInfix shape, i.e. dictionary LAG and not a future sleeve -- so the overlay row must be stamped despite the 20200630 vintage: issuer=%q cusip=%q date=%q desc=%q series=%q want S000057374",
					r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
			}
		case "Lazard Emerging Markets Equity Advantage Portfolio":
			sib++
			if r.SeriesID != "S000051021" {
				t.Errorf("the sibling banner is a HEADER-declared series' name less the same `Retirement` brand token, so it must keep the id the header itself declares: issuer=%q series=%q want S000051021", r.IssuerName, r.SeriesID)
			}
		default:
			t.Errorf("unexpected section %q", r.FundName)
		}
	}
	if real != 3 || sib != 2 {
		t.Fatalf("fixture sections: real=%d sib=%d want 3/2", real, sib)
	}
}

// The other direction, on family MISLINK15's own fixture and its own dictionary
// and overlay: `MAXIM INDEX 400` is NOT the declared name of S000030872 at any
// vintage, nor that name less a registrant-brand token -- S000030872 is declared
// only as `Maxim S&P MidCap 400 Index Portfolio` (20110630) and later, and
// `S&P MidCap` / `MidCap 400` / `Mid Cap 400` are printed nowhere in that filing.
// It is a fuzzy relation, and the vintage exclusion must keep refusing it even
// though the row above is accepted.
func TestFamilyMislink15bMaximStaysRefused(t *testing.T) {
	rows := familyMislink15bDispatch(t, "family_mislink15", "maxim_index_400.txt", "maxim_dict.tsv", "maxim_overlay.tsv", "issnpx", 13)
	var four int
	for _, r := range rows {
		if r.FundName != "MAXIM INDEX 400" {
			continue
		}
		four++
		if r.SeriesID != "" {
			t.Errorf("`MAXIM INDEX 400` matches S000030872 only fuzzily -- no declared name of it, at any vintage, equals the banner or the banner plus one registrant-brand token -- so the future-vintage exclusion must still refuse it: desc=%q series=%q want \"\"", r.VoteDescription, r.SeriesID)
		}
	}
	if four != 5 {
		t.Fatalf("fixture sections: four=%d want 5", four)
	}
}
