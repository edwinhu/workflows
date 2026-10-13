package main

import (
	"path/filepath"
	"testing"
)

// familyUU2Dispatch runs the real dispatch on a family UU.2 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyUU2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_uu2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_uu2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000094/948258/0001398344-12-002546.txt: 265-420. The `Name of Fund:` banner
// is a three-cell table row -- label, fund, account code `1TM0` -- whose fund
// cell trails a parenthetical sub-adviser: `M International Equity Fund
// &#160;&#160;(NC, LLC)` for the declared `M International Equity Fund`
// (S000006151). The declared name is exact once the parenthetical is cut; the
// banner is read (the same shape resolves for the registrant's other sections)
// but the value never matches with the suffix attached. 961 of the filing's
// 2,113 rows -- the whole M International Equity Fund section.
func TestFamilyUU2MInternationalParenSuffix(t *testing.T) {
	rows := familyUU2Dispatch(t, "m_international_paren_suffix.txt", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000006151" {
			t.Errorf("M International Equity Fund  (NC, LLC): fund=%q series=%q want S000006151", r.FundName, r.SeriesID)
		}
	}
}

// 000093/932510/0000892712-05-000734.txt: 5953-6010. The section banner is a
// full-width cell printing the fund under its pre-acquisition ICAP brand and
// type word, `ICAP Select Equity Portfolio`, while every dictionary name for
// this CIK carries the successor MainStay brand and the type word Fund:
// `MainStay ICAP Select Equity Fund` (S000000734). Substituting the declared
// text into this same fixture resolves, so the banner cell is read and the
// name alone is what fails. The stem `ICAP Select Equity` answers exactly one
// of the four declared series. 344 of the filing's 952 rows.
func TestFamilyUU2ICAPSelectEquityPortfolio(t *testing.T) {
	rows := familyUU2Dispatch(t, "icap_select_portfolio.txt", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000000734" {
			t.Errorf("ICAP Select Equity Portfolio: fund=%q series=%q want S000000734", r.FundName, r.SeriesID)
		}
	}
}

// 000113/1137761/0000935069-06-002489.txt: 1-473, 596-3540, 3542-3548,
// 4885-4890, 5108-5125. The ISS banner `===== PF LAZARD INTERNATIONAL VALUE FUND =====`
// names the fund by its then sub-adviser; the dictionary carries S000001888
// under `PF ALLIANCEBERNSTEIN INTERNATIONAL VALUE FUND`, `PL INTERNATIONAL
// VALUE FUND` and `PF International Value Fund`, so the printed name matches
// nothing and only the sub-adviser word differs. The registrant's other ISS
// sections resolve because their sub-adviser-branded names happen to be in the
// dictionary (`PF VAN KAMPEN COMSTOCK FUND`, `PF LOOMIS SAYLES LARGE-CAP
// GROWTH FUND`), which is why only this one leaks: 498 of the filing's 3,344
// rows.
//
// The padding is load-bearing and is why this fixture is 280 KB. The filing is
// a hybrid: a fixed-width table grammar runs for its first 3,500 lines and the
// ISS report follows. matchISSNPX sees only the 256 KB head window, misses the
// banner, and the filing falls to labelvalue -- which resolves declared names
// exactly but has no sub-adviser cut. Cut short, the banner lands inside the
// head window, issnpx claims the filing and resolves the fund, so a small
// fixture does not reproduce the defect at all.
func TestFamilyUU2PFLazardSubAdviser(t *testing.T) {
	rows := familyUU2Dispatch(t, "pf_lazard_subadviser.txt", "labelvalue", 8)
	for _, r := range rows {
		if r.SeriesID != "S000001888" {
			t.Errorf("PF LAZARD INTERNATIONAL VALUE FUND: fund=%q series=%q want S000001888", r.FundName, r.SeriesID)
		}
	}
}
