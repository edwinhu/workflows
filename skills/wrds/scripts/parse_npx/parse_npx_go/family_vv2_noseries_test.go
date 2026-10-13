package main

import (
	"path/filepath"
	"testing"
)

// familyVV2Dispatch runs the real dispatch on a family VV.2 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyVV2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_vv2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_vv2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000102/1020861/0000950129-05-008756.txt: 24-26, 1512-1543. SunAmerica Focused
// Series prints each section's fund on an account line whose leading token is a
// four-character internal account code:
//
//	Account Number: JUGH Focused Growth and Income
//
// `internalFundCode` (header.go:415) requires a digit in the four characters,
// so the all-letter `JUGH` is not read as a code and never stripped; the whole
// string is looked up as a fund name and misses, although the residual stem
// `Focused Growth and Income` is a declared dictionary name (S000007586).
// The sibling `Account Number: JU68 Focused Dividend Strategy` -- same shape,
// digits in the code -- resolves. 1,253 rows in the full filing sit under
// all-letter codes whose stem is in the dictionary (Growth and Income 252,
// Large Cap Value 318, Multi Cap Value 275, Large Cap Growth 185, Multi Cap
// Growth 223).
func TestFamilyVV2SunAmericaAllLetterAccountCode(t *testing.T) {
	rows := familyVV2Dispatch(t, "sunamerica_letter_account_code.txt", "pvtext", 21)
	for _, r := range rows {
		if r.SeriesID != "S000007586" {
			t.Errorf("Account Number: JUGH Focused Growth and Income: fund=%q series=%q want S000007586", r.FundName, r.SeriesID)
		}
	}
}

// 000131/1311261/0000092230-05-000077.txt: 24-26, 139, 3713-3735. BB&T Variable
// Insurance Funds abbreviates the declared trailing type words `VARIABLE
// INSURANCE FUND` to `VIF` in every section banner:
//
//	=========================== BB&T MID CAP GROWTH VIF ============================
//
// The dictionary spells the fund out -- `BB&T MID CAP GROWTH VARIABLE INSURANCE
// FUND` (S000012132) -- and nothing expands the acronym, so the banner resolves
// to nothing. Two of the five sections resolve anyway through the distinctive
// stem (`BB&T SPECIAL OPPORTUNITIES`, `BB&T CAPITAL MANAGER EQUITY`), which is
// why the failure looks partial. 2,140 rows carry an unresolved VIF banner:
// LARGE CAP VALUE 868, LARGE CO. GROWTH 785, MID CAP GROWTH 487.
func TestFamilyVV2BBTVIFAcronymHeading(t *testing.T) {
	rows := familyVV2Dispatch(t, "bbt_vif_heading.txt", "issnpx", 9)
	for _, r := range rows {
		if r.SeriesID != "S000012132" {
			t.Errorf("BB&T MID CAP GROWTH VIF: fund=%q series=%q want S000012132", r.FundName, r.SeriesID)
		}
	}
}

// 000003/38403/0000038403-04-000027.txt: 24-26, 69, 3891-3910. Dreyfus Founders
// Funds prints a section for a fund the dictionary does not carry:
//
//	=================== DREYFUS FOUNDERS GROWTH AND INCOME FUND ====================
//
// The registrant's fifteen dictionary names include `Dreyfus Founders Growth
// Fund` (S000000567) but no Growth and Income fund at all. The banner is
// nonetheless stamped S000000567 -- the Growth Fund's id -- so 866 rows of a
// distinct fund are attributed to a sibling series. A name the dictionary
// cannot map must stay blank; a wrong series is worse than none, because
// downstream reconciliation cannot detect it.
func TestFamilyVV2DreyfusGrowthAndIncomeWrongStamp(t *testing.T) {
	rows := familyVV2Dispatch(t, "dreyfus_growth_and_income_heading.txt", "issnpx", 7)
	for _, r := range rows {
		if r.SeriesID != "" {
			t.Errorf("DREYFUS FOUNDERS GROWTH AND INCOME FUND: fund=%q series=%q want no series (not in the dictionary)", r.FundName, r.SeriesID)
		}
	}
}

// 000104/1040061/0001018218-04-000006.txt: 24-26, 974-993. GE Institutional
// Funds prints its own registrant name abbreviated in the section banner:
//
//	======================= GE INST STRATEGIC INV FUND (MF) ========================
//
// The registrant-prefix strip keys on the filing's `COMPANY CONFORMED NAME`
// (`GE INSTITUTIONAL FUNDS`) at a token boundary, so the shortened `GE INST`
// does not fire it and the whole banner is looked up as a fund name. The
// residual stem resolves on its own -- `STRATEGIC INV FUND (MF)` returns
// S000001632 and so does the unabbreviated `GE INSTITUTIONAL STRATEGIC INV FUND
// (MF)` -- so only the abbreviated prefix blocks it. 2,113 rows under this
// banner, plus 1,418 under the same shape spelled `GE INSTITUT'L US EQ (MF)`.
func TestFamilyVV2GEAbbreviatedRegistrantPrefix(t *testing.T) {
	rows := familyVV2Dispatch(t, "ge_abbreviated_registrant_prefix.txt", "issnpx", 7)
	for _, r := range rows {
		if r.SeriesID != "S000001632" {
			t.Errorf("GE INST STRATEGIC INV FUND (MF): fund=%q series=%q want S000001632", r.FundName, r.SeriesID)
		}
	}
}
