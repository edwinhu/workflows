package main

import (
	"path/filepath"
	"testing"
)

// familyMM1Dispatch runs the real dispatch on a family MM.1 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyMM1Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mm1", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_mm1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000092/924628/0001580642-16-010720.txt: 41-165 (the SGML series block) +
// 258-336 + 51520-51576. The section banner is a colspan cell reading
// "Registrant: Saratoga Advantage Trust- Health & Biotechnology Portfolio", but
// the SGML header declares that series MISSPELLED: "<SERIES-NAME>Health &
// Biotchnology Portfolio" for S000010884. The banner is therefore neither read
// nor resolved, while the second range's "Registrant:  Saratoga Advantage Trust
// - James Alpha Global Real Estate Investments Portfolio" -- whose declared
// spelling is exact -- resolves to S000033377 in the same fixture. The
// dictionary carries the CORRECT spelling for the CIK
// (0000924628 S000010884 "Health & Biotechnology Portfolio"), so a dictionary
// fallback for a heading the declared names miss would fix it. 2,066 of the
// filing's 4,125 rows carry no series and a blank fund_name.
func TestFamilyMM1SaratogaDeclaredNameTypo(t *testing.T) {
	rows := familyMM1Dispatch(t, "saratoga_declared_name_typo.txt", "htmltable", 6)
	for _, r := range rows {
		if r.IssuerName != "McKesson Corporation" {
			continue
		}
		if r.SeriesID != "S000010884" {
			t.Errorf("Registrant: Saratoga Advantage Trust- Health & Biotechnology Portfolio: fund=%q series=%q want S000010884", r.FundName, r.SeriesID)
		}
	}
}

// 000106/1062805/0000900092-04-000221.txt: 5252-5291. The equals-rule banner
// wraps over two lines and carries the registrant's own name with a COLON
// before the fund, "MERCURY MASTER TRUST: MERRILL LYNCH MASTER INTERNATIONAL /
// PORTFOL", with the tail truncated at the banner width. The dictionary has
// "Merrill Lynch Master International Portfolio" for the CIK (S000002289), but
// the registrant prefix is cut only at a space boundary and the truncated
// "PORTFOL" defeats an exact match. 1,414 rows sit under this banner.
func TestFamilyMM1MercuryRegistrantColonTruncatedBanner(t *testing.T) {
	rows := familyMM1Dispatch(t, "mercury_registrant_colon_wrapped.txt", "issnpx", 12)
	for _, r := range rows {
		if r.SeriesID != "S000002289" {
			t.Errorf("MERCURY MASTER TRUST: MERRILL LYNCH MASTER INTERNATIONAL PORTFOL: fund=%q series=%q want S000002289", r.FundName, r.SeriesID)
		}
	}
}
