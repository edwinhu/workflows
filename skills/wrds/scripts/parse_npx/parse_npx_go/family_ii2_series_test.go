package main

import (
	"path/filepath"
	"testing"
)

func familyII2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ii2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ii2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000081/810695/0001580642-20-003240.txt: 15-16; 53-58; 78-82; 363-365;
// 46479-46600. Every fund section of this filing heads its table with one row
// whose first cell is `Registrant:  Mutual Fund & Variable Insurance Trust`,
// whose next cell is the bare label `Fund Name -&nbsp;`, and whose third cell
// carries the fund: `<TD COLSPAN="2" STYLE="font-weight: bold">Rational Dynamic
// Brands Fund</TD>`. The one section that spells label and fund in the SAME cell
// (`Fund Name - Rational ReSolve Adaptive Asset Allocation Fund`, line 45813) is
// the only one that resolves; the split-cell form leaves 3,744 of the filing's
// 4,221 rows with no series, even though the header itself declares
// `S000005874 Rational Dynamic Brands Fund`.
func TestFamilyII2RationalLabelCellSplitFromFundCell(t *testing.T) {
	rows := familyII2Dispatch(t, "rational_dynamic_brands_label_cell.txt", "htmltable", 5)
	for _, r := range rows {
		if r.CUSIP != "01609W102" {
			t.Fatalf("identity precondition: CUSIP=%q issuer=%q", r.CUSIP, r.IssuerName)
		}
		if r.SeriesID != "S000005874" {
			t.Errorf("Rational Dynamic Brands Fund: fund=%q series=%q want S000005874", r.FundName, r.SeriesID)
		}
	}
}

// 000121/1217286/0001145443-05-002117.txt: 25-26; 118-122; 53659-53673. The
// banner `========================= JPMORGAN MARKET NEUTRAL FUND ==========` is
// an exact match for TWO dictionary names of CIK 1217286 — S000002614, which
// carried the name in the 2006 header, and S000002838, which took it only in
// 2014 and was `Highbridge Statistical Market Neutral Fund` in 2006 — so the
// collision rule refuses both and 1,261 rows carry no series. The dictionary's
// declaration dates settle it: this filing reports 07/2004-06/2005, and the
// only contemporaneous holder of the name is S000002614.
func TestFamilyII2JPMorganMarketNeutralNameCollision(t *testing.T) {
	rows := familyII2Dispatch(t, "jpmorgan_market_neutral_collision.txt", "issnpx", 3)
	for _, r := range rows {
		if r.CUSIP != "88579Y101" || r.MeetingDate != "20050510" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000002614" {
			t.Errorf("JPMORGAN MARKET NEUTRAL FUND: fund=%q series=%q want S000002614", r.FundName, r.SeriesID)
		}
	}
}
