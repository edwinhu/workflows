package main

import (
	"path/filepath"
	"testing"
)

// familyKK1Dispatch runs the real dispatch on a family KK.1 no-series fixture
// with the registrant's own cik_series.tsv rows loaded as the dictionary.
func familyKK1Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_kk1", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_kk1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000153/1534881/0001398344-17-011023.txt: 15-16, 51-89, 190-244, 256-300,
// 470-550. Aspiriant prints the fund once, as an underlined line above the first
// report ("Aspiriant Risk-Managed Equity Allocation Fund"), and then repeats only
// the ISS page banner on every continuation page:
//
//	Institution Account(s): Aspiriant Risk-Managed Global Equity Fund (GMV)
//
// That banner names the SAME series under its FORMER name -- S000036290 was
// "Aspiriant Risk-Managed Global Equity Fund" until the 2017 renaming, and the
// dictionary still carries that spelling -- but the header declares only the
// three current names, so the banner resolves to nothing and CLEARS the fund set
// by the underlined heading. In the whole filing that costs 2,631 of the 2,660
// no-series rows: the first meeting keeps its series for 9 rows and every row
// from the second page on is filed with no series at all.
func TestFamilyKK1AspiriantAccountBannerFormerName(t *testing.T) {
	rows := familyKK1Dispatch(t, "aspiriant_account_banner.txt", "htmltable", 2)
	for i, r := range rows {
		if r.SeriesID != "S000036290" {
			t.Errorf("row %d under the Institution Account(s) banner: fund=%q series=%q want S000036290", i, r.FundName, r.SeriesID)
		}
	}
}
