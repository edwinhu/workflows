package main

import (
	"path/filepath"
	"testing"
)

// familyOO2Dispatch runs the real dispatch on a family OO.2 no-series fixture
// with the registrant's own cik_series.tsv rows loaded as the dictionary.
func familyOO2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_oo2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_oo2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000074/749155/0000749155-05-000014.txt: 25-26 + 1039-1064. GAM Funds Inc
// declares "GAM European Equity Fund" (S000003002) and the filing heads that
// section with the GEOGRAPHY AS A NOUN rather than an adjective:
//
//	=============================== GAM EUROPE FUND ================================
//
// The sibling sections resolve through the same chain -- "GAM INTERNATIONAL
// FUND" reaches "GAM International Equity Fund" (S000003001) and a probe of
// "GAM EUROPEAN FUND" reaches S000003002 -- so the dropped "Equity" is already
// handled and the only blocker is Europe/European. 1,763 of the filing's 7,082
// rows carry fund_name="GAM EUROPE FUND" and no series.
func TestFamilyOO2GAMEuropeAdjective(t *testing.T) {
	rows := familyOO2Dispatch(t, "gam_europe_adjective.txt", "issnpx", 6)
	for _, r := range rows {
		if r.SeriesID != "S000003002" {
			t.Errorf("GAM EUROPE FUND: fund=%q series=%q want S000003002", r.FundName, r.SeriesID)
		}
	}
}

// 000074/749155/0000749155-05-000014.txt: 25-26 + 20571-20585. The same filing
// heads its GAMerica section with an INTERNAL token the declared name lacks:
//
//	============================ GAMERICA CAPITAL FUND =============================
//
// for a declared "GAMerica Fund" (S000003005). The added-type-word rule
// (layout_issnpx.go:1854) only drops a TRAILING fund/portfolio/trust/series, so
// a word inserted before the terminal "FUND" is never removed; a probe of
// "GAMERICA FUND" resolves to S000003005. 353 rows carry
// fund_name="GAMERICA CAPITAL FUND" and no series.
func TestFamilyOO2GAMericaCapitalInfix(t *testing.T) {
	rows := familyOO2Dispatch(t, "gamerica_capital_infix.txt", "issnpx", 2)
	for _, r := range rows {
		if r.SeriesID != "S000003005" {
			t.Errorf("GAMERICA CAPITAL FUND: fund=%q series=%q want S000003005", r.FundName, r.SeriesID)
		}
	}
}
