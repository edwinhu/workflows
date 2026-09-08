package main

import (
	"path/filepath"
	"testing"
)

func familyHH2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_hh2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_hh2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000088/881166/0000881166-06-000013.txt: 470-590. The spreadsheet-export half of
// the filing heads each section with a bare `<td class=xl24>` cell naming the fund
// as a PORTFOLIO where the dictionary declares it a Fund; the banner half of the
// same filing (`===== SM & R ALGER ... FUND =====`) resolves. 3,989 rows.
func TestFamilyHH2SMRBalancedPortfolioCell(t *testing.T) {
	rows := familyHH2Dispatch(t, "smr_balanced_portfolio.txt", "htmltable", 2)
	for _, r := range rows {
		if r.CUSIP != "375766102" || r.MeetingDate != "20050712" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000010240" {
			t.Errorf("SM&R BALANCED PORTFOLIO: fund=%q series=%q want S000010240", r.FundName, r.SeriesID)
		}
	}
}

// 000091/916053/0001104659-04-026400.txt: 216-490. The section heading misspells
// the declared `MassMutual Select Aggressive Growth Fund` — it drops `Select` and
// prints `AGGRESIVE` — so the leading section of the filing carries no series.
// 3,873 rows.
func TestFamilyHH2MassMutualAggresiveTypo(t *testing.T) {
	rows := familyHH2Dispatch(t, "massmutual_aggresive_typo.txt", "htmltable", 11)
	for _, r := range rows {
		if r.CUSIP != "068306109" || r.MeetingDate != "20031023" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000003656" {
			t.Errorf("MASSMUTUAL AGGRESIVE GROWTH FUND: fund=%q series=%q want S000003656", r.FundName, r.SeriesID)
		}
	}
}

// 000091/912036/0001438934-17-000531.txt: 5163-5192. The fund banner misspells
// `Dividend` as `Divdend`, one deleted letter from the declared `AMG Managers
// Guardian Capital Global Dividend Fund`; the section and everything downstream of
// it to the next banner carries no series. 958 rows on the two Divdend banners.
func TestFamilyHH2AMGGuardianDivdendTypo(t *testing.T) {
	rows := familyHH2Dispatch(t, "amg_guardian_divdend_typo.txt", "broadridge", 12)
	for _, r := range rows {
		if r.CUSIP != "053015103" || r.MeetingDate != "20161108" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000044915" {
			t.Errorf("AMG Managers Guardian Capital Global Divdend Fund: fund=%q series=%q want S000044915", r.FundName, r.SeriesID)
		}
	}
}
