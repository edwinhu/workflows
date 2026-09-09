package main

import (
	"path/filepath"
	"testing"
)

// familyJJ1Dispatch runs the real dispatch on a family JJ fixture with the
// registrant's own cik_series.tsv rows loaded as the dictionary.
func familyJJ1Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_jj1", "dict_headings.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_jj1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000075/751173/0001387131-23-010182.txt: 39604-39623, 40074-40089, 40126-40131.
// A stray column-0 issuer name, "AIRBUS SE", is printed in the fund-heading slot
// above a block whose own issuer is AIR LIQUIDE SA. It resolves to nothing, so
// the heading state clears and the rest of the "Manning & Napier Fund, Inc.
// Pro-Blend Maximum Term Series" section loses its series.
func TestFamilyJJ1ManningNapierStrayIssuerHeading(t *testing.T) {
	rows := familyJJ1Dispatch(t, "manning_napier_stray_issuer.txt", "broadridge", 4)
	for _, r := range rows {
		if r.SeriesID != "S000003640" {
			t.Errorf("Pro-Blend Maximum Term Series: issuer=%q fund=%q series=%q want S000003640", r.IssuerName, r.FundName, r.SeriesID)
		}
	}
}

// 000092/926243/0001193125-05-178066.txt: 91-935. The section heading is a
// labelled, underlined account line -- "Account Number: CBNA-4C13 Commerce
// Growth Fund" -- carrying an account code and the registrant's brand before
// the dictionary's "The Growth Fund".
func TestFamilyJJ1CommerceAccountNumberHeading(t *testing.T) {
	rows := familyJJ1Dispatch(t, "commerce_account_number_heading.txt", "htmltable", 43)
	if rows[0].CUSIP != "88579Y101" || rows[0].MeetingDate != "20050510" {
		t.Fatalf("identity precondition: CUSIP=%q date=%q", rows[0].CUSIP, rows[0].MeetingDate)
	}
	for _, r := range rows {
		if r.SeriesID != "S000010025" {
			t.Errorf("CBNA-4C13 Commerce Growth Fund: fund=%q series=%q want S000010025", r.FundName, r.SeriesID)
		}
	}
}

// 000119/1199046/0001193125-13-345294.txt: 6887-6897, 10784-10840. Unified
// Series Trust staples one sub-adviser report per series; the fund is named once
// per report in the labelled line "Fund/Fund Family Name: The Auer Growth
// Fund/SB Auer Funds, LLC", which the layout never reads as a heading, so every
// vote block under it carries no fund at all.
func TestFamilyJJ1UnifiedFundFamilyNameLabel(t *testing.T) {
	rows := familyJJ1Dispatch(t, "unified_fund_family_label.txt", "broadridge", 17)
	for _, r := range rows {
		if r.CUSIP != "001204106" || r.MeetingDate != "20130430" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000020493" {
			t.Errorf("Fund/Fund Family Name: The Auer Growth Fund: fund=%q series=%q want S000020493", r.FundName, r.SeriesID)
		}
	}
}

// 000077/773757/0001104659-07-066511.txt: 1093481-1093937. The heading is the
// declared series name with a trailing account/portfolio code: "Fund Name :
// Columbia Liberty Fund-C7P3" against the header's own declaration of "Columbia
// Liberty Fund".
func TestFamilyJJ1ColumbiaLibertyAccountSuffix(t *testing.T) {
	rows := familyJJ1Dispatch(t, "columbia_liberty_account_suffix.txt", "htmltable", 16)
	for _, r := range rows {
		if r.CUSIP != "CUSIP9 002824100" || r.MeetingDate != "20070427" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000012082" {
			t.Errorf("Columbia Liberty Fund-C7P3: fund=%q series=%q want S000012082", r.FundName, r.SeriesID)
		}
	}
}
