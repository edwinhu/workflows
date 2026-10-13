package main

import (
	"path/filepath"
	"testing"
)

func familyII1Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ii1", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ii1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000004/49905/0001144204-11-049910.txt: 6464-6494. A parenthetical sub-adviser
// note sits between the fund heading and its "Investment Company Report" line,
// so the line-above rule reads the note instead of "The Hartford SmallCap
// Growth Fund".
func TestFamilyII1HartfordSubAdviserNote(t *testing.T) {
	rows := familyII1Dispatch(t, "hartford_subadviser_note.txt", "icr", 10)
	for _, r := range rows {
		if r.CUSIP != "65440K106" || r.MeetingDate != "20100914" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000004014" {
			t.Errorf("The Hartford SmallCap Growth Fund: fund=%q series=%q want S000004014", r.FundName, r.SeriesID)
		}
	}
}

// 000035/353968/0000820027-04-000735.txt: 20630-20648. The banner heading carries
// the registrant's historical AXP brand, "AXP VARIABLE PORTFOLIO - S&P 500 INDEX
// FUND", against the dictionary's "RiverSource Variable Portfolio S&P 500 Index
// Fund".
func TestFamilyII1AXPRiverSourceBrandHeading(t *testing.T) {
	rows := familyII1Dispatch(t, "axp_riversource_brand.txt", "issnpx", 7)
	for _, r := range rows {
		if r.CUSIP != "88579Y101" || r.MeetingDate != "20040511" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000003386" {
			t.Errorf("AXP Variable Portfolio - S&P 500 Index Fund: fund=%q series=%q want S000003386", r.FundName, r.SeriesID)
		}
	}
}

// 000084/844779/0001193125-04-147200.txt: 21896-21913. The heading adds the type
// words "EQUITY PORTFOLIO" and a hyphen to the dictionary's stem name
// "BLACKROCK MID CAP VALUE".
func TestFamilyII1BlackRockMidCapValuePortfolio(t *testing.T) {
	rows := familyII1Dispatch(t, "blackrock_midcap_value_portfolio.txt", "issnpx", 3)
	for _, r := range rows {
		if r.CUSIP != "002896207" || r.MeetingDate != "20040520" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000001871" {
			t.Errorf("BlackRock Mid-Cap Value Equity Portfolio: fund=%q series=%q want S000001871", r.FundName, r.SeriesID)
		}
	}
}

// 000074/746687/0000040559-11-000010.txt: 187-206, 20858-20882. The banner
// heading abbreviates the registrant to the initialism "GEI" and drops the
// declared name's trailing "Fund": "GEI S&P 500 INDEX" against the header's own
// "S&P 500 Index Fund".
func TestFamilyII1GEIInitialismHeading(t *testing.T) {
	rows := familyII1Dispatch(t, "ge_gei_prefix_index.txt", "issnpx", 12)
	for _, r := range rows {
		if r.CUSIP != "88579Y101" || r.MeetingDate != "20110510" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000001648" {
			t.Errorf("GEI S&P 500 INDEX: fund=%q series=%q want S000001648", r.FundName, r.SeriesID)
		}
	}
}
