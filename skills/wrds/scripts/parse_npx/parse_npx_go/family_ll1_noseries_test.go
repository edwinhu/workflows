package main

import (
	"path/filepath"
	"testing"
)

// familyLL1Dispatch runs the real dispatch on a family LL.1 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyLL1Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ll1", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ll1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000104/1040612/0000950137-05-010894.txt: 89-132. This vintage opens each fund
// section with three centred lines -- the fund, the report title "PROXY VOTING
// SUMMARY REPORT" and the reporting period -- and prints no rule at all. The
// only title parseISSNPX accepts above a period line is "Proxy Voting Records",
// so no banner is ever read: fund_name is blank on all 2,374 rows of the filing
// and the dictionary name "International Stock Fund" is never consulted.
func TestFamilyLL1MembersSummaryReportBanner(t *testing.T) {
	rows := familyLL1Dispatch(t, "madison_summary_report_banner.txt", "issnpx", 11)
	for _, r := range rows {
		if r.SeriesID != "S000020652" {
			t.Errorf("MEMBERS INTERNATIONAL STOCK FUND: fund=%q series=%q want S000020652", r.FundName, r.SeriesID)
		}
	}
}

// 000090/906185/0000906185-04-000016.txt: 37710-37745. The equals-rule banner is
// read, but every heading carries "ASPEN " -- the registrant's MIDDLE token
// ("JANUS ASPEN SERIES"). newISSSeriesIndex builds brands from the registrant's
// leading runs, trailing runs and initials, and single tokens only from six
// letters up, so neither "aspen" nor a strip of the whole registrant name fires
// and the dictionary's "Worldwide Growth Portfolio" is never reached. 16,748 of
// the filing's 17,191 rows carry no series, all under ASPEN-prefixed headings.
func TestFamilyLL1JanusAspenRegistrantMiddleToken(t *testing.T) {
	rows := familyLL1Dispatch(t, "janus_aspen_tail_brand.txt", "issnpx", 15)
	for _, r := range rows {
		if r.SeriesID != "S000010402" {
			t.Errorf("ASPEN WORLDWIDE GROWTH PORTFOLIO: fund=%q series=%q want S000010402", r.FundName, r.SeriesID)
		}
	}
}

// 000082/825316/0000919574-06-002485.txt: 24352-24380. The heading glues a
// fund-family prefix to the fund with a hyphen and no space,
// "ALLIANCEBERNSTEIN VARIABLE SERIES FUND-VALUE PORTFOLIO", for a header-declared
// "AllianceBernstein Value Portfolio". The prefix is not the registrant name
// ("ALLIANCEBERNSTEIN VARIABLE PRODUCTS SERIES FUND INC"), and nothing cuts a
// hyphen-glued prefix, so the whole string is looked up and misses. 8,055 rows of
// this filing sit under twelve such headings.
func TestFamilyLL1AllianceBernsteinHyphenGluedBrand(t *testing.T) {
	rows := familyLL1Dispatch(t, "ab_hyphen_brand_prefix.txt", "issnpx", 8)
	for _, r := range rows {
		if r.SeriesID != "S000010441" {
			t.Errorf("ALLIANCEBERNSTEIN VARIABLE SERIES FUND-VALUE PORTFOLIO: fund=%q series=%q want S000010441", r.FundName, r.SeriesID)
		}
	}
}

// 000082/825316/0000919574-06-002485.txt: 1056-1085. The same filing's largest
// block wraps the banner over two rules, and the reassembled name is the
// registrant's own name glued to the fund by "INC.-" with the tail truncated at
// the banner width: "... SERIES FUND INC.-ALLIANCEBERNSTEIN BALANCED WEALTH
// STRATEGY PORT" for a declared "AllianceBernstein Balanced Wealth Strategy
// Portfolio". lookupSeriesStrippingRegistrant needs a space at the token
// boundary, so the "INC.-" glue defeats it. 2,535 rows.
func TestFamilyLL1AllianceBernsteinWrappedRegistrantGlue(t *testing.T) {
	rows := familyLL1Dispatch(t, "ab_wrapped_registrant_hyphen.txt", "issnpx", 8)
	for _, r := range rows {
		if r.SeriesID != "S000010443" {
			t.Errorf("INC.-ALLIANCEBERNSTEIN BALANCED WEALTH STRATEGY PORT: fund=%q series=%q want S000010443", r.FundName, r.SeriesID)
		}
	}
}

// 000089/890339/0001193125-04-181589.txt: 55-59 + 84-250. The "Fund:" cell prints the
// abbreviated marketing name, "Fund: Target Large Cap Value Portfolio", while
// every dictionary name for the CIK spells the word out ("LARGE CAPITALIZATION
// VALUE"). The sections whose names are not abbreviated resolve in this same
// filing (Target International Equity Portfolio -> S000004685), so the heading is
// read and only the Cap/Capitalization spelling separates it from the dictionary.
// 2,292 of 3,696 rows.
func TestFamilyLL1TargetCapAbbreviation(t *testing.T) {
	rows := familyLL1Dispatch(t, "target_cap_abbreviation.txt", "htmltable", 4)
	for _, r := range rows {
		if r.SeriesID != "S000004688" {
			t.Errorf("Fund: Target Large Cap Value Portfolio: fund=%q series=%q want S000004688", r.FundName, r.SeriesID)
		}
	}
}

// 000077/778205/0001144204-05-027466.txt: 29847-30010. The fund heading is a
// colspan cell of the FIRST row INSIDE the vote table, "Account Number: 204 S&P
// Mid Cap Index Fund", not a paragraph between two tables, so htmlBareFundLine
// never sees it -- its account-number peel would resolve the name if it did
// (the peeled "S&P Mid Cap Index Fund" hits S000011278 in the dictionary). All
// 2,351 rows of the filing carry no series and a blank fund_name.
func TestFamilyLL1CalTrustHeadingInsideVoteTable(t *testing.T) {
	rows := familyLL1Dispatch(t, "caltrust_heading_in_table.txt", "htmltable", 2)
	for _, r := range rows {
		if r.SeriesID != "S000011278" {
			t.Errorf("Account Number: 204 S&P Mid Cap Index Fund: fund=%q series=%q want S000011278", r.FundName, r.SeriesID)
		}
	}
}
