package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// familyMiscDispatch runs the real dispatch on a family MISC fixture and
// returns the rows with the manifest row, asserting no precondition: for the
// Dominion shape the defect IS the empty result, so a precondition on it would
// turn a failed assertion into a fixture error.
func familyMiscDispatch(t *testing.T, dir, fixture string) ([]VoteRow, FilingMeta) {
	t.Helper()
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", dir, fixture), sink, make([]byte, headBytes))
	return sink.buf, meta
}

// 000086/867050/0000867050-09-000007.txt: 11-28, 130-136, 140-142, 252-254,
// 259-261, 265-271, 300-317, 9874-9882, 9810-9817 and two closing tags.
// American National Investment Accounts 2009 (CIK 867050) is the Broadridge
// ProxyEdge ballot-detail grid layout_proxyedge.go reads, and its proposal
// descriptions are HARD-WRAPPED inside one <td>, one physical line per source
// line:
//
//	<td colspan=4 class=xl28 width=308 style='width:231pt'>TO AMEND AIUK TRUSTEES
//	LIMITED'S ARTICLES OF ASSOCIATION AS DESCRIBED IN APPENDIX III OF THE
//	ATTACHED PROXY STATEMENT.
//
// stripHTML preserves line structure, so the cell arrives as three lines. The
// positional read in peVoteRow (layout_proxyedge.go) cannot line the run up
// against the five-label band (Item / Proposal / For / Against / Abstain) and
// refuses the row, and the refusal falls through to the bare-heading branch of
// parseProxyEdge (~:292). peFundName tells a fund heading from an issuer
// heading by a word list -- " FUND", " PORTFOLIO", " TRUST", " ETF", " SERIES"
// -- and `TO AMEND AIUK TRUSTEES` contains " TRUST", so the FIRST LINE OF A
// PROPOSAL DESCRIPTION is adopted as the fund and every ballot below it is
// filed under it.
//
// Measured on the whole filing: 3,302 of 3,627 rows carry no series, the
// largest blank fund names being "TO AMEND AIUK TRUSTEES" (1,381 rows) and
// "ISSUED AND OUTSTANDING SERIES C NON-VOTING CONTINGENT CONVERTIBLE PREFERRED"
// (932) -- both description fragments, neither a fund. 12,603 rows across 10
// filings.
//
// Fix in layout_proxyedge.go, peFundName together with the bare-heading branch
// of parseProxyEdge: a bare line may be a fund heading only when it is a whole
// cell rather than the head or the tail of a wrapped run, and never when the
// line above it opened a ballot row the band was already reading.
func TestFamilyMiscAmericanNationalWrappedDescriptionBecomesFund(t *testing.T) {
	rows, meta := familyMiscDispatch(t, "family_misc", "american_national_wrapped_description_fund.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s error=%q", meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	for _, r := range rows {
		if strings.HasPrefix(r.FundName, "TO AMEND") {
			t.Errorf("a wrapped proposal description was adopted as the fund heading: fund=%q issuer=%q item=%q desc=%q -- `TO AMEND AIUK TRUSTEES` is the first physical line of item 8's description cell, not a fund",
				r.FundName, r.IssuerName, r.ItemSeq, r.VoteDescription)
		}
	}
}

// testdata/family_skip3/dominion_proxyedge_word_vote.txt, cut from
// 000088/889392/0000910472-10-000841.txt. Dominion Funds 2010 (CIK 889392)
// prints the Broadridge ProxyEdge WORD-VOTE template -- the ballot is a word
// (`For`) in a `Vote` column, and the last header label is `For/Against
// Management`, a with-or-against-management flag.
//
// proxyedge cannot be the reader. Batch 76 implemented the prescribed
// proxyedge fix in full and measured that the band and the colonless identity
// block are byte-identical to testdata/family_ll2/wright_split_heading_cell.txt
// and ashmore_vote_summary_banner.txt, whose tests assert that this grammar
// dispatches to htmltable; any rule that lets proxyedge claim Dominion claims
// those two as well, and both went red. So the reader has to be htmltable --
// which already produces Wright's rows today.
//
// What htmltable cannot do is read Dominion's SPLIT <tr>s. The last header
// label and every ballot row are each spread over two physical rows:
//
//	row nt=true  ["Item" "" "Proposal" "Type" "Vote" "For/Against"]
//	row nt=false ["" "" "" "" "" "Management"]
//	row nt=false ["01" "" "DIRECTOR" "Management" "" ""]
//	row nt=false ["" "1" "DINESH C. PALIWAL" "" "For" "For"]
//
// htmlHeaderShape sees one row at a time, so `For/Against` never joins
// `Management`; no mapping is adopted, parseHTMLTableRaw returns
// errLayoutDeclined and nothing else in the registry claims the body, so the
// filing is `skip` with a registrant signature and zero rows.
//
// Fix in layout_htmltable.go, in the header scan inside parseHTMLTableRaw and
// in the row reader beneath it: join a header row with the row below it when
// that row's single non-empty cell continues a label already open in its own
// column (the htmlSplitHeaderMapping / htmlHeaderTailFragment path), and merge
// a ballot row with the row below when the upper row carries the item and
// description and the lower one the vote cells. The merge is what the batch-76
// experiment lacked: joining the header alone parsed the filing but emitted the
// vote-less parent row as a second row.
func TestFamilyMiscDominionSplitRowsInHtmltable(t *testing.T) {
	rows, meta := familyMiscDispatch(t, "family_skip3", "dominion_proxyedge_word_vote.txt")
	if meta.Layout != "htmltable" || len(rows) == 0 {
		t.Fatalf("htmltable never read the split rows: status=%s layout=%s rows=%d error=%q; the fixture prints 1 HARMAN INTERNATIONAL INDUSTRIES, INC. proposal (ticker HAR, security 413086109, meeting 08-Dec-2009, item 01/1 DINESH C. PALIWAL, Vote cast For) for Dominion Funds, Inc. - Foxhall Global Trends Fund",
			meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "HARMAN INTERNATIONAL INDUSTRIES, INC." {
			continue
		}
		seen++
		if r.CUSIP != "413086109" {
			t.Errorf("cusip: got %q want %q -- the `Security` label carries it", r.CUSIP, "413086109")
		}
		if r.MeetingDate != "20091208" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20091208")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q -- the word in the Vote column of the LOWER half of the split ballot row", r.HowVoted, "For")
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 HARMAN INTERNATIONAL INDUSTRIES, INC. ballot in %d parsed -- a split ballot row must merge into ONE row, not two", seen, len(rows))
	}
}
