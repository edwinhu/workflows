package main

import (
	"path/filepath"
	"testing"
)

func familyJJ2IssuerDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_jj2", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_jj2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000120/1209466/0001438934-08-000267.txt: 17; 25-26; 173572-173620. This block
// opens like every other block of the grammar -- a dashed rule, then the ISSUER
// beside `Agenda Number:` -- and sits inside the `PowerShares FTSE RAFI US 1000
// Portfolio` section that opened at line 151005:
//
//	PLAINS EXPLORATION & PRODUCTION CO.                Agenda Number:  932847796
//
// parseBroadridge reads the text left of `Agenda Number:` as a candidate fund
// heading (the inline-agenda branch, layout_broadridge.go:786-799) and accepts it
// when issResolveFund returns a series. Its comment states that "an issuer name
// never does"; this issuer does. `PLAINS EXPLORATION & PRODUCTION CO.` resolves
// to S000003041, `PowerShares Dynamic Energy Exploration & Production Portfolio`,
// so the issuer becomes the section's fund and its series is stamped on this
// block AND on every following block until the next real heading -- here PLUM
// CREEK TIMBER, which belongs to the RAFI US 1000 portfolio (S000011995).
//
// This is a wrong series_id rather than a blank one. Across the filing the four
// PLAINS blocks (lines 43661, 131390, 173577, 213653) carry 6,203 of its 72,428
// rows under fund name `PLAINS EXPLORATION & PRODUCTION CO.`, all stamped
// S000003041; three of the four sections they hijack are other portfolios.
func TestFamilyJJ2PowerSharesIssuerNameTakenAsFundHeading(t *testing.T) {
	rows := familyJJ2IssuerDispatch(t, "powershares_plains_issuer_as_fund.txt", "dict_1209466.tsv", "broadridge", 14)
	for _, r := range rows {
		if r.CUSIP != "726505100" && r.CUSIP != "729251108" {
			t.Fatalf("identity precondition: CUSIP=%q issuer=%q", r.CUSIP, r.IssuerName)
		}
		if r.FundName == r.IssuerName || r.FundName == "PLAINS EXPLORATION & PRODUCTION CO." {
			t.Errorf("issuer taken as fund heading: issuer=%q fund=%q series=%q", r.IssuerName, r.FundName, r.SeriesID)
		}
		if r.SeriesID == "S000003041" {
			t.Errorf("issuer heading stamped a series: issuer=%q fund=%q series=%q want not S000003041", r.IssuerName, r.FundName, r.SeriesID)
		}
	}
}
