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
