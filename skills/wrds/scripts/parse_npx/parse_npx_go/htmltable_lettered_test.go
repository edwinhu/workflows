package main

import "testing"

// The SEC's own Item 1 column wording, lettered (a) through (i). Measured over
// the 4,248 HTML filings still skipped, this family splits two ways and both
// halves are large:
//
//	1,004  a nil statement in a table row, with no real table beneath it
//	1,881  a real vote table and no nil statement
//
// The nil half is invisible to the existing nil detector: the lettered HEADER
// supplies vote vocabulary, so the document looks like it holds a vote record
// even though its only data row reads "There were no proxies to report during
// the Reporting Period."
//
// The vote half carries the meaning of two columns that must not be confused.
// `(g) Voted` is a yes/no gate -- did the fund cast a ballot -- and `(h) Vote
// Cast` is the vote itself. Mapping (g) to the vote field would report how_voted
// as "Y" for every row of 1,881 filings.

// TestHTMLLetteredNilIsOkNotSkip: a lettered header whose only row states there
// were no proxies is a nil report, not an unreadable filing.
func TestHTMLLetteredNilIsOkNotSkip(t *testing.T) {
	rows, status := runISSNPXDocStatus(t, loadNil(t, "H10_lettered_nil.txt"))
	if len(rows) != 0 {
		t.Fatalf("nil report produced %d vote rows, want 0", len(rows))
	}
	if status != "ok" {
		t.Errorf("parse_status = %q, want \"ok\": the filing's own row reads \"There were no"+
			" proxy votes to report during the Reporting Period\". The lettered header supplies"+
			" the vote vocabulary that makes this look like a vote record; the row says it is"+
			" not.", status)
	}
}

// TestHTMLLetteredVotesMapCorrectly: the real half. Column (g) is the gate and
// column (h) is the vote; the first data row also carries a leading unlabelled
// item number, so its arity is one more than the header's.
func TestHTMLLetteredVotesMapCorrectly(t *testing.T) {
	rows := runISSNPXDoc(t, loadNil(t, "H9_lettered_votes.txt"))
	if len(rows) < 4 {
		t.Fatalf("produced %d rows, want at least 4 proposals", len(rows))
	}
	first := rows[0]
	for _, f := range []struct{ name, got, want string }{
		{"issuer_name", first[colIssuerName], "FRANCESCA'S HOLDINGS CORPORATION"},
		{"ticker", first[colTicker], "FRAN"},
		{"cusip", first[colCUSIP], "351793104"},
		{"meeting_date", first[colMeetingDate], "20120710"},
		{"vote_source", first[colVoteSource], "MGMT"},
	} {
		if f.got != f.want {
			t.Errorf("row 0 %s = %q, want %q", f.name, f.got, f.want)
		}
	}
	// (h) Vote Cast is the vote. (g) Voted is "Y"/"N" and must never reach it.
	for i, r := range rows {
		v := r[colHowVoted]
		if v == "Y" || v == "N" {
			t.Fatalf("row %d how_voted = %q -- that is column (g) Voted, the yes/no gate."+
				" The vote is column (h) Vote Cast.", i, v)
		}
		if !isVoteValue(v) {
			t.Errorf("row %d how_voted = %q is not a vote value", i, v)
		}
	}
}
