package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestISSNPXWrappedVoteCell pins a VOTE CELL that wraps.
//
// The proposal text is not the only column that runs onto a second physical
// line -- the vote does too, and `Did Not Vote` is printed as `Did Not` above
// `Vote`:
//
//	1     Accept 2005 Operating Results and    For      Did Not    Management
//	      Financial Statements                          Vote
//
// Read one line at a time the vote is `Did Not`, which is in no vocabulary, so
// the row emits a BLANK how_voted and the whole trailing cell block stays in the
// proposal text: `Accept 2005 Operating Results and  For  Did Not  Management`.
//
// Measured 2026-09-01 on two filings of this family, 961 of 14,680 rows (6.55%)
// are blank this way, and issnpx carries 2,275,259 blank votes corpus-wide
// against 166,403,081 rows. The value is not rare: `Did Not Vote` is what a fund
// reports when it held the security but the ballot never reached it.
func TestISSNPXWrappedVoteCell(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "D4_wrapped_vote_cell.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))

	var got []string
	for _, r := range rows {
		if strings.HasPrefix(r[colVoteDescription], "Accept 2005 Operating Results") {
			got = r
		}
	}
	if got == nil {
		t.Fatalf("the Accept 2005 Operating Results row is missing; got %d rows", len(rows))
	}
	if v := got[colHowVoted]; v != "Did Not Vote" {
		t.Errorf("how_voted = %q, want %q", v, "Did Not Vote")
	}
	if d := got[colVoteDescription]; strings.Contains(d, "Did Not") || strings.Contains(d, "Management") {
		t.Errorf("description %q still carries the trailing cells", d)
	}
}

// TestISSNPXWrappedSponsorColumn pins the Sponsor column that wraps to its own
// line.
//
// The proposal column is wide enough that Sponsor does not fit, so the report
// prints it BELOW the row -- including in its own header:
//
//	#     Proposal                                  Mgt Rec   Vote Cast
//	Sponsor
//	1.1   Elect  Director Carol Mills               For       For
//	Management
//
// issPeelColumns peels the sponsor first and the votes after it, so it needs
// both on one line. Here neither line has both: the row line ends in a vote and
// the continuation is a bare sponsor, so the peel fails on each and every cell
// stays in the proposal text.
//
// Measured 2026-09-01, this is the worst filing in the corpus by blank votes --
// 0000743773-05-000030.txt emits 44,696 rows and ALL 44,696 carry no vote.
func TestISSNPXWrappedSponsorColumn(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "D5_wrapped_sponsor_column.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))

	want := map[string]struct{ mgmt, cast, sponsor string }{
		"1.1": {"For", "For", "Management"},
		"1.4": {"For", "For", "Management"},
		"2":   {"For", "For", "Management"},
	}
	got := map[string][]string{}
	for _, r := range rows {
		got[r[colItemSeq]] = r
	}
	for item, w := range want {
		r, ok := got[item]
		if !ok {
			t.Errorf("item %s missing", item)
			continue
		}
		if r[colHowVoted] != w.cast {
			t.Errorf("item %s: how_voted = %q, want %q", item, r[colHowVoted], w.cast)
		}
		if r[colMgmtRec] != w.mgmt {
			t.Errorf("item %s: mgmt_rec = %q, want %q", item, r[colMgmtRec], w.mgmt)
		}
		if strings.Contains(r[colVoteDescription], "Management") {
			t.Errorf("item %s: description %q still carries the cells", item, r[colVoteDescription])
		}
	}
}
