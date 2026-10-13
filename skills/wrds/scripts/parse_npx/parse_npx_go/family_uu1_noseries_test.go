package main

import (
	"path/filepath"
	"testing"
)

// familyUU1Dispatch runs the real dispatch on a family UU.1 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyUU1Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_uu1", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_uu1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000076/768847/0000768847-09-000161.txt: 24-26, 49-110, 14883-14905. Van Eck
// Funds declares three series in its own header -- `Emerging Markets Fund`
// S000009198, `International Investors Gold Fund` S000009199, `Global Hard
// Assets Fund` S000009200 -- and the sibling section heading `VAN ECK GLOBAL
// HARD ASSETS FUND` resolves through the registrant-prefix strip. The gold
// fund's heading is misprinted twice over:
//
//	VAN EKK INT'L INVESTORS GOLD FUND
//
// `EKK` is a typo for the registrant's own `ECK`, so the prefix strip does not
// fire, and `INT'L` is an abbreviation of the declared `International`, so the
// residual stem does not match either. 526 rows in the full filing carry this
// heading with no series.
func TestFamilyUU1VanEckAbbreviatedTypoHeading(t *testing.T) {
	rows := familyUU1Dispatch(t, "vaneck_gold_typo_heading.txt", "broadridge", 10)
	for _, r := range rows {
		if r.SeriesID != "S000009199" {
			t.Errorf("VAN EKK INT'L INVESTORS GOLD FUND: fund=%q series=%q want S000009199", r.FundName, r.SeriesID)
		}
	}
}

// 000004/44402/0000898432-08-000890.txt: 24-26, 565-600. Neuberger Berman
// Equity Funds prints each section's fund name as a bare heading above the
// reporting-period line, and this one carries a parenthetical rename marker
// that the filer wrapped across two physical lines:
//
//	Neuberger Berman Small and Mid Cap Growth Fund (formerly, Neuberger Berman All
//	Cap Growth Fund)
//
// The heading slot therefore holds a truncated name ending in `All`, which
// matches neither the declared `Neuberger Berman Small and Mid Cap Growth Fund`
// (S000013239) nor the former name whose second half is on the next line. 1,002
// rows in the full filing -- the whole first section, AerCap Holdings NV through
// Gamesa Corp. Technologica -- carry no fund name and no series.
func TestFamilyUU1NeubergerWrappedFormerlyHeading(t *testing.T) {
	rows := familyUU1Dispatch(t, "neuberger_wrapped_formerly_heading.txt", "icr", 10)
	for _, r := range rows {
		if r.SeriesID != "S000013239" {
			t.Errorf("Neuberger Berman Small and Mid Cap Growth Fund: fund=%q series=%q want S000013239", r.FundName, r.SeriesID)
		}
	}
}

// 000143/1437249/0001193125-17-268081.txt: 14-16, 106378-106382, 106780-106850.
// Valued Advisers Trust's LS Opportunity section opens with a bold fund heading
// that resolves to S000029069:
//
//	<P STYLE="..."><B>LS Opportunity Fund Vote Summary Report </B></P>
//
// Its issuers are printed in the same bold-paragraph shape. The first issuer of
// each block is appended to the closing `</TABLE>` line and is read as an
// issuer, but the page-continuation REPEAT of that issuer stands alone:
//
//	<P STYLE="..."><B>Aflac Incorporated </B></P>
//
// which the layout reads as a fund heading, fails to resolve, and lets clear the
// section's fund. Everything after it loses the series: 981 rows in the full
// filing, the whole remainder of the LS Opportunity section.
func TestFamilyUU1LSOpportunityRepeatedIssuerHeading(t *testing.T) {
	rows := familyUU1Dispatch(t, "ls_opportunity_repeated_issuer_heading.txt", "htmltable", 1)
	for _, r := range rows {
		if r.SeriesID != "S000029069" {
			t.Errorf("LS Opportunity Fund: fund=%q issuer=%q series=%q want S000029069", r.FundName, r.IssuerName, r.SeriesID)
		}
	}
}
