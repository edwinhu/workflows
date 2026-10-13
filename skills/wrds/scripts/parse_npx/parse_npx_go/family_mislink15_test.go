package main

import (
	"path/filepath"
	"testing"
)

// familyMislink15Dispatch runs the real dispatch on the family MISLINK15
// fixture with the named dictionary and series-map overlay loaded, and asserts
// the fixture's own preconditions -- status, layout and row count -- so a
// failure below is an assertion about the series id and never a broken fixture.
func familyMislink15Dispatch(t *testing.T, fixture, dict, overlay, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink15", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap, err = loadSeriesOverlay(filepath.Join("testdata", "family_mislink15", overlay))
	if err != nil {
		t.Fatal(err)
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink15", fixture), sink, make([]byte, headBytes))
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

// 000035/356476/0000356476-04-000106.txt: verbatim source lines 11-29 (the SEC
// document opener through the registrant's FISCAL YEAR END), 51-56 (the header
// closer through `<TEXT>`), 57-95 (the FORM N-PX cover through the reporting
// period line), 16310-16338 (the MAXIM INDEX 600 PORTFOLIO banner and the whole
// 4KIDS ENTERTAINMENT, INC. block under it), 63639-63661 (the MAXIM INDEX 400
// banner and the whole 3COM CORP. block under it) and the filing's own last
// four lines. Every byte is verbatim.
//
// Maxim Series Fund, Inc. (Great-West), CIK 356476, period 20040630. The filing
// carries NO <SERIES-ID> in its header (`grep -c SERIES-ID` -> 0), so the whole
// declaration set is the dictionary backfill, `cikSeries.back` over the 228
// rows of `maxim_dict.tsv` (CIK 0000356476's rows of cik_series.tsv, verbatim).
//
// Source line 63639 verbatim:
//
//	=============================== MAXIM INDEX 400 ================================
//
// The current tree stamps S000030872 on all 2,501 rows of that section in the
// real filing. That id is declared ONLY as, in dictionary order:
//
//	S000030872  Maxim S&P MidCap 400 Index Portfolio   20110630
//	S000030872  Great-West S&P Mid Cap 400 Index Fund  20130630
//	S000030872  Empower S&P Mid Cap 400 Index Fund     20220630
//
// -- a series first declared 20110630, SEVEN YEARS after this filing's period,
// and later than 20060630, the earliest vintage this registrant carries at all
// (S000000679, `MAXIM SERIES FUND INC`). `grep -ic` over the whole 97,599-line
// filing returns 0 for `S&P MidCap`, 0 for `MidCap 400` and 0 for `Mid Cap 400`:
// the phrase the id is declared under is printed nowhere in the bytes. (`MidCap`
// alone appears once, in the unrelated `Maxim Ariel MidCap Value` caption at
// line 120, and `S&P` once, in `MAXIM S&P 500 INDEX PORTFOLIO`.) run72 stamped S000023741
// `Maxim Index 600 Portfolio` (20080630) on this banner and on `MAXIM INDEX
// EUROPEAN` / `MAXIM INDEX PACIFIC`; those two are blank in the current tree and
// this one replaced one wrong id with another.
//
// THE ROUTE IS PROBED, not judged by eye. Running the real dispatch on the full
// filing with `maxim_dict.tsv` loaded and NO overlay, `MAXIM INDEX 400` resolves
// **blank** (2,501 rows) -- no linker rung in `layout_issnpx.go` reaches
// S000030872 at all. Loading the one row this filing has in
// `series_map_applied.tsv` flips the same 2,501 rows to S000030872:
//
//	filing                                        heading          series_id   confidence  rows
//	000035/356476/0000356476-04-000106.txt        MAXIM INDEX 400  S000030872  0.9         2501
//
// So the stamp is the SERIES-MAP OVERLAY, not a rung. `seriesOverlay.apply`
// (`series_overlay.go:65`) accepts any id in the `declared` set, and that set --
// `overlayDeclaredIDs` at `series_overlay.go:91` -- is `meta.SeriesDecls` plus
// EVERY series `cikDict.byCIK[meta.CIK]` knows, with no vintage condition of any
// kind. `issFutureVintage` (`layout_issnpx.go:4928`) already recognises exactly
// this shape -- first declaration 20110630, later than the period 20040630 AND
// later than the registrant's own earliest 20060630 -- and refuses it at the six
// distinctive/stem rungs and the lead-token rungs. The overlay is outside all of
// it, so the same evidence that refuses a future-vintage guess from the linker
// admits a future-vintage guess from the map.
//
// Fix location: `series_overlay.go`, `overlayDeclaredIDs` -- an id whose
// earliest DATED declaration in `meta.SeriesDecls` post-dates BOTH
// `meta.PeriodOfReport` and the earliest dated declaration the registrant
// carries must not enter the declared set. That is `issFutureVintage`'s test,
// spelled over `meta.SeriesDecls` rather than an `issSeriesIndex`. A declaration
// the filing's own header printed is undated and the predicate never refuses it,
// so no header-declared id is touched; the guard only declines to let the map
// stamp a sleeve that did not exist at the period.
//
// Rows affected: 2,501 on this path in the real filing, currently WRONG, correct
// outcome blank. The sibling section asserted below is measured on the same
// dispatch: `MAXIM INDEX 600 PORTFOLIO` resolves to S000023741 through the
// linker on an EXACT declared name (`Maxim Index 600 Portfolio`, 20080630, which
// IS this registrant's earliest vintage), with nothing dropped and no overlay
// row involved. It must keep its id.
func TestFamilyMislink15MaximIndex400FutureVintageOverlay(t *testing.T) {
	rows := familyMislink15Dispatch(t, "maxim_index_400.txt", "maxim_dict.tsv", "maxim_overlay.tsv", "issnpx", 13)
	var four, six int
	for _, r := range rows {
		switch r.FundName {
		case "MAXIM INDEX 400":
			four++
			if r.SeriesID != "" {
				t.Errorf("the banner names `MAXIM INDEX 400`; S000030872 is declared only as `Maxim S&P MidCap 400 Index Portfolio` and later, first seen 20110630 -- seven years after this 20040630 period and later than this registrant's own earliest 20060630 vintage -- and `S&P MidCap`/`MidCap 400`/`Mid Cap 400` are printed nowhere in the filing, so the series-map overlay stamp that reaches it is a guess: issuer=%q cusip=%q date=%q desc=%q series=%q want \"\"",
					r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
			}
		case "MAXIM INDEX 600 PORTFOLIO":
			six++
			if r.SeriesID != "S000023741" {
				t.Errorf("the sibling banner equals a declared name exactly, at the registrant's own earliest vintage, with no token dropped and no overlay row, so it must keep its id: issuer=%q series=%q want S000023741", r.IssuerName, r.SeriesID)
			}
		default:
			t.Errorf("unexpected section %q", r.FundName)
		}
	}
	if four != 5 || six != 8 {
		t.Fatalf("fixture sections: four=%d six=%d want 5/8", four, six)
	}
}
