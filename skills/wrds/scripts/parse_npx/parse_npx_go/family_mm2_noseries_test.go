package main

import (
	"path/filepath"
	"testing"
)

// familyMM2Dispatch runs the real dispatch on a family MM.2 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyMM2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mm2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_mm2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000074/743773/0000743773-04-000026.txt: 68434-68466. The banner spaces a token
// the dictionary runs together -- "SUMMIT S&P MID CAP 400 INDEX PORTFOLIO" for a
// declared "S&P Midcap 400 Index Portfolio" (S000010992) -- behind the
// registrant's own brand ("SUMMIT MUTUAL FUNDS INC"). issResolveFund consults the
// compact reading (ix.byCompact) only on the WHOLE banner key, which still
// carries "summit", and the brand-cut loop that follows tries lessBrandFull and
// lessBrandType but never the compact index. The sibling sections that need no
// respacing ("SUMMIT S&P 500 INDEX PORTFOLIO", "SUMMIT BALANCED INDEX PORTFOLIO")
// resolve in this same filing, so the brand cut itself works and only the
// MID CAP/Midcap split separates this heading from the dictionary. 867 rows.
func TestFamilyMM2SummitBrandThenCompactToken(t *testing.T) {
	rows := familyMM2Dispatch(t, "summit_midcap_compact.txt", "issnpx", 6)
	for _, r := range rows {
		if r.SeriesID != "S000010992" {
			t.Errorf("SUMMIT S&P MID CAP 400 INDEX PORTFOLIO: fund=%q series=%q want S000010992", r.FundName, r.SeriesID)
		}
	}
}

// 000086/862502/0001193125-04-152743.txt: 100-125. The filing's first banner is
// garbled: "SALMON BALANCED FUND EQUITY" for the declared "Salomon Brothers
// Balanced Fund" (S000009880) -- the registrant token is misspelled (SALMON for
// SALOMON), "BROTHERS" is dropped and a stray "EQUITY" trails the type word.
// Every other section of this filing heads with the intact registrant name
// ("SALOMON BROTHERS SERIES FUNDS INC - ALL CAP VALUE FUND" and five siblings)
// and resolves. issNearMissDecl repairs a misspelled registrant name only when
// the remainder is a declared name exactly, and the trailing EQUITY defeats it,
// so no rule reaches the one Balanced series the dictionary declares. 820 rows.
func TestFamilyMM2SalomonGarbledBrandTrailingWord(t *testing.T) {
	rows := familyMM2Dispatch(t, "salomon_salmon_typo.txt", "issnpx", 7)
	for _, r := range rows {
		if r.SeriesID != "S000009880" {
			t.Errorf("SALMON BALANCED FUND EQUITY: fund=%q series=%q want S000009880", r.FundName, r.SeriesID)
		}
	}
}

// 000102/1020425/0001144204-05-027174.txt: 169-300. This filing prints no fund
// section heading anywhere. The fund is a COLUMN: the vote table's leading
// "Portfolio Name" cell carries the stem once, bold-italic, on the first row of
// each fund's block ("Equity", "International", "Value", "Smaller Companies",
// "Focused Opportunities" -- five cells in 4.4 MB) and is blank on every row
// after it. parseHTMLTableRaw maps the header's other columns and never reads
// that first column as an identity, so fund_name is blank on the whole filing
// and the declared "The Masters' Select Equity Fund" (S000005593) is never
// consulted. All 1,892 rows carry no series.
func TestFamilyMM2MastersPortfolioNameColumn(t *testing.T) {
	rows := familyMM2Dispatch(t, "masters_portfolio_name_column.txt", "htmltable", 1)
	for _, r := range rows {
		if r.SeriesID != "S000005593" {
			t.Errorf("Portfolio Name cell \"Equity\": fund=%q series=%q want S000005593", r.FundName, r.SeriesID)
		}
	}
}
