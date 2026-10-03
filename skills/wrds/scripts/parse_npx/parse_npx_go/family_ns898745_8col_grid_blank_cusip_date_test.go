package main

import (
	"path/filepath"
	"testing"
)

// 000089/898745/0000898745-11-000564.txt (Principal Funds, Inc., period
// 20110630, 709,824 lines): 1-841, 134696-135072, 421154-421589,
// 468401-468939, 709818-709824. Every range is a whole vendor page cut at the
// `<!--$$/page=-->` rule, copied byte for byte off /wrds/sec/archives.
//
// The page at 468401-468939 prints, under `FUND: Principal Funds, Inc. &#150;
// SmallCap Growth Fund II`, ProxyEdge column grids with exactly EIGHT columns:
//
//	Ticker | Meeting Date | Country | Security ID | Meeting Type | Record Date | Shares Voted | Shares on Loan
//
// and no second `CUSIP: ...` row under the data row. At source line 468498 the
// grid for Online Resources Corporation reads ORCC | 01-Jul-10 | USA |
// 68273G101 | Annual | 19-May-10 | 2,842 | 0. The parser attributes the series
// correctly (S000007176) but emits the issuer's rows with CUSIP and meeting
// date BOTH EMPTY; the same shape recurs at 179837 and 411152 of the full file.
//
// Two further pages are only here because the dispatch is cumulative: the
// proxyedge layout claims the filing only when its head prints a header band
// (`Item / Proposal / Type / Vote / For/Against Management`, page 421154) AND
// a colon-labelled identity cell (`Security ID:`, page 134696). Without both
// the filing falls to htmltable and the bug does not reproduce.
func TestFamilyNS898745EightColumnGridKeepsCUSIPAndMeetingDate(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns898745_8col_grid_blank_cusip_date", "principal_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	const fixture = "principal_8col_grid.txt"
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns898745_8col_grid_blank_cusip_date", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	seen := 0
	for i, r := range sink.buf {
		if r.IssuerName != "Online Resources Corporation" {
			continue
		}
		seen++
		if r.CUSIP != "68273G101" || r.MeetingDate != "20100701" {
			t.Errorf("row %d (Online Resources Corporation, 8-column grid at source line 468498: ORCC 01-Jul-10 USA 68273G101 Annual 19-May-10): cusip=%q date=%q series=%q fund=%q item=%q want cusip=68273G101 date=20100701",
				i, r.CUSIP, r.MeetingDate, r.SeriesID, r.FundName, r.ItemSeq)
		}
	}
	if seen == 0 {
		t.Fatalf("no Online Resources Corporation row parsed out of %d rows", len(sink.buf))
	}
}

// A second page of the same filing (source lines 601617-602119, appended to
// the fixture after the Online Resources page) prints the SAME 8-column
// ProxyEdge grid except the label row merges `Meeting Type` and `Record Date`
// into one colspan=2 cell (`Meeting Type Record Date`), so the label row has
// 7 cells against the value row's 8. htmlStackedLabelsWithIssuer rejects any
// unrecognized label cell outright (returns ok=false as soon as one cell's
// flattened text fails the known-label lookup), discarding the whole grid's
// context -- 3D Systems Corporation (CUSIP 88554D205, 17-May-11) and Acacia
// Research Corporation (CUSIP 003881307, 17-May-11) both lose CUSIP and
// meeting date even though both values are printed plainly in their own
// cells.
func TestFamilyNS898745MergedMeetingTypeRecordDateLabelKeepsCUSIPAndMeetingDate(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns898745_8col_grid_blank_cusip_date", "principal_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	const fixture = "principal_8col_grid.txt"
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns898745_8col_grid_blank_cusip_date", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	want := map[string][2]string{
		"3D Systems Corporation":      {"88554D205", "20110517"},
		"Acacia Research Corporation": {"003881307", "20110517"},
	}
	seen := map[string]bool{}
	for i, r := range sink.buf {
		exp, ok := want[r.IssuerName]
		if !ok {
			continue
		}
		seen[r.IssuerName] = true
		if r.CUSIP != exp[0] || r.MeetingDate != exp[1] {
			t.Errorf("row %d (%s, merged Meeting Type/Record Date label cell): cusip=%q date=%q series=%q fund=%q want cusip=%s date=%s",
				i, r.IssuerName, r.CUSIP, r.MeetingDate, r.SeriesID, r.FundName, exp[0], exp[1])
		}
	}
	for issuer := range want {
		if !seen[issuer] {
			t.Fatalf("no %s row parsed out of %d rows", issuer, len(sink.buf))
		}
	}
}
