package main

import (
	"path/filepath"
	"testing"
)

// familyXX2Dispatch runs the real dispatch on a family XX.2 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyXX2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_xx2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_xx2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000080/806636/0000950144-05-009091.txt: 24-26, 60-71, 296-500. Longleaf
// Partners Funds Trust heads each of its three sections with the fund name and
// the reporting period on ONE line:
//
//	<DIV align="left" style="font-size: 10pt; margin-top: 12pt"><B>Longleaf Partners Fund</B>&nbsp;...&nbsp;<B>For the Period July&nbsp;1, 2004 &#151; June&nbsp;30, 2005</B>
//
// Nothing cuts the trailing reporting-period phrase before the lookup, so the
// heading only ever resolves when a rung can pick the fund out of the joined
// string on rare tokens alone. The two siblings do -- `Longleaf Partners Small
// Cap Fund ... For the Period ...` -> S000009312 and `... International Fund
// ...` -> S000009313, both carried by a distinctive token or pair. The
// FLAGSHIP cannot: every word of `Longleaf Partners Fund` is shared with its
// siblings and its only pair ends in a type word, so the section resolves to
// nothing even though `Longleaf Partners Fund` IS the declared name of
// S000009311, exactly. 275 rows of the 659 in the full filing sit under that
// heading with no series and no fund name; both siblings resolve.
func TestFamilyXX2LongleafFlagshipPeriodTail(t *testing.T) {
	rows := familyXX2Dispatch(t, "longleaf_partners_fund_heading.txt", "htmltable", 4)
	for _, r := range rows {
		if r.SeriesID != "S000009311" {
			t.Errorf("Longleaf Partners Fund / For the Period: fund=%q series=%q want S000009311", r.FundName, r.SeriesID)
		}
	}
}

// 000146/1469030/0001193125-13-350400.txt: 14-16, 284-289, 4380-4414. Russell
// Exchange Traded Funds Trust prints the icr `Fund Name:` value WRAPPED, with
// the filing's blank line between the two halves:
//
//	Fund Name: RETFT Russell 2000 High
//
//	Volatility ETF
//
// Only the first line is read, so the section's fund is `RETFT Russell 2000
// High` -- a stem three declared series share (High Momentum S000032574, High
// Beta S000032588, High Volatility S000032590) -- and nothing can be stamped.
// The continuation is the filing's own bytes and names the fund exactly. Two
// sections in the full filing wrap this way: `RETFT Russell 2000 High` /
// `Volatility ETF` (535 rows, S000032590) and `RETFT Russell 1000 Low` /
// `Volatility ETF` (168 rows, S000032584), 703 of the filing's 7,756 rows;
// every unwrapped sibling heading resolves.
func TestFamilyXX2RussellWrappedFundNameValue(t *testing.T) {
	rows := familyXX2Dispatch(t, "russell_wrapped_fund_name.txt", "icr", 8)
	for _, r := range rows {
		if r.SeriesID != "S000032590" {
			t.Errorf("RETFT Russell 2000 High / Volatility ETF: fund=%q series=%q want S000032590", r.FundName, r.SeriesID)
		}
	}
}

// 000146/1469030/0001193125-13-350400.txt: 14-16, 284-289, 16524-16555. The
// same registrant prints one heading with the fund's strategy in a MEDIAL
// parenthetical the header never carried:
//
//	Fund Name : RETFT Russell Small Cap Aggressive Growth (Earnings Momentum) ETF
//
// The declared name is `Russell Small Cap Aggressive Growth ETF`
// (S000034103); a trailing parenthetical is cut before the lookup, but one
// sitting between the name and its type word is not, so the heading resolves
// to nothing. 286 rows of the full filing.
func TestFamilyXX2RussellMedialParenthetical(t *testing.T) {
	rows := familyXX2Dispatch(t, "russell_medial_parenthetical.txt", "icr", 8)
	for _, r := range rows {
		if r.SeriesID != "S000034103" {
			t.Errorf("RETFT Russell Small Cap Aggressive Growth (Earnings Momentum) ETF: fund=%q series=%q want S000034103", r.FundName, r.SeriesID)
		}
	}
}

// 000088/882748/0000950152-04-006534.txt: 24-26, 51-57, 2106-2108, 2136-2153,
// 3615-3634. The Coventry Group declares four series under names carrying NO
// type word at all -- `Income`, `Tax Exempt Income`, `Large Cap Growth`,
// `Shelby` (S000008175-8) -- and its banners print the brand and the type word
// the declaration omits:
//
//	========================= SIGNAL LARGE CAP GROWTH FUND =========================
//	================================= SHELBY FUND ==================================
//
// Cutting the registrant's brand is not enough here, because `Coventry Group`
// is not the brand printed: the family name is in the section opener (`Item 1.
// Signal Funds` / `Item 1. Shelby Funds`) and the declared name is the residue
// after the brand AND the type word come off. Neither banner resolves; the
// sibling `SHELBY LARGE CAP FUND`, whose declared name is spelled in full,
// does (S000009928, 1,007 rows). 1,071 of the filing's 2,078 rows -- 687 under
// SIGNAL LARGE CAP GROWTH FUND and 384 under SHELBY FUND.
func TestFamilyXX2CoventryTypelessDeclaredName(t *testing.T) {
	rows := familyXX2Dispatch(t, "coventry_signal_typeless_decl.txt", "issnpx", 7)
	want := map[string]string{
		"SIGNAL LARGE CAP GROWTH FUND": "S000008177",
		"SHELBY FUND":                  "S000008178",
	}
	for _, r := range rows {
		if r.SeriesID != want[r.FundName] {
			t.Errorf("%s: series=%q want %s", r.FundName, r.SeriesID, want[r.FundName])
		}
	}
}

// 000167/1676326/0001140361-24-039512.txt: 14-16, 229-307 (two of the fifteen
// <seriesReports> blocks), 388-393 and the two <inf:proxyTable> records of the
// vote table that carry no <inf:voteSeries>. This modern XML filing declares
// its fifteen series in primary_doc.xml under the seriesPage spelling:
//
//	<seriesReports>
//	  <idOfSeries>S000077958</idOfSeries>
//	  <nameOfSeries>Calvert International Responsible Index ETF</nameOfSeries>
//
// parsePrimaryDoc registers a series only from an element named `seriesId`
// (with `classId` beneath it), so this registry is read as empty. 665 of the
// filing's 75,522 proxyTable records omit <inf:voteSeries> -- the form's way of
// saying the vote covers every series the report includes, which the header
// states as <rptIncludeAllSeriesFlag>true</rptIncludeAllSeriesFlag> -- and the
// all-series fan-out is gated on `len(classes) >= 2`, so with an empty registry
// those 665 rows leave the series blank instead of carrying every declared id.
func TestFamilyXX2CalvertIdOfSeriesRegistry(t *testing.T) {
	rows := familyXX2Dispatch(t, "calvert_idofseries_registry.txt", "", 2)
	for _, r := range rows {
		if r.SeriesID != "S000077958;S000077959" {
			t.Errorf("proxyTable with no voteSeries: issuer=%q series=%q want the fixture's declared series S000077958;S000077959", r.IssuerName, r.SeriesID)
		}
	}
}
