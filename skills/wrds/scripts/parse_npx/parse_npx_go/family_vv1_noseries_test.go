package main

import (
	"path/filepath"
	"testing"
)

// familyVV1Dispatch runs the real dispatch on a family VV.1 fixture with the
// registrant's own cik_series.tsv rows loaded as the dictionary.
func familyVV1Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_vv1", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_vv1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000150/1502745/0001580642-23-004172.txt: 7, 14-16, 46-49, 66-69, 86-89,
// 200-202, 244-300. Copeland Trust declares three series in its own header --
// `Copeland Dividend Growth Fund` S000030695, `Copeland International Risk
// Managed Dividend Growth Fund` S000039172, `Copeland SMID Cap Dividend Growth
// Fund` S000056507 -- and prints each section's fund in a `Registrant:` cell:
//
//	<TD COLSPAN="4" ...>Registrant:<FONT ...><U>&nbsp;&nbsp;&nbsp;Copeland Trust - Copeland Risk Managed Dividend Growth Fund</U></FONT></TD>
//
// `Copeland Risk Managed Dividend Growth Fund` is the domestic fund: the
// dictionary carries it as S000030695's 2011 name. The declared International
// name is that heading with one word inserted, so the added-word rule stamps
// S000039172 instead and the section's 873 rows -- the whole first section of
// the filing -- are attributed to the wrong fund.
func TestFamilyVV1CopelandRiskManagedHeading(t *testing.T) {
	rows := familyVV1Dispatch(t, "copeland_risk_managed_heading.txt", "copeland_dict.tsv", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000030695" {
			t.Errorf("Copeland Risk Managed Dividend Growth Fund: fund=%q issuer=%q series=%q want S000030695", r.FundName, r.IssuerName, r.SeriesID)
		}
	}
}

// 000094/948666/0001144204-04-013568.txt: 17, 24-26, 129-200. Penn
// Street Fund, Inc. declares no series in its 2004 header; the dictionary backs
// it with two -- `Penn Street Advisors Sector Rotational Portfolio` S000001801
// and `Berkshire Advisors Select Equity Portfolio` S000001802. The filing prints
// one sleeve per section as a bare banner above the vote table:
//
//	<DIV><font size="1">Form N-PX Sector<br>
//	  7/1/03 through 6/30/04<br>
//
// and later `Form N-PX Berkshire`. The layout never reads the banner, so every
// row carries a blank fund name and a blank series. 877 rows in the full filing
// carry no series; the Sector section is 117 of them and the Berkshire section
// 283.
func TestFamilyVV1PennStreetSleeveBanner(t *testing.T) {
	rows := familyVV1Dispatch(t, "pennstreet_sleeve_banner.txt", "pennstreet_dict.tsv", "htmltable", 2)
	for _, r := range rows {
		if r.SeriesID != "S000001801" {
			t.Errorf("Form N-PX Sector: fund=%q issuer=%q series=%q want S000001801", r.FundName, r.IssuerName, r.SeriesID)
		}
	}
}

// 000100/1005942/0000928816-04-000802.txt: 17, 24-26, 108-124, 1448-1466.
// Putnam Funds Trust's 2004 header declares no series and the dictionary backs
// it with 51. The filing prints one account heading per fund:
//
//	Account Number: Putnam Small Cap Growth Fund
//	Account Number: Putnam Growth Fund
//
// Only the first is a dictionary name (S000000777). `Putnam Growth Fund` is not
// in the dictionary under any id, but a dropped-word match stamps it S000000777
// too, so two accounts printed side by side in one filing -- 203 rows and 920
// rows -- are reported as the same registered series. A heading that differs
// from a declared name by a whole noun is a different fund and must stay blank.
func TestFamilyVV1PutnamGrowthFundAccountCollision(t *testing.T) {
	rows := familyVV1Dispatch(t, "putnam_growth_fund_account.txt", "putnam_dict.tsv", "pvtext", 7)
	for _, r := range rows {
		if r.FundName == "Putnam Growth Fund" && r.SeriesID != "" {
			t.Errorf("Putnam Growth Fund: issuer=%q series=%q want blank -- S000000777 is the sibling Putnam Small Cap Growth Fund account in the same filing", r.IssuerName, r.SeriesID)
		}
	}
}
