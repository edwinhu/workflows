package main

import (
	"path/filepath"
	"testing"
)

// familyCornDispatch runs the real dispatch on a family CORN fixture.
func familyCornDispatch(t *testing.T, fixture, layout string) []VoteRow {
	t.Helper()
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_corn", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}
	return rows
}

// 000003/33934/0001398344-13-003763.txt: 4-8, 12-25, 49-54, 62, 75, 80, 175,
// 183-215, 3218-3307, 48496, 48506-48510. Cornerstone Total Return Fund (CIK
// 33934, ISS fundid 11795) files one eleven-column HTML grid a year. The 2013
// grid prints the vote in the `Vote Cast` column for the first rows of a
// meeting and then stops printing it, keeping the row and its `Mgmt
// Recommendation` and `For / Against Mgmt` cells. The Allstate block, verbatim
// from the flattened cells:
//
//	Company Name | Ticker | CUSIP | Meeting Date | Proposal Number | Proposal Description | Proponent | Mgmt Recommendation | Vote Cast | For / Against Mgmt
//	Allstate Corporation (The) | ALL | 020002101 | 5/21/2013 | 4 | Elect Jack M. Greenberg  | Management | For | For | For
//	Allstate Corporation (The) | ALL | 020002101 | 5/21/2013 | 5 | Elect Herbert L. Henkel  | Management | For |     | For
//
// The ninth `<td>` of the item-5 row is not absent -- it is present and holds a
// single non-breaking space, so the row is the header's full width:
//
//	<td valign="bottom" width="6%"><font style="DISPLAY: inline; FONT-FAMILY: times new roman; FONT-SIZE: 11pt">&#160; </font></td>
//
// htmlDataRow (layout_htmltable.go:4854) reads that cell, finds it empty, and
// returns `VoteRow{}, false` at the `if vote == ""` arm (lines 4883-4893)
// because this grid prints no Yes/No `Voted?` column for the votedFlag escape
// to use. The whole row is discarded: issuer, CUSIP, meeting date, item number
// and description are all printed and all lost with it. 1,226 of the filing's
// 1,632 data rows carry a blank `Vote Cast` cell, so the filing emits 405 rows
// where the grid prints 1,632.
//
// The vote VALUE for those rows is a floor -- the filing prints it nowhere, and
// `For / Against Mgmt` plus `Mgmt Recommendation` would only imply it. The row
// is not a floor. The fix is in layout_htmltable.go, in htmlDataRow's blank-vote
// arm: emit the row with a blank how_voted whenever the rest of the row is a
// data row (an item number and a description), instead of discarding it -- the
// same treatment the votedFlag branch two lines above already gives a row whose
// vote cell is empty because the fund did not vote.
func TestFamilyCornCornerstoneVoteColumn(t *testing.T) {
	rows := familyCornDispatch(t, "cornerstone_2013_blank_vote_cast.txt", "htmltable")
	if len(rows) != 3 {
		t.Errorf("blank `Vote Cast` row discarded: parsed %d rows from the 3 data rows the grid prints", len(rows))
	}
	var seen int
	for _, r := range rows {
		if r.ItemSeq != "5" {
			continue
		}
		seen++
		if r.HowVoted != "" || r.VoteDescription != "Elect Herbert L. Henkel" {
			t.Errorf("item 5 row: how_voted=%q desc=%q want how_voted=%q desc=%q",
				r.HowVoted, r.VoteDescription, "", "Elect Herbert L. Henkel")
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 item-5 rows in %d parsed", seen, len(rows))
	}
}
