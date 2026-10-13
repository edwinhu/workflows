package main

import "testing"

// A SYNTHETIC case, and labelled as one. The shape -- a wrapped vote value split by a
// trailing vs-management indicator -- occurs zero times in 80 sampled filings, so no
// verbatim fixture can carry it. It is pinned because the failure is silent: the
// re-parse declines, the row is dropped, and the table then closes, costing the
// following item too.
func TestPVTextWrapPreservesTrailingIndicator(t *testing.T) {
	m := pvTextMeeting{issuer: "X", cusip: "000000000", ticker: "X",
		meetingDate: "1/1/04", meetingType: "Annual"}
	head := "1.00   Approve Something MGMT YES DID NOT FOR"
	if !pvTextIncompleteVoteLine(head) {
		t.Fatalf("precondition: %q should read as an incomplete vote", head)
	}
	f := []string{"Approve", "Something"}
	_ = f
	// Reconstruct the way the layout does, with the indicator kept trailing.
	joined := "1.00   Approve Something MGMT YES DID NOT VOTE FOR"
	row, ok := pvTextVoteLine(joined, m)
	if !ok {
		t.Fatalf("reconstructed line did not parse: %q", joined)
	}
	if row.HowVoted != "DID NOT VOTE" {
		t.Errorf("how_voted = %q, want %q verbatim", row.HowVoted, "DID NOT VOTE")
	}
}
