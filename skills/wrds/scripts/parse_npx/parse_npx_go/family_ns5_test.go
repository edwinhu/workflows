package main

import (
	"path/filepath"
	"testing"
)

// familyNS5Dispatch runs the real dispatch on a family NS5 fixture, loading the
// registrant's own cik_series.tsv rows as the dictionary when one is named.
func familyNS5Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns5", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns5", fixture), sink, make([]byte, headBytes))
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

// 000100/1006373/0000088053-04-000667.txt: 11-22, 25-28, 60-65, 63826-63851.
// Scudder Investments VIT Funds, 2004, layout `splittable`. All 19,719 rows of
// this filing carry no series on binary 224, in four ProxyEdge account banners:
//
//	8418 "VIT Small Cap Index Fund"
//	8130 "Scudder VIT EAFE Equity Index"
//	2993 "Scudder VIT Equity 500 Index"
//	 178 "Scudder VIT Real Est Sec Port"
//
// The header declares NO series, so cikDict.back puts the registrant's five
// dictionary rows in. The layout reads the banner correctly -- the emitted
// fund_name is exactly the printed account name (line 63830 verbatim):
//
//	Selected Accounts: Scudder VIT Equity 500 Index
//
// Measured on this filing's own index through icrResolveFundShared:
//
//	"Scudder VIT Equity 500 Index" -> ""
//	"VIT Equity 500 Index"         -> ""
//	"Equity 500 Index"             -> S000006221
//	"Small Cap Index"              -> S000006223
//
// so the brand/type rungs bridge the Scudder-to-DWS rename once the registrant
// run is off the front; what refuses is the run itself. Batch 80's
// issCutInitialsAndWordRun requires the leading run to carry at least one
// INITIALISM and at least one registrant word, to keep TestSeriesFormerRegistrantName
// and TestSeriesRulesRefuseToGuess green. `Scudder VIT` is two plain registrant
// words of SCUDDER INVESTMENTS VIT FUNDS and no initialism, so the rung declines
// it and these rows stayed blank through rbN5 and binary 224.
//
// Rows reached: 2,993 on this banner plus 8,418 on `VIT Small Cap Index Fund`
// (one registrant word plus the `Fund` type word, which the same run-plus-type
// retry reaches) = 11,411 of the filing's 19,719 pool rows.
//
// Fix in layout_issnpx.go, issResolveFundUncached's registrant-prefix strip:
// admit a leading run of plain registrant words when the remainder resolves
// EXACTLY against a declared/dictionary name after the type-word retry, which is
// the test the two refusal specs above already survive (their remainders differ
// from a declared name by a noun, and never match exactly).
func TestFamilyNS5ScudderVITRegistrantWordRunRefusesTheAccountName(t *testing.T) {
	rows := familyNS5Dispatch(t, "scudder_vit_equity500_account.txt", "scudder_vit_dict.tsv", "splittable", 2)
	for _, r := range rows {
		if r.SeriesID != "S000006221" {
			t.Errorf("a plain registrant-word run refused the account name: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000006221", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
