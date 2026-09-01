package main

import (
	"os"
	"path/filepath"
	"testing"
)

// broadridge CLAIMED 197 filings totalling 155.1 MB and returned no rows from any
// of them. testdata/broadridge/B4_hartford_segmented_rule.txt is bytes
// 48497..56039 of 000100/1006415/0000950123-09-039054.txt (15.6 MB, the largest
// of the 197) -- ONE contiguous slice, verified to occur exactly once in that
// filing, cut from the fund heading so that it BEGINS BEFORE the line the parser
// stopped on rather than past it.
//
// What it reproduces: this vintage underlines its column header PER COLUMN,
//
//	ITEM        PROPOSAL      TYPE   VOTE   MANAGEMENT
//	- ----        --------      ----   ----   -----------
//
// so the rule is several dash runs separated by spaces rather than one unbroken
// run. brDashRule accepted only the unbroken form, so the segmented rule was not
// furniture, carried no item token, matched no label -- and therefore fell into
// the free-standing-text branch, which CLOSES THE TABLE. Every proposal line
// after it then sat outside a table and was read as prose. The failure is silent
// and total: the header matched, the walk produced nothing, and all 15.6 MB
// became one error row.
//
// GROUND TRUTH, counted by hand from the fixture bytes (line numbers are the
// fixture's own, `cat -n`):
//
//	ELECTRONIC ARTS INC.  lines 17-27               11 rows
//	YAHOO! INC.           line 51, 52-60, 61-64   1+9+4 rows
//	MEDTRONIC, INC.       line 91, 92-97, 98-99   1+6+2 rows
//	                                             ---------
//	                                                34 rows
//
// The nine and six indented director lines each carry their own item token
// (1..9, 1..6) and are rows in their own right, as in the E1 slate. The three
// ACCOUNT NUMBER / CUSTODIAN tables that follow each block are NOT vote tables
// and contribute no rows; they close the block, which is what keeps the 997QR1U
// custodian lines out of the vote column.
const brUnreadFixture = "B4_hartford_segmented_rule.txt"

func TestBroadridgeUnread(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "broadridge", brUnreadFixture))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	body := edgarEnvelope("0001006415", "0000950123-09-039054", string(b))

	res := parseText([]byte(body), FilingMeta{FilePath: "edgar/x.txt", FormType: "N-PX"})

	if res.Meta.Layout != "broadridge" {
		t.Fatalf("layout = %q, want broadridge (this fixture is the family broadridge claims)", res.Meta.Layout)
	}
	if res.Meta.ParseStatus != "ok" {
		t.Fatalf("parse_status = %q err=%q, want ok", res.Meta.ParseStatus, res.Meta.ErrorMsg)
	}
	if len(res.Rows) != 34 {
		t.Fatalf("got %d rows, want 34 counted from the fixture bytes", len(res.Rows))
	}

	// Per-block meeting context, read off the three label blocks in the bytes.
	type block struct {
		rows        int
		issuer      string
		ticker      string
		cusip       string
		isin        string
		meetingType string
		meetingDate string
	}
	blocks := []block{
		{11, "ELECTRONIC ARTS INC.", "ERTS", "285512109", "US2855121099", "Annual", "20080731"},
		{14, "YAHOO! INC.", "YHOO", "984332106", "US9843321061", "Contested-Annual", "20080801"},
		{9, "MEDTRONIC, INC.", "MDT", "585055106", "US5850551061", "Annual", "20080821"},
	}
	at := 0
	for bi, want := range blocks {
		for k := 0; k < want.rows; k++ {
			r := res.Rows[at]
			if r.IssuerName != want.issuer || r.Ticker != want.ticker || r.CUSIP != want.cusip ||
				r.ISIN != want.isin || r.MeetingType != want.meetingType || r.MeetingDate != want.meetingDate {
				t.Fatalf("block %d row %d: issuer=%q ticker=%q cusip=%q isin=%q type=%q date=%q, want %+v",
					bi, k, r.IssuerName, r.Ticker, r.CUSIP, r.ISIN, r.MeetingType, r.MeetingDate, want)
			}
			at++
		}
	}

	// The first row of the first block, whole: the row the closed table lost.
	first := res.Rows[0]
	if first.ItemSeq != "1A" ||
		first.VoteDescription != "Election of Directors (Majority Voting)" ||
		first.VoteSource != "Management" ||
		first.HowVoted != "For" ||
		first.ManagementRecommendation != "For" {
		t.Errorf("row 0 = item=%q desc=%q type=%q vote=%q mgmt=%q, want 1A / "+
			"Election of Directors (Majority Voting) / Management / For / For",
			first.ItemSeq, first.VoteDescription, first.VoteSource, first.HowVoted,
			first.ManagementRecommendation)
	}

	// The item tokens of YAHOO's block in order: the parent 01, its nine-name
	// slate, then 02..05. A rule that swallowed the slate as continuation text,
	// or that split a proposal in two, moves these.
	wantItems := []string{"01", "1", "2", "3", "4", "5", "6", "7", "8", "9", "02", "03", "04", "05"}
	for k, want := range wantItems {
		if got := res.Rows[11+k].ItemSeq; got != want {
			t.Errorf("yahoo row %d item = %q, want %q", k, got, want)
		}
	}

	// The bleed detector. VOTE is the fourth column and MANAGEMENT the fifth;
	// transposing them, or letting proposal text reach either, changes these
	// histograms. Ballots the filing left blank -- the two parent "Election of
	// Directors" rows -- stay blank rather than inheriting a slate member's vote.
	voted := map[string]int{}
	mgmt := map[string]int{}
	for _, r := range res.Rows {
		voted[r.HowVoted]++
		mgmt[r.ManagementRecommendation]++
	}
	for label, got := range map[string]map[string]int{
		"how_voted":                 voted,
		"management_recommendation": mgmt,
	} {
		want := map[string]int{"For": 30, "Against": 2, "": 2}
		if label == "management_recommendation" {
			want = map[string]int{"For": 31, "Against": 1, "": 2}
		}
		if len(got) != len(want) {
			t.Errorf("%s has %d distinct values %v, want %d %v", label, len(got), got, len(want), want)
			continue
		}
		for v, n := range want {
			if got[v] != n {
				t.Errorf("%s[%q] = %d, want %d (full: %v)", label, v, got[v], n, got)
			}
		}
	}
}

// B5 is a verbatim contiguous meeting block from 0001438934-21-000421, cut rule
// to rule: BOK Financial's 2021 annual meeting, whose DIRECTOR slate runs to 22
// un-numbered nominees, each carrying its own vote.
//
//  1. DIRECTOR
//     Alan S. Armstrong      Mgmt   Withheld   Against
//     C. Fred Ball, Jr.      Mgmt   For        For
//
// The layout previously read 3 rows here against ISS's 24, and the single row it
// emitted for the slate reported `Withheld` -- Armstrong's vote -- for a slate on
// which Ball voted For. A WRONG vote, not a missing one.
//
// broadridge carries 84% of all partial parsing detected against ISS: 1,169,008
// items lost across 2,128 filings, an 8.0% loss rate on the largest text layout.
func TestBroadridgeDirectorSlateIsOneRowPerNominee(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "broadridge", "B5_bok_unnumbered_slate.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) != 24 {
		t.Fatalf("got %d rows, want 24 -- the count ISS records for this meeting", len(rows))
	}

	// The votes DIFFER across the slate, which is why collapsing it loses data
	// rather than merely repeating it.
	want := map[string]string{
		"DIRECTOR Alan S. Armstrong":    "Withheld",
		"DIRECTOR C. Fred Ball, Jr.":    "For",
		"DIRECTOR Steven Bangert":       "Withheld",
		"DIRECTOR Peter C. Boylan, III": "For",
	}
	got := map[string]string{}
	for _, r := range rows {
		got[r[colVoteDescription]] = r[colHowVoted]
	}
	for desc, vote := range want {
		if got[desc] != vote {
			t.Errorf("%q: how_voted = %q, want %q", desc, got[desc], vote)
		}
	}
	var withheld, forVote int
	for _, r := range rows {
		switch r[colHowVoted] {
		case "Withheld":
			withheld++
		case "For":
			forVote++
		}
	}
	if withheld == 0 || forVote == 0 {
		t.Errorf("slate votes are uniform (%d Withheld, %d For); the filing prints both,"+
			" so a uniform result means one nominee's vote was applied to the rest",
			withheld, forVote)
	}
}

// TestBroadridgeNoVoteIsAVoteValue pins the spelling `No vote`.
//
// brPeelColumns peels the trailing cells by vocabulary from the RIGHT, and a
// peel that fails on the first token stops without removing anything. The
// vocabulary carried `do not vote`, `did not vote` and `take no action` but not
// `no vote`, so on
//
//  2. To provide advisory approval of our      Mgmt     No vote
//     executive compensation.
//
// both cells stayed in the proposal text, and the continuation line was then
// appended AFTER them:
//
//	vote_description = "To provide advisory approval of our Mgmt No vote executive compensation."
//	how_voted        = ""
//
// The description is text the filing never printed in that cell and the vote is
// blank. Measured 2026-09-01 over a 52,170-filing re-parse, 949,089 broadridge
// rows -- 3.433% of the layout -- carry vote cells spliced into the middle of a
// wrapped description, against 198 for icr and 3 for issnpx. That count is a
// FLOOR: it can only see the wrapped rows, because on a single-line row the
// unpeeled cells land at the end of the description where nothing follows them
// to make the splice visible.
func TestBroadridgeNoVoteIsAVoteValue(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "broadridge", "B6_no_vote_wraps.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))

	var wrapped, single []string
	for _, r := range rows {
		switch r[colItemSeq] {
		case "2":
			wrapped = r
		case "1A":
			single = r
		}
	}
	if wrapped == nil || single == nil {
		t.Fatalf("got %d rows; want both item 1A and the wrapped item 2", len(rows))
	}

	if got, want := wrapped[colVoteDescription],
		"To provide advisory approval of our executive compensation."; got != want {
		t.Errorf("wrapped row description = %q, want %q", got, want)
	}
	if got := wrapped[colHowVoted]; got != "No vote" {
		t.Errorf("wrapped row how_voted = %q, want %q", got, "No vote")
	}

	// The single-line row is the invisible half of the same defect.
	if got, want := single[colVoteDescription],
		"Election of Director: Reveta Bowers"; got != want {
		t.Errorf("single-line row description = %q, want %q", got, want)
	}
	if got := single[colHowVoted]; got != "No vote" {
		t.Errorf("single-line row how_voted = %q, want %q", got, "No vote")
	}
}
