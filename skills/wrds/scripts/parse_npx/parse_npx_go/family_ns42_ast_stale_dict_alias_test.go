package main

import (
	"path/filepath"
	"testing"
)

// Advanced Series Trust (CIK 0000814679), verbatim bytes.
// Fixture: 000081/814679/0001683863-23-006059.txt lines 1-19 (header prologue),
// 217-234 (the two colliding SERIES declarations), 605-611 (document wrapper),
// 647-652 (pre-text preamble) and 91651-91677 (the lost section). Dictionary:
// the five cik_series.tsv rows this CIK carries for S000006792 and S000006793,
// copied verbatim.
//
// The filing's OWN header declares S000006793 under the exact name the body
// heading prints -- line 229, `<SERIES-NAME>AST BALANCED ASSET ALLOCATION
// PORTFOLIO`, for `<SERIES-ID>S000006793` at line 228 -- and declares
// S000006792 under a DIFFERENT name at lines 219-220, `AST ACADEMIC STRATEGIES
// ASSET ALLOCATION PORTFOLIO`. The registrant renamed those two sleeves: the
// 20060630 dictionary vintage (000081/814679/0000067590-06-000189.txt lines
// 400-401) has S000006792 under `AST BALANCED ASSET ALLOCATION PORTFOLIO`, the
// name S000006793 now answers to.
//
// issDeclAliases folds that stale 20060630 dictionary name in as an alias of
// S000006792, seriesByName then sees two ids under one normalised name and maps
// it onto nil, and the sleeve-stem rung -- which skips nil entries -- refuses
// the whole section. The guard already in issDeclAliases blocks exactly this
// collision, but only for a dictionary name whose DeclDate POSTDATES the period
// of report; a name that PREDATES it is just as incapable of naming this
// filing's sleeve when the header itself prints that name for a different id.
//
// Measured on the two real filings with parse_npx_go_282, the ns39 binary,
// -cik-series on: 34,286 rows blank (17,432 in the 20230630 filing, 16,854 in
// 000081/814679/0001683863-22-005656.txt) and 16,660 more wrongly stamped
// through the descriptor rungs the refusal falls through to -- 12,361 onto
// S000047530 (AST QMA International Core Equity Portfolio) and 4,299 onto
// S000001981 (AST International Value Portfolio). Dropping -cik-series and
// changing nothing else stamps all 51,347 Balanced rows S000006793.
func TestFamilyNS42ASTStaleDictAliasCollidesWithOwnHeader(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns42", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	sink := &rowSink{}
	fixture := "ast_balanced_sleeve.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_ns42", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" || meta.CIK != "0000814679" || meta.PeriodOfReport != "20230630" {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	if len(sink.buf) != 13 {
		t.Fatalf("fixture precondition: got %d rows, want 13 (the 3M COMPANY ballot)", len(sink.buf))
	}

	// The heading's stem is the verbatim name this filing's own header declares
	// for S000006793.
	const want = "S000006793"
	for _, r := range sink.buf {
		if r.SeriesID != want {
			t.Errorf("heading %q: series=%q, want %s (this filing's header declares that id under the heading's stem at line 228-229; the id stamped instead comes from a 20060630 dictionary name)",
				r.FundName, r.SeriesID, want)
			break
		}
	}
}
