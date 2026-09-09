package main

import (
	"path/filepath"
	"testing"
)

// familyTT2Dispatch runs the real dispatch on a family TT.2 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyTT2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_tt2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_tt2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000074/744388/0001193125-06-182498.txt: 166-196. The registrant's one voting
// fund is banner-headed under the historical SMITH BARNEY brand while the
// dictionary and the filing's own header carry the series under its successor
// LEGG MASON PARTNERS brand: `CITIFUNDS TRUST I - SMITH BARNEY EMERGING MARKETS
// EQUITY FUND` for `Legg Mason Partners Emerging Markets Equity Fund`
// (S000009469). Stripping the registrant prefix leaves `SMITH BARNEY EMERGING
// MARKETS EQUITY FUND`, which still exact-matches nothing, and the remaining
// stem `EMERGING MARKETS EQUITY FUND` is unique among the three declared
// series. 1,014 rows -- the whole filing.
func TestFamilyTT2CitiSmithBarneyBrand(t *testing.T) {
	rows := familyTT2Dispatch(t, "citi_smithbarney_brand.txt", "issnpx", 4)
	for _, r := range rows {
		if r.SeriesID != "S000009469" {
			t.Errorf("SMITH BARNEY EMERGING MARKETS EQUITY FUND: fund=%q series=%q want S000009469", r.FundName, r.SeriesID)
		}
	}
}

// 000159/1592900/0000894189-22-006469.txt: 290-294, 31305-31330. The heading
// expands the declared name's abbreviated word and drops its article:
// `Generation Z ETF` is printed above the section whose declared series is `The
// Gen Z ETF` (S000074694). No other declared name of this 50-series registrant
// carries a `Z`, so the expansion is unambiguous. 362 rows.
func TestFamilyTT2EAGenerationZExpansion(t *testing.T) {
	rows := familyTT2Dispatch(t, "ea_generation_z_expansion.txt", "broadridge", 5)
	for _, r := range rows {
		if r.SeriesID != "S000074694" {
			t.Errorf("Generation Z ETF: fund=%q series=%q want S000074694", r.FundName, r.SeriesID)
		}
	}
}

// 000081/811030/0000894189-10-003404.txt: 125-133, 265-278, 307-379. The fund
// banner is a table
// row of THREE filled cells -- the label `Name of Fund:`, the fund `Hodges Blue
// Chip 25 Fund` (S000026468), and the registrant's internal account code
// `19-3657`. The labelled-cell reader takes only a two-cell row, so the banner
// is dropped and the section's rows carry no fund at all. The last two sections
// of the same filing print the label cell EMPTY and do resolve, which is why
// only the first three sections leak: 1,012 of 1,651 rows.
func TestFamilyTT2HodgesNameOfFundCodeCell(t *testing.T) {
	rows := familyTT2Dispatch(t, "hodges_name_of_fund_code_cell.txt", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000026468" {
			t.Errorf("Name of Fund: Hodges Blue Chip 25 Fund: fund=%q series=%q want S000026468", r.FundName, r.SeriesID)
		}
	}
}
