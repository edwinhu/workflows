package main

import "testing"

// SunAmerica Series Trust 2005 (0000950129-05-008755, 28,965 rows with no
// fund on r207; 465,597 across the layout's declaring registrants): each fund
// section opens with `Account Number: JU77 Alliance Growth Portfolio` above the
// header, the account code and the fund's name on one label line. The layout
// read no fund at all, so every row went out without one.
func TestPVTextAccountNumberFund(t *testing.T) {
	rows := runISSNPXDoc(t, loadPVFixture(t, "P_account_number_fund.txt"))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "ACE" {
			continue
		}
		seen++
		if r[colFundName] != "JU77 Alliance Growth Portfolio" || r[colMeetingDate] != "20050526" {
			t.Fatalf("ACE: fund %q date %q (%s)", r[colFundName], r[colMeetingDate], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no ACE rows among %d", len(rows))
	}
	// With the registrant's series known (the header, or the CIK dictionary
	// standing in for a 2005 header), the coded heading resolves.
	meta := FilingMeta{SeriesDecls: []SeriesDecl{{SeriesID: "S000008081", Name: "Alliance Growth Portfolio"}, {SeriesID: "S000008099", Name: "Emerging Markets Portfolio"}}}
	typed, err := parsePVText(loadPVFixture(t, "P_account_number_fund.txt"), meta)
	if err != nil {
		t.Fatal(err)
	}
	stamped := 0
	for _, r := range typed {
		if r.IssuerName != "ACE" {
			continue
		}
		if r.SeriesID != "S000008081" {
			t.Fatalf("ACE: series %q, want S000008081", r.SeriesID)
		}
		stamped++
	}
	if stamped == 0 {
		t.Fatalf("no typed ACE rows among %d", len(typed))
	}
}
