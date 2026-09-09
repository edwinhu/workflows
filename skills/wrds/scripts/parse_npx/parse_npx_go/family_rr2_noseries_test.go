package main

import (
	"path/filepath"
	"testing"
)

// familyRR2Dispatch runs the real dispatch on a family RR.2 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyRR2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_rr2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_rr2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000082/820892/0001104659-07-066433.txt: 10117 and 11449 over the header's own
// series declarations. The equals-rule headings abbreviate the declared names
// below what issAbbreviates will accept: `=================== FIRST AMERICAN
// LARGE CAP GROWTH OPP FUND ===================` against the declared `First
// American Large Cap Growth Opportunities Fund` differs in the single token
// `OPP`, three characters, under the four-character floor in
// issAbbreviates; and `FIRST AMERICAN MID CAP GRWTH OPP FUND` against `First
// American Mid Cap Growth Opportunities Fund` differs in TWO tokens, which
// issAbbrevWordDecl rejects outright (diff > 1). 1,858 rows of the filing.
func TestFamilyRR2FirstAmericanOppAbbrev(t *testing.T) {
	rows := familyRR2Dispatch(t, "firstamerican_opp_abbrev.txt", "issnpx", 2)
	want := map[string]string{
		"FIRST AMERICAN LARGE CAP GROWTH OPP FUND": "S000005550",
		"FIRST AMERICAN MID CAP GRWTH OPP FUND":    "S000005553",
	}
	for _, r := range rows {
		if r.SeriesID != want[r.FundName] {
			t.Errorf("%q: series=%q want %s", r.FundName, r.SeriesID, want[r.FundName])
		}
	}
}

// 000108/1089951/0001271631-05-000098.txt: 1615-1636. The header declares no
// series at all, so the only map is the CIK dictionary, whose names all carry
// the registrant prefix -- `Managers AMG Funds - Essex Large-Cap Growth Fund`.
// The section heading prints the cap size as an initialism, `Essex LC Growth
// Fund`, so neither the prefix strip nor any abbreviation rule reaches the
// declaration and all 429 rows under the heading carry no series.
func TestFamilyRR2AMGEssexLCInitialism(t *testing.T) {
	rows := familyRR2Dispatch(t, "amg_essex_lc_initialism.txt", "broadridge", 6)
	for _, r := range rows {
		if r.SeriesID != "S000009872" {
			t.Errorf("Essex LC Growth Fund: fund=%q series=%q want S000009872", r.FundName, r.SeriesID)
		}
	}
}
