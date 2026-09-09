package main

import (
	"path/filepath"
	"testing"
)

// familyWW1Dispatch runs the real dispatch on a family WW.1 fixture with the
// registrant's own cik_series.tsv rows loaded as the dictionary.
func familyWW1Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ww1", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ww1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000109/1093439/0000891804-06-000067.txt: 23-26, 1915-1952. Century Capital
// Management Trust's 2005 header declares no series; the dictionary backs it
// with `CENTURY SMALL CAP SELECT FUND` S000009298 and `CENTURY SHARES TRUST`
// S000009299, both spelled exactly as the filing prints them. The filing opens
// each section with a masthead BETWEEN two dashed rules, and then puts SGML
// table furniture and a two-line report banner between that masthead and the
// section's first meeting block:
//
//   - -------------------------------------------------------------------------------
//     CENTURY SHARES TRUST
//   - -------------------------------------------------------------------------------
//     <TABLE>
//     <S>      <C>             <C>             <C>                     <C>             <C>             <C>
//     Vote Summary
//     01-Jul-04 To 30-Jun-05
//     ABBOTT LABORATORIES
//
// Every heading branch in parseBroadridge is anchored on the block opener, and
// the slot walks up at most one blank line (brHeadingBlankWalk), so the masthead
// is four furniture lines out of reach and is never read. brFundMasthead reads
// this vintage's masthead only when it stands under a `MEETING DATE RANGE`
// line, which this one does not. All 816 rows of the filing carry a blank fund
// name and a blank series: 382 under `CENTURY SMALL CAP SELECT FUND` and 434
// under `CENTURY SHARES TRUST`.
func TestFamilyWW1CenturyMastheadBetweenRules(t *testing.T) {
	rows := familyWW1Dispatch(t, "century_masthead_rules.txt", "century_dict.tsv", "broadridge", 18)
	for _, r := range rows {
		if r.SeriesID != "S000009299" {
			t.Errorf("CENTURY SHARES TRUST: fund=%q issuer=%q series=%q want S000009299", r.FundName, r.IssuerName, r.SeriesID)
		}
	}
}
