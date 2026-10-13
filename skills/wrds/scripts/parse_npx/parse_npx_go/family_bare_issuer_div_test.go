package main

import (
	"os"
	"path/filepath"
	"testing"
)

// FundVantage Trust 2011 (CIK 1388485, 0000950123-11-081621; 4,459 rows with no
// cusip and 7 with no date on HEAD, the largest unfloored family in the secdate
// hill-climb ranking): this record prints its issuer name as a BARE, UNLABELED
// <DIV> line -- `MASTERCARD INCORPORATED` -- sitting between the fund-name
// header (`<B><U>Corverus Strategic Equity Fund</U></B>`) and the labeled
// `Location Name:` / `Ticker:` / `Primary Security ID:` / `CUSIP:` /
// `Meeting Date:` label-value grid that follows. The existing label-value-grid
// grammar (htmltable_label_value_grid_test.go, htmltable_identity_blocks_test.go)
// reads only labelled cells, so the bare issuer line is never picked up. The
// grid does recover the cusip, ticker and meeting date; what it cannot supply is
// the issuer, so the issuer slot is filled from the first grid cell instead --
// and because that cell's label wraps across two source lines (`Location` /
// `Name:  Piedmont Investment Advisers LLC`), every one of this record's rows is
// attributed to the sub-adviser fragment `Name: Piedmont Investment Advisers LLC`
// rather than to MASTERCARD INCORPORATED.
func TestFamilyBareIssuerDivIdentity(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "family_bare_issuer_div",
		"fundvantage2011_bare_issuer_div.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatalf("no rows parsed")
	}
	var item1 []string
	for _, r := range rows {
		t.Logf("row: issuer=%q cusip=%q ticker=%q date=%q item=%q desc=%q",
			r[colIssuerName], r[colCUSIP], r[colTicker], r[colMeetingDate],
			r[colItemSeq], r[colVoteDescription])
		if r[colVoteDescription] == "Declassify the Board of Directors" {
			item1 = r
		}
	}
	if item1 == nil {
		t.Fatalf("no row for item 1 'Declassify the Board of Directors' among %d rows", len(rows))
	}
	if item1[colIssuerName] != "MASTERCARD INCORPORATED" {
		t.Errorf("issuer %q, want MASTERCARD INCORPORATED", item1[colIssuerName])
	}
	if item1[colCUSIP] != "57636Q104" {
		t.Errorf("security id / cusip %q, want 57636Q104", item1[colCUSIP])
	}
	if item1[colMeetingDate] != "20100921" {
		t.Errorf("meeting date %q, want 20100921", item1[colMeetingDate])
	}
}
