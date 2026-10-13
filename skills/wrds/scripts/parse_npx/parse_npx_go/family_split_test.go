package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// familySplitDispatch runs the real dispatch on a family SPLIT fixture.
func familySplitDispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_split", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	return rows
}

// 000137/1375340/0001438934-19-000372.txt: 12-25, 41-52, 82-111. Cohen & Steers
// Closed-End Opportunity Fund (CIK 1375340, ISS fundid 7612) is a fund of
// closed-end funds that votes one security in several ways at one meeting, so
// broadridge prints a compound vote cell rather than a vocabulary word. The
// Adams Natural Resources block, verbatim:
//
//	Prop.# Proposal                                                  Proposal      Proposal Vote                  For/Against
//	                                                                 Type                                         Management
//
//	1.     DIRECTOR
//	       Enrique R. Arzac                                          Mgmt          Split 96% For 4% Withheld      Split
//	...
//	2.     Ratification of the selection of                          Mgmt          Split 98% For 1% Against 1% AbstainSplit
//	       PricewaterhouseCoopers LLP as independent
//	       public auditors.
//
// Item 2's vote cell is one character wider than the `Proposal Vote` column, so
// its last word abuts the `For/Against Management` cell and the printed token is
// `AbstainSplit` -- a word in no vocabulary. The broadridge vote peel matches a
// WHOLE trailing word against brVoteWords, so nothing peels: how_voted stays
// empty and the entire vote cell is left glued into vote_description.
//
// ISS records this vote as Split. The value the filing prints for the row is the
// whole cell, `Split 98% For 1% Against 1% Abstain`, with `Split` in the
// management column -- the same one-verbatim-cell shape family JJJ pinned for
// Choice and issnpx_split_vote_test.go pinned for `Split Vote`. The README has
// no how_voted section and prescribes nothing for split votes; the verbatim cell
// is the standing convention of the existing tests, not of the README.
//
// Fix in layout_broadridge.go, in the trailing-vote peel that brVoteWords feeds
// (the `case "for", "against", "abstain", "withheld", "withhold", "none",
// "split":` arm near line 542): when the proposal line carries no trailing
// vocabulary word, split the line at the declared `Proposal Vote` /
// `For/Against Management` column boundary taken from the two-line column header
// rather than on whitespace, so a cell that overruns its width still yields its
// own text.
func TestFamilySplitCohenSteersCEFBlankVote(t *testing.T) {
	rows := familySplitDispatch(t, "cohen_steers_cef_split_vote.txt", "broadridge", 9)
	var seen int
	for _, r := range rows {
		if r.ItemSeq != "2" {
			continue
		}
		seen++
		if r.HowVoted != "Split 98% For 1% Against 1% Abstain" {
			t.Errorf("item 2 vote cell never read: how_voted=%q mgmt=%q desc=%q want how_voted=%q",
				r.HowVoted, r.ManagementRecommendation, r.VoteDescription, "Split 98% For 1% Against 1% Abstain")
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 item-2 rows in %d parsed", seen, len(rows))
	}
}

// Same fixture, the eight director rows of item 1. Their vote cell is inside its
// column width and IS separated from the management cell, verbatim:
//
//	Enrique R. Arzac                                          Mgmt          Split 96% For 4% Withheld      Split
//
// The peel matches the single trailing word `Withheld` and stops there, so
// how_voted is `Withheld` while `Split 96% For 4%` is left glued into
// vote_description. `Withheld` is not what the row says -- the fund split 96/4,
// and ISS records Split -- so this is a wrong value rather than a missing one,
// and it is the larger half of the registrant's disagreement: 5,308 of the 6,412
// rows its seventeen broadridge filings emit carry the `Split NN% For` run
// inside vote_description, against 682 left blank.
func TestFamilySplitCohenSteersCEFDirectorVoteTruncated(t *testing.T) {
	rows := familySplitDispatch(t, "cohen_steers_cef_split_vote.txt", "broadridge", 9)
	var seen int
	for _, r := range rows {
		if r.ItemSeq != "1" {
			continue
		}
		seen++
		want := "Split 96% For 4% Withheld"
		if strings.Contains(r.VoteDescription, "Roger W. Gale") ||
			strings.Contains(r.VoteDescription, "Craig R. Smith") {
			want = "Split 95% For 5% Withheld"
		}
		if r.HowVoted != want {
			t.Errorf("director row kept only the trailing word: desc=%q how_voted=%q want %q",
				r.VoteDescription, r.HowVoted, want)
		}
	}
	if seen != 8 {
		t.Fatalf("found %d of the 8 director rows in %d parsed", seen, len(rows))
	}
}
