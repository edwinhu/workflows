package main

import (
	"path/filepath"
	"testing"
)

// familyOO1Dispatch runs the real dispatch on a family OO.1 no-series fixture
// with the registrant's own cik_series.tsv rows loaded as the dictionary.
func familyOO1Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_oo1", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_oo1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000076/764546/0000820027-05-000767.txt: 118-134 and 2660-2672. AXP Variable
// Portfolio Managed Series Inc declares exactly TWO series in the dictionary
// and its 2005 filing prints exactly two banners. The first,
// "=========== AXP VARIABLE PORTFOLIO - DIVERSIFIED EQUITY INCOME FUND ============",
// resolves to S000003388 under the brand-rename rules; the second,
// "==================== AXP VARIABLE PORTFOLIO - MANAGED FUND =====================",
// resolves to nothing, because the dictionary spells the remaining id
// S000003387 only under its successor name "RiverSource Variable Portfolio
// Balanced Fund" and the two share no distinctive word. The successor filing
// 000076/764546/0001068800-06-000849.txt prints the same two-fund lineup as
// "RIVERSOURCE VARIABLE PORTFOLIO - BALANCED FUND" and "RIVERSOURCE VARIABLE
// PORTFOLIO - DIVERSIFIED EQUITY INCOME FUND", so the residue banner is the
// Balanced/Managed series by elimination: one unmatched banner, one unmatched
// declared id. 1,761 of the filing's 2,999 rows sit under this banner and carry
// no series.
func TestFamilyOO1AXPManagedResidualElimination(t *testing.T) {
	rows := familyOO1Dispatch(t, "axp_vp_managed_fund.txt", "issnpx", 9)
	var managed int
	for _, r := range rows {
		if r.FundName != "AXP VARIABLE PORTFOLIO - MANAGED FUND" {
			continue
		}
		managed++
		if r.SeriesID != "S000003387" {
			t.Errorf("AXP VARIABLE PORTFOLIO - MANAGED FUND: fund=%q series=%q want S000003387", r.FundName, r.SeriesID)
		}
	}
	if managed == 0 {
		t.Fatalf("no rows under the MANAGED FUND banner")
	}
}
