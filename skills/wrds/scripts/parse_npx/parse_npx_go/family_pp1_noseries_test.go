package main

import (
	"path/filepath"
	"testing"
)

// familyPP1Dispatch runs the real dispatch on a family PP.1 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyPP1Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_pp1", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_pp1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000136/1364089/0001193125-07-187132.txt: 1-1000 and 86500-86640. The second
// range is the SIBLING block "Claymore/Ocean Tomo Patent ETF", which resolves;
// without a resolving sibling in the cut the layout falls back to stamping every
// declared id on every row, which the real filing does not do, so both blocks
// have to be present. Claymore Exchange-Traded Fund Trust prints one
// centered bold block heading per fund above each table, and every sibling
// heading resolves. The first block's,
// "<B>Claymore/Zacks Yield Hog ETF </B>", resolves to nothing, so the layout
// carries no fund at all and leaves fund_name blank as well as series_id.
// The registrant declares the same brand TWICE in the SGML header --
// "Claymore?Zacks Yield Hog Portfolio" (S000012982) and "ZACKS YIELD HOG"
// (S000012992) -- so the heading's stem matches two declared series and the
// only discriminator is the type word, ETF against Portfolio. The sibling
// "Claymore/Zacks Sector Rotation ETF" carries the identical Portfolio/ETF pair
// (S000012981 / S000012991) and resolves anyway, because the DICTIONARY spells
// S000012991 under the exact heading text; the dictionary has no
// "Claymore/Zacks Yield Hog ETF" for S000012992, only the successor names
// "Claymore/Zacks Multi-Asset Income Index ETF" and "Guggenheim Multi-Asset
// Income ETF", so the exact fallback misses and nothing breaks the tie. The ETF
// is S000012992 by the same Portfolio-vs-ETF reading that the resolved siblings
// take. 1,546 of the filing's 9,838 rows sit under this heading and carry
// neither fund nor series.
func TestFamilyPP1ClaymoreYieldHogTypeWordTie(t *testing.T) {
	rows := familyPP1Dispatch(t, "claymore_zacks_yield_hog.txt", "htmltable", 32)
	for _, r := range rows {
		if r.FundName == "Claymore/Ocean Tomo Patent ETF" {
			continue
		}
		if r.SeriesID != "S000012992" {
			t.Errorf("Claymore/Zacks Yield Hog ETF: fund=%q series=%q want S000012992", r.FundName, r.SeriesID)
		}
	}
}

// 000073/732697/0000950137-05-010890.txt: 11-18, 25-26, 49-56 and 2900-6706.
// The body range is 260 KB and cannot be cut shorter. The filing carries TWO
// grammars: a Members Capital column table for the first 1.05 MB and then this
// ISS-style `Label: value` section. labelvalue reads it only because its
// `#  Proposal  Mgt Rec  Vote Cast  Sponsor` line lies past matchISSNPX's
// 256 KB head window; in any shorter cut issnpx matches that same line, claims
// the filing, and reads the heading CORRECTLY (S000019977). The defect is
// labelvalue's alone, so the fixture must keep the block beyond 256 KB.
//
// Ultra Series Fund prints a centered per-fund heading on EVERY page of its
// report -- "                      ULTRA SERIES INTERNATIONAL STOCK FUND" above
// "PROXY VOTING SUMMARY REPORT" and the reporting period, 225 such headings over
// eight distinct funds -- but the labelvalue layout never reads them: all 1,515
// rows of the filing come out with fund_name AND series_id blank. The heading
// carries no `=====` rule and no label, so neither the banner reader nor the
// `Label: value` reader sees it. Its stem is the registrant's own COMPANY
// CONFORMED NAME "ULTRA SERIES FUND", and the dictionary spells this fund
// "International Stock Fund" (S000019977); "ULTRA SERIES GLOBAL SECURITIES FUND"
// and "ULTRA SERIES HIGH INCOME FUND" would resolve the same way (S000019985,
// S000019979). This is the whole filing's residue: 1,515 of 1,515 rows.
func TestFamilyPP1UltraSeriesLabelvalueHeadingUnread(t *testing.T) {
	rows := familyPP1Dispatch(t, "ultra_series_international_stock.txt", "labelvalue", 4)
	for _, r := range rows {
		if r.SeriesID != "S000019977" {
			t.Errorf("ULTRA SERIES INTERNATIONAL STOCK FUND: fund=%q series=%q want S000019977", r.FundName, r.SeriesID)
		}
	}
}
