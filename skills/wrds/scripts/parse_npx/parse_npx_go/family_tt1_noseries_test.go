package main

import (
	"path/filepath"
	"testing"
)

// familyTT1Dispatch runs the real dispatch on a family TT.1 no-series fixture
// with the registrant's own cik_series.tsv rows loaded as the dictionary.
func familyTT1Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_tt1", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_tt1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000003/35692/0000950129-04-006771.txt: 150-183. AIM Stock Funds (CIK 35692)
// declares no series in its 2004 SGML header, so every stamp comes from the
// dictionary, which carries this registrant's four funds under the successor
// AIM brand (`AIM Dynamics Fund`, S000000163). The filing still heads its
// sections with the predecessor INVESCO brand the header's own FORMER CONFORMED
// NAME lines record (`INVESCO STOCK FUNDS INC`, `INVESCO CAPITAL APPRECIATION
// FUNDS INC`), and the stem after the brand agrees whole. issHistoricalBrandKey
// knows the Wells Fargo/Allspring and Goldman CORE/Structured pairs but not
// INVESCO/AIM, so all seven headings in this filing stamp nothing: 5,179 rows,
// of which 4,115 sit under the three headings whose stem matches a declared name
// (DYNAMICS 1,196, S&P 500 INDEX 2,196, SMALL COMPANY GROWTH 723).
func TestFamilyTT1InvescoAIMBrandHeading(t *testing.T) {
	rows := familyTT1Dispatch(t, "invesco_aim_brand_heading.txt", "issnpx", 8)
	for _, r := range rows {
		if r.SeriesID != "S000000163" {
			t.Errorf("INVESCO DYNAMICS FUND: fund=%q series=%q want S000000163", r.FundName, r.SeriesID)
		}
	}
}
