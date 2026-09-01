package main

import (
	"strings"
	"testing"
)

// colVoteOtherInfo is the VOTED? column of votes.tsv, the field vanguard
// already uses for the same purpose.
const colVoteOtherInfo = 29

// TestPVTextRecordsTheVotedColumn pins the VOTED? column on a row the fund did
// NOT vote.
//
//	1.80   ELECT DIRECTOR ANTHONY S. THORNLEY    MGMT   YES   FOR   FOR
//	1.00   APPROVE MERGER AGREEMENT              MGMT   NO
//
// A `NO` in VOTED? means no vote was cast, and this layout is right to leave
// how_voted EMPTY rather than inventing `NOT VOTED` -- pvTextVoteLine already
// says so, and already reads fields[p+1] to recognise the shape.
//
// But it then DISCARDS the value, so the row is indistinguishable from one the
// parser failed on. Measured 2026-09-01 the corpus carries 7,421 such pvtext
// rows, all classified `VOTABLE_no_vote` because nothing on the row says the
// fund declined; the worst filing is 18.8% blank. vanguard already carries its
// own VOTED? column in VoteOtherInfo, so the field and the precedent both exist.
func TestPVTextRecordsTheVotedColumn(t *testing.T) {
	rows := runISSNPXDoc(t, loadPVFixture(t, "PV5_not_voted.txt"))

	// The report prints each proposal twice -- once beside its cells and once
	// on the line below -- so the description is matched by prefix.
	var voted, notVoted []string
	for _, r := range rows {
		switch {
		case strings.HasPrefix(r[colVoteDescription], "ELECT DIRECTOR RODGER B. DOWDELL, JR."):
			voted = r
		case strings.HasPrefix(r[colVoteDescription], "APPROVE MERGER AGREEMENT"):
			notVoted = r
		}
	}
	if voted == nil || notVoted == nil {
		t.Fatalf("fixture rows missing; got %d rows", len(rows))
	}

	if got := notVoted[colHowVoted]; got != "" {
		t.Errorf("not-voted row how_voted = %q, want empty -- the filing printed no vote", got)
	}
	if got := notVoted[colVoteOtherInfo]; got != "NO" {
		t.Errorf("not-voted row voted? = %q, want %q", got, "NO")
	}
	if got := voted[colVoteOtherInfo]; got != "YES" {
		t.Errorf("voted row voted? = %q, want %q", got, "YES")
	}
	if got := voted[colHowVoted]; got != "FOR" {
		t.Errorf("voted row how_voted = %q, want %q", got, "FOR")
	}
}
