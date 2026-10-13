package main

import "testing"

// CIK 0001644419 (Northern Lights Fund Trust IV), the same 2022 htmltable N-PX
// that TestNS1644419ProxyRecordMastheadRegistrantBanner pins for attribution,
// prints its ballot column ONE column to the right of a Yes/No did-the-fund-vote
// flag. Its column header row -- verbatim, and printed twice in the fixture, at
// source lines 346-358 and 548-560 -- is:
//
//	A. Company Name | B. Primary Ticker Symbol | C. Security ID |
//	D. Meeting Type | D. Meeting Date | E. Proposal Number |
//	E. Description | E. Description |
//	F. Proposed By Management or Shareholder |
//	G. Voted by Registrant | H. Registrant Vote |
//	I.  For/Against Management Recommended Vote |
//	Management's Recommended Vote
//
// Column G is the flag -- its cells print `Yes`, and the filing's own legend row
// (source line 330) glosses the other value, `No* = could not vote due to shares
// out on loan`. Column H is the ballot: its cells print the single letter `F`
// throughout this fixture, and `A` / `Abstain` elsewhere in the filing.
//
// The parser reads G. Measured on the tracked binary, all six of the fixture's
// rows carry how_voted = "Yes" -- a value this filing never recorded as a vote.
// A prior residue round on this CIK was gated REVERT at delta_agreement = 0.0%
// for exactly this, and a wrong vote value is worse than a blank series id, so
// this has to be fixed before the masthead-banner attribution fix can ship.
//
// WHY THE WRONG COLUMN IS PICKED. htmlMapFields (layout_htmltable.go:2725)
// canonicalises each header cell with htmlCanonLabel (layout_htmltable.go:3028).
// htmlLetteredLabel (layout_htmltable.go:2970) strips only the PARENTHESISED
// SEC form prefix -- it requires s[0] == '(' and s[2] == ')' -- and this filer
// letters its columns `G.` / `H.` with a period, so the letter is not stripped;
// it is merely folded to a word. Measured canon labels:
//
//	col  9  "G VOTED BY REGISTRANT"
//	col 10  "H REGISTRANT VOTE"
//
// Neither is an exact synonym of anything, so both fall past the strong-name
// vote pass (layout_htmltable.go:2779-2790) and the exact pass
// (layout_htmltable.go:2800-2815) untouched. Two consequences follow:
//
//   - The votedflag back-fill at layout_htmltable.go:2791-2799 is guarded on the
//     STRONG pass having already claimed the vote, which it has not, so it never
//     runs. Even if it did, it matches only the bare label "VOTED" or a "DID ..."
//     question -- never "G VOTED BY REGISTRANT". htmlWeakVoteLabel
//     (layout_htmltable.go:2894) is likewise exact-only on "VOTED"/"CAST"/"DID ",
//     so it does not refuse this label either.
//
//   - Both columns therefore reach the word-sequence tie-break at
//     layout_htmltable.go:2820-2855, which scans columns LEFT TO RIGHT. Column 9
//     is visited first. htmlContainsWords (layout_htmltable.go:2948) finds the
//     htmlFieldVote synonym "VOTED" (layout_htmltable.go:2596, 5 bytes) as a whole
//     word inside "G VOTED BY REGISTRANT", nothing longer matches, and
//     layout_htmltable.go:2851-2854 assigns mapping[htmlFieldVote] = 9. When the
//     scan reaches column 10, htmlFieldVote is already taken
//     (layout_htmltable.go:2826-2828) and no other field's synonyms match
//     "H REGISTRANT VOTE" -- the vote synonym list has "REGISTRANT VOTED", not
//     "REGISTRANT VOTE" -- so the real ballot column is claimed by nothing and
//     its value is discarded.
//
// The measured mapping on those thirteen labels is
// map[by:8 cusip:2 desc:6 issuer:0 item:5 mtgdate:4 ticker:1 vote:9 vsmgmt:11]:
// vote on the flag, no votedflag entry at all, column 10 absent.
//
// WHAT A FIX MUST ACHIEVE, and a measured note on the second half. Remapping
// alone is safe: htmlDataRow accepts the row and emits how_voted = "F" when
// called with htmlFieldVote: 10 and htmlFieldVotedFlag: 9 on this fixture's own
// cells, so no row is lost. But "F" is NOT a vote value by this package's own
// predicate -- htmlIsVoteValue (layout_htmltable.go:2340) returns false for it,
// because htmlValueVotes (layout_htmltable.go:2308) holds only spelled-out forms
// and this package has no single-letter expansion anywhere. So the two
// assertions below are genuinely two requirements: pick column H, AND emit a
// value the corpus can reconcile. Expanding the letter to its word at capture
// for this shape satisfies the second assertion without widening
// htmlValueVotes -- admitting a bare "A" to the global vocabulary would let a
// stray initial claim a vote column elsewhere. The assertion is written against
// the predicate, not against a literal, so either route passes.
//
// FIXTURE. Reuses testdata/family_ns1644419_proxy_record_banner/, unedited, via
// the existing ns1644419ProxyRecordDispatch helper in
// family_ns1644419_proxy_record_banner_test.go. The six rows are three from
// section 1 (ALBEMARLE CORPORATION) and three from section 3 (ALIGN TECHNOLOGY,
// INC.); all twelve of their G and H cells are `Yes` and `F` respectively.
func TestNS1644419RegistrantVoteColumnIsBallotNotVotedFlag(t *testing.T) {
	const fixture = "inspire_2022_proxy_record_banner.txt"

	// The header mapping itself, on the fixture's own thirteen labels copied
	// verbatim from source line 346-358. Asserted separately from the rows
	// because three of this header's columns (H, I and the trailing
	// Management's Recommended Vote) all print `F`, so a row-level assertion
	// alone cannot tell the ballot column from the two recommendation columns
	// beside it.
	header := []string{
		"A. Company Name",
		"B. Primary Ticker Symbol",
		"C. Security ID",
		"D. Meeting Type",
		"D. Meeting Date",
		"E. Proposal Number",
		"E. Description",
		"E. Description",
		"F. Proposed By Management or Shareholder",
		"G. Voted by Registrant",
		"H. Registrant Vote",
		"I.  For/Against Management Recommended Vote",
		"Management's Recommended Vote",
	}
	mapping := htmlMapFields(header)
	if got, ok := mapping[htmlFieldVote]; !ok || got != 10 {
		t.Errorf("vote column = %d (ok %v), want 10 (`H. Registrant Vote`) -- column 9 is `G. Voted by Registrant`, the Yes/No did-the-fund-vote flag; mapping %v", got, ok, mapping)
	}
	if got, ok := mapping[htmlFieldVotedFlag]; !ok || got != 9 {
		t.Errorf("votedflag column = %d (ok %v), want 9 (`G. Voted by Registrant`) -- the flag must be recorded, not dropped, or an unvoted agenda item reads as furniture; mapping %v", got, ok, mapping)
	}

	rows := ns1644419ProxyRecordDispatch(t, fixture, "dict.tsv", "htmltable", 6)

	for i, r := range rows {
		// The hard claim: whatever else is true, how_voted may never be the
		// Yes/No answer to "did the registrant vote".
		switch r.HowVoted {
		case "Yes", "No", "YES", "NO", "yes", "no":
			t.Errorf("row %d (%s, %s): how_voted = %q -- that is column G `Voted by Registrant`, the did-the-fund-vote flag; the ballot is column H `Registrant Vote` and reads `F` on this row",
				i+1, r.IssuerName, r.VoteDescription, r.HowVoted)
			continue
		}
		// And the value that column H carries must be one the corpus can
		// reconcile against ISS, not a bare ballot letter.
		if !htmlIsVoteValue(r.HowVoted) {
			t.Errorf("row %d (%s, %s): how_voted = %q is not a vote value by htmlIsVoteValue -- column H prints the letter `F`, which must reach the row as its spelled-out vote",
				i+1, r.IssuerName, r.VoteDescription, r.HowVoted)
		}
	}
}
