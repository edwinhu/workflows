package main

import (
	"path/filepath"
	"testing"
)

// familyNN1Dispatch runs the real dispatch on a family NN.1 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyNN1Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_nn1", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_nn1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000107/1078410/0000950135-05-005114.txt: 7580-7607. Nations Master Investment
// Trust prints the fund-era banner "NATIONS MARSICO GROWTH FUND MASTER" while
// the dictionary carries the successor spelling "Columbia Marsico Growth Master
// Portfolio" (S000010833). Its sibling banner "NATIONS MARSICO FOCUSED EQUITIES
// FUND MASTER" resolves in the same filing because issDistinctiveTokenDecl
// finds TWO five-letter tokens only one declared series carries ("focused",
// "equities"); this banner carries only one distinctive word as a token
// ("marsico" is shared by four declared series and "growth" by two), so the
// rule scores agree=1 and stamps nothing -- although the ADJACENT PAIR
// "marsico growth" occurs, in order, in exactly one declared name. 527 rows sit
// under this banner; 4,284 of the filing's 4,637 carry no series.
func TestFamilyNN1ColumbiaNationsMarsicoGrowth(t *testing.T) {
	rows := familyNN1Dispatch(t, "columbia_nations_marsico_growth.txt", "issnpx", 16)
	for _, r := range rows {
		if r.SeriesID != "S000010833" {
			t.Errorf("NATIONS MARSICO GROWTH FUND MASTER: fund=%q series=%q want S000010833", r.FundName, r.SeriesID)
		}
	}
}

// 000082/822977/0000950123-05-010580.txt: 7640-7666. Goldman Sachs Trust heads
// its quantitative sleeves with the CORE brand of the reporting period, "GS
// CORE INTERNATIONAL EQUITY FUND"; the registrant-initials brand "GS" is cut by
// the existing rule, but the remainder "core international equity fund" is not
// a declared name -- the dictionary spells the same series under its successor
// name "Goldman Sachs Structured International Equity Fund" (S000009330), the
// rename CORE -> Structured being the only difference. The same substitution
// covers five sibling banners in this filing (CORE Small Cap Equity ->
// S000009329, CORE Tax-Managed Equity -> S000009340, CORE U.S. Equity ->
// S000009327, CORE Large Cap Value -> S000009326, CORE Large Cap Growth ->
// S000009328), 9,632 rows in all; 2,927 sit under this banner, and 11,458 of
// the filing's 22,788 rows carry no series.
func TestFamilyNN1GoldmanCoreBrandRename(t *testing.T) {
	rows := familyNN1Dispatch(t, "goldman_gs_core_brand.txt", "issnpx", 12)
	for _, r := range rows {
		if r.SeriesID != "S000009330" {
			t.Errorf("GS CORE INTERNATIONAL EQUITY FUND: fund=%q series=%q want S000009330", r.FundName, r.SeriesID)
		}
	}
}

// 000081/810271/0001193125-04-147190.txt: 14586-14602. The banner wraps over two
// equals-ruled lines and reads "SMITH BARNEY INVESTMENT SERIES - SMITH BARNEY
// PREMIER SELECTIONS ALL CAP GROWTH PORTFOLIO"; the dictionary carries the
// successor "Legg Mason Partners Variable Premier Selections All Cap Growth
// Portfolio" (S000010847). Two five-letter tokens of the banner are carried by
// that one declared series and no other ("premier", "selections"), so
// issDistinctiveTokenDecl would resolve it -- but the registrant declares only
// SEVEN series and the rule refuses any pool below issDistinctiveMinPool = 10,
// so it never runs for this filing. 928 rows sit under this banner and ALL
// 6,440 rows of the filing carry no series.
func TestFamilyNN1LeggMasonSmithBarneyPremierSmallPool(t *testing.T) {
	rows := familyNN1Dispatch(t, "leggmason_smith_barney_premier.txt", "issnpx", 4)
	for _, r := range rows {
		if r.SeriesID != "S000010847" {
			t.Errorf("SMITH BARNEY INVESTMENT SERIES - SMITH BARNEY PREMIER SELECTIONS ALL CAP GROWTH PORTFOLIO: fund=%q series=%q want S000010847", r.FundName, r.SeriesID)
		}
	}
}

// 000003/35341/0000225322-04-000037.txt: 64-168. This filing prints no
// per-fund banner at all: the htmltable layout reads the report title "ANNUAL
// REPORT OF PROXY VOTING RECORD OF REGISTERED MANAGEMENT INVESTMENT COMPANY
// INVESTMENT COMPANY ACT FILE NUMBER: 811-01352" as the heading, and
// issDistinctiveTokenDecl resolves it to S000006069, Fidelity Real Estate
// INVESTMENT Portfolio -- the only declared series carrying the token
// "investment". The rule demands two agreeing distinctive tokens, but it counts
// token OCCURRENCES rather than distinct words, and the title says "INVESTMENT"
// twice, so one word scores agree=2 on its own. The filing's own bytes name a
// different fund ("Fund Name: Fidelity Structured Mid Cap Value Fund"), so all
// 1,812 rows are stamped with the wrong series.
func TestFamilyNN1FidelityRepeatedDistinctiveToken(t *testing.T) {
	rows := familyNN1Dispatch(t, "fidelity_report_title_repeated_token.txt", "htmltable", 4)
	for _, r := range rows {
		if r.SeriesID == "S000006069" {
			t.Errorf("report title stamped as Fidelity Real Estate Investment Portfolio: fund=%q series=%q want not S000006069", r.FundName, r.SeriesID)
		}
	}
}
