package main

import (
	"path/filepath"
	"testing"
)

// familyJJ1SDispatch runs the real dispatch on a family JJ.1 no-series fixture
// with the registrant's own cik_series.tsv rows loaded as the dictionary.
func familyJJ1SDispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_jj1s", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_jj1s", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000075/751173/0001387131-23-010182.txt: 15-16, 155-158, 39605-39620,
// 40074-40089, 40126-40131. A page break leaves the PREVIOUS meeting's issuer
// name, "AIRBUS SE", alone in the heading slot two lines above the next block's
// dashed rule. It resolves to nothing, so it clears the fund set by
// "Manning & Napier Fund, Inc. Pro-Blend Maximum Term Series" and every block to
// the end of the section is filed under the issuer name with no series.
func TestFamilyJJ1SManningStrayIssuerSlot(t *testing.T) {
	rows := familyJJ1SDispatch(t, "manning_stray_issuer_slot.txt", "broadridge", 3)
	for _, r := range rows {
		if r.CUSIP != "F01764103" {
			continue // the 3M block that opens the section
		}
		if r.SeriesID != "S000003640" {
			t.Errorf("Air Liquide block after the stray slot: fund=%q series=%q want S000003640", r.FundName, r.SeriesID)
		}
	}
}

// 000092/926243/0001193125-05-178066.txt: 25-26, 94-190. The
// fund is labelled "Account Number: CBNA-4C13 Commerce Growth Fund" -- an
// alphanumeric account code, then the registrant's own brand in front of the
// dictionary's "The Growth Fund". The leading-code cut only fires on an
// all-digit token, so the code is carried into the lookup.
func TestFamilyJJ1SCommerceAccountNumberCode(t *testing.T) {
	rows := familyJJ1SDispatch(t, "commerce_account_number_code.txt", "htmltable", 1)
	for _, r := range rows {
		if r.CUSIP != "88579Y101" {
			t.Fatalf("identity precondition: CUSIP=%q", r.CUSIP)
		}
		if r.SeriesID != "S000010025" {
			t.Errorf("CBNA-4C13 Commerce Growth Fund: fund=%q series=%q want S000010025", r.FundName, r.SeriesID)
		}
	}
}

// 000077/773757/0001104659-07-066511.txt: 25-26, 658-661, 1093481-1093700.
// "Fund Name : Columbia Liberty Fund-C7P3"
// appends a hyphen-attached portfolio code to a name the header itself declares
// as "Columbia Liberty Fund"; the trailing-code cut only fires on a `#CODE`
// token separated by a space.
func TestFamilyJJ1SColumbiaFundNameClassSuffix(t *testing.T) {
	rows := familyJJ1SDispatch(t, "columbia_fundname_class_suffix.txt", "htmltable", 4)
	for _, r := range rows {
		if r.SeriesID != "S000012082" {
			t.Errorf("Columbia Liberty Fund-C7P3: fund=%q series=%q want S000012082", r.FundName, r.SeriesID)
		}
	}
}
