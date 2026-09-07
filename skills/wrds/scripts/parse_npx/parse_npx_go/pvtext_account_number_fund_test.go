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
}
