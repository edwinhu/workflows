package main

import (
	"path/filepath"
	"testing"
)

// familySkip3Dispatch runs the real dispatch on a family SKIP3 fixture and
// returns the rows with the manifest row, asserting no precondition: the defect
// under test IS the empty result, so a precondition on it would turn each of
// these into a fixture error rather than a failed assertion.
//
// Family SKIP3 is the residue of families SKIP and SKIP2. Batches 71-75 landed
// votesummary, proxyedge, agenda, the twoband layouts, the SEI pvtext header,
// the ProxyEdge text report in splittable and the div unwrapping in labelvalue;
// 727 of the 997 large skipped filings still emit nothing. All 40 sampled
// members reach that skip the same way every SKIP and SKIP2 member did --
// htmltable offers itself to everything (matchHTMLTable returns true
// unconditionally, text_parser.go:103), reads the body, adopts no header and
// returns errLayoutDeclined (layout_htmltable.go:724 or :107). What differs is
// WHICH grammar the filing is written in, and that is what each test below
// names.
func familySkip3Dispatch(t *testing.T, fixture string) ([]VoteRow, FilingMeta) {
	t.Helper()
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_skip3", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	return rows, meta
}

// 000088/889392/0000910472-10-000841.txt: 13-15, 24-26, 51-56, 62-71, 156, 203,
// 217-235, 250-251, 260-289, and the filing's own last four lines. Dominion
// Funds 2010 (CIK 889392) is the Broadridge ProxyEdge ballot-detail grid
// layout_proxyedge.go reads -- one <td> per logical column, so after stripHTML
// the grid arrives one cell per line -- in the vendor's WORD-VOTE template,
// which prints no share-count columns at all:
//
//	Item / Proposal / Type / Vote / For/Against / Management
//	01 / DIRECTOR / Management
//	  / 1 / DINESH C. PALIWAL / / For / For
//
// The ballot is a word (`For`) in the `Vote` column, not a count of shares
// under a `For` heading, and the last column -- the label `For/Against` wrapped
// onto a second cell reading `Management` -- says whether that ballot agreed
// with management.
//
// peHeaderAt (layout_proxyedge.go:118-148) refuses this band twice over. The
// run breaks at `For/Against`, which is not in peVocabulary and whose FORWARD
// join `For/Against Management` is not in it either, so the batch-73 wrap
// tolerance does not rescue it. And even the labels it did read carry
// dispositions == 0, so the `dispositions < 2` test at layout_proxyedge.go:145
// returns nil regardless. matchProxyEdge therefore never fires, nothing else in
// the registry claims the body, and htmltable declines it.
//
// This is the variant family SKIP2's report named and left untested ("Named but
// not tested -- the ProxyEdge word-vote variant", Market Vectors ETF Trust 2008
// and Ecofin 2021). Those two spend thousands of markup lines per ballot on
// percentage spacer cells; this filer prints the same grammar compactly, so a
// verbatim cut holds a whole header and a whole row.
//
// Fix in layout_proxyedge.go. Add FOR/AGAINST MANAGEMENT to peVocabulary with a
// role of its own (it is a with/against-management flag, not a cast vote, and
// VoteRow has no field for it, so peVoteRow should read it into none), and let
// peHeaderAt accept a band that names a peVote column instead of demanding two
// dispositions -- the `dispositions < 2` guard exists to tell a ballot from a
// tally of share counts, and a band whose vote column is a WORD is neither.
// how_voted is then the `Vote` cell verbatim.
func TestFamilySkip3DominionProxyEdgeWordVote(t *testing.T) {
	rows, meta := familySkip3Dispatch(t, "dominion_proxyedge_word_vote.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 1 HARMAN INTERNATIONAL INDUSTRIES, INC. proposal (ticker HAR, security 413086109, meeting 08-Dec-2009, item 01/1 DINESH C. PALIWAL, Vote cast For) for Dominion Funds, Inc. - Foxhall Global Trends Fund",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "HARMAN INTERNATIONAL INDUSTRIES, INC." {
			continue
		}
		seen++
		if r.Ticker != "HAR" {
			t.Errorf("ticker: got %q want %q", r.Ticker, "HAR")
		}
		if r.CUSIP != "413086109" {
			t.Errorf("cusip: got %q want %q -- the `Security` label carries it", r.CUSIP, "413086109")
		}
		if r.MeetingDate != "20091208" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20091208")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q -- the word in the Vote column, not a share count", r.HowVoted, "For")
		}
		if r.FundName == "" {
			t.Errorf("fund: got %q, want the Foxhall Global Trends Fund heading", r.FundName)
		}
	}
	if seen == 0 {
		t.Fatalf("found none of the HARMAN INTERNATIONAL INDUSTRIES, INC. proposals in %d parsed", len(rows))
	}
}

// 000152/1524348/0001162044-20-000929.txt: 3-5, 14-16, 41-46, 102-110, 292-296,
// 299-343, and the filing's own last four lines. Ranger Funds Investment Trust
// 2020 (CIK 1524348) prints the ISS institutional export as an ORDINARY HTML
// table -- one <tr> per vote, one <td> per column, a bold header row above --
// with TWENTY-ONE labelled columns:
//
//	Location ID | Location Name | Institutional Account Name | Custodian |
//	Company Name | Ticker | Country | Primary Security ID | Provider Security ID |
//	Meeting Type | Meeting Date | Record Date | Shares Voted | Proponent |
//	Votable Proposal | Proposal Number | Proposal Text |
//	Management Recommendation | Vote Instruction | Voted | Vote Against Management
//
// htmlHeaderShape caps a header at htmlHeaderMaxCells == 20
// (layout_htmltable.go:70, tested at :1759), so this row is refused for its
// WIDTH alone. Measured on the labels above: htmlHeaderShape returns ok=false
// for all 21, and ok=true for the first 20 with a complete and correct mapping
// --
//
//	fund:2 issuer:4 ticker:5 cusip:7 mtgdate:10 by:13 item:15 desc:16
//	mgmtrec:17 vote:18 votedflag:19
//
// -- so every synonym this grammar needs is already in htmlSynonyms and the
// only thing standing between the parser and the whole filing is the cap. With
// no mapping adopted, parseHTMLTableRaw returns errLayoutDeclined at
// layout_htmltable.go:724. splittable matches on `Institutional Account Name`
// and declines too: it is a fixed-width reader and no physical line here
// carries more than one column.
//
// Fix in layout_htmltable.go, htmlHeaderMaxCells. The cap guards against
// mistaking a wide prose block for a header; a row of 21 short, distinct,
// mappable labels is not that, and the ISS export is a 21-to-24 column grammar
// (Johnson Mutual Funds Trust 2011 prints 24, adding Security ID on Ballot,
// Cutoff Date, Shares Available to Vote, Shares on Loan, Sequence #, VAM_YN and
// Voted_YN). Raise it, or make the ceiling conditional on every cell being a
// mapped or short label rather than on the count alone.
func TestFamilySkip3RangerISSInstitutional21Columns(t *testing.T) {
	rows, meta := familySkip3Dispatch(t, "ranger_iss_institutional_21_columns.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 1 Skyline Champion Corporation proposal (ticker SKY, security 830830105, meeting 30-Jul-19, item 1.1 Elect Director Keith Anderson, Vote Instruction For) for Ranger Small Cap Fund",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "Skyline Champion Corporation" {
			continue
		}
		seen++
		if r.FundName != "Ranger Small Cap Fund" {
			t.Errorf("fund: got %q want %q -- the Institutional Account Name column", r.FundName, "Ranger Small Cap Fund")
		}
		if r.Ticker != "SKY" {
			t.Errorf("ticker: got %q want %q", r.Ticker, "SKY")
		}
		if r.MeetingDate != "20190730" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20190730")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q -- the Vote Instruction column", r.HowVoted, "For")
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 Skyline Champion Corporation proposal in %d parsed", seen, len(rows))
	}
}

// 000094/949881/0001144204-12-039017.txt: 13-16, 50-51, 212-215, 237-244, 653,
// 657, 661, 665-680, 683-689, 692-716, and the filing's own last three lines.
// TD Asset Management USA Funds 2012 (CIK 949881) prints the ISS
// `Vote Summary Report` as three separate HTML tables per meeting -- an
// identity table, a CUSIP/ISIN/SEDOL table, and the ballot -- and the BALLOT'S
// COLUMN HEADER IS SPLIT ACROSS TWO <tr>s:
//
//	<TR> ... <TD>&nbsp;</TD><TD>&nbsp;</TD><TD>&nbsp;</TD><TD>&nbsp;</TD><TD>Vote</TD></TR>
//	<TR> ... <TD>&nbsp;</TD><TD>&nbsp;</TD><TD>Proponent</TD><TD>Mgmt Rec</TD><TD>Instruction</TD></TR>
//	<TR> ... <TD>1</TD><TD>Accept Financial Statements and Statutory Reports</TD><TD>Mgmt</TD><TD>For</TD><TD>For</TD></TR>
//
// The column is `Vote Instruction`, which htmlSynonyms already maps to
// htmlFieldVote -- but the two halves are on different rows and htmlHeaderShape
// only ever sees one row at a time. The upper row carries ONE label, below
// htmlHeaderMinCells == 3 (layout_htmltable.go:69, :1759). The lower row
// carries three -- Proponent, Mgmt Rec, Instruction -- and `INSTRUCTION` alone
// is in no htmlFieldVote entry (layout_htmltable.go:2238-2249 lists
// VOTE INSTRUCTION, not INSTRUCTION), so the mapping has no vote column and
// htmlHeaderShape refuses it at layout_htmltable.go:1767. No mapping is
// adopted and parseHTMLTableRaw returns errLayoutDeclined at :724.
//
// The identity for the meeting is in the FIRST table (Ticker / Meeting Date /
// Country / Security ID / Meeting Type / Record Date over their values), the
// issuer is the centred <P> above it, and the fund is the
// `Institution Account(s):` line above that. Waddell & Reed Advisors Funds 2011
// prints the same shape with a six-label lower row (Proponent / Votable
// Proposal / Mgmt Rec / ISS Rec / Policy Rec / Instruction).
//
// Fix in layout_htmltable.go, in the header scan inside parseHTMLTableRaw. When
// a row's labels fall short of htmlHeaderMinCells, or map no vote column, join
// it COLUMN-WISE with the row beneath before giving up -- `Vote` over
// `Instruction` in column 5 is one logical label, exactly as splittable's
// spHeaderSpans already joins `Vote` over `Cast`. The row reader beneath needs
// no change; the data rows are ordinary five-cell <tr>s.
func TestFamilySkip3TDAMTwoRowVoteInstructionHeader(t *testing.T) {
	rows, meta := familySkip3Dispatch(t, "tdam_two_row_vote_instruction_header.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 1 Tesco plc proposal (ticker TSCO, security G87621101, meeting 01-Jul-11, item 1 Accept Financial Statements and Statutory Reports, Vote Instruction For) for TDAM USA Global Sustainability Fund",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "Tesco plc" {
			continue
		}
		seen++
		if r.Ticker != "TSCO" {
			t.Errorf("ticker: got %q want %q", r.Ticker, "TSCO")
		}
		if r.MeetingDate != "20110701" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20110701")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q -- the Vote/Instruction column", r.HowVoted, "For")
		}
		if r.FundName == "" {
			t.Errorf("fund: got %q, want the TDAM USA Global Sustainability Fund account heading", r.FundName)
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 Tesco plc proposal in %d parsed", seen, len(rows))
	}
}

// 000089/893759/0000893759-06-000009.txt: 13-15, 24-26, 51-52, 73-76, 93-101,
// 146-169, and the filing's own last four lines. Gardner Lewis Investment Trust
// 2006 (CIK 893759) prints the SAME Broadridge fixed-width Investment Company
// Report batch 73 taught layout_splittable.go to read for Scudder -- rule-cut
// blocks, `Vote Group:`, an issuer heading between two rules -- WITHOUT THE
// VENDOR BANNER:
//
//	Account -  CHESAPEAKE AGGRESSIVE GROWTH FUND, THE
//	- ------------------------------------------------------------------
//	CENTENE CORPORATION          Ticker:  CNC      Special Meeting Date: 07/22/2005
//	Issuer: 15135B               City:             Holdings Reconciliation Date: 06/09/2005
//	- ------------------------------------------------------------------
//	Vote Group: GLOBAL
//	Agenda: 932372232 -MANAGEMENT
//	     Proposal Number    Vote Cast    RV    Proposal
//	- ------------------------------------------------------------------
//	            01            For        For   AMEND INCENTIVE STOCK OPTION PLAN
//
// The document contains neither `ProxyEdge` nor `Investment Company Report`
// (grep count 0 over the whole 0.20 MB filing) and neither
// `institutional account name` nor `institutional account id`, so
// matchSplitTable (layout_splittable.go:137-139) is false on both of its
// signatures and none of that machinery runs. The fund is spelled
// `Account -  <name>`, not `Selected Accounts:` or `Institutional Account
// Name:`, so spReadContext would not find it either. icr wants the proponent
// first, labelvalue wants a `#` header line, pvtext wants
// `ISSUER NAME TICKER CUSIP MTG DATE`, fixedwidth is the strict Glass Lewis
// shape; htmltable then reads a body with no </tr> in it and returns
// errLayoutDeclined at layout_htmltable.go:107.
//
// Two further differences from the Scudder template, both of which the reader
// must tolerate: the column header is ONE physical line rather than two stacked
// ones, and the third column is spelled `RV` (recommended vote) rather than
// `Against Mgmt.`.
//
// Fix in layout_splittable.go, in matchSplitTable/spSignatures and spReadContext.
// Admit `Vote Group:` together with a rule-cut `Proposal Number` header as a
// third signature for this family -- it is the block delimiter the reader
// already keys on -- add `RV` to spRoles as the management recommendation, and
// give spReadContext an `ACCOUNT -` case beside the SELECTED ACCOUNTS one for
// the fund.
func TestFamilySkip3GardnerLewisVoteGroupText(t *testing.T) {
	rows, meta := familySkip3Dispatch(t, "gardner_lewis_vote_group_text.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 1 CENTENE CORPORATION proposal (ticker CNC, issuer 15135B, meeting 07/22/2005, item 01 AMEND INCENTIVE STOCK OPTION PLAN, Vote Cast For) for the CHESAPEAKE AGGRESSIVE GROWTH FUND account",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "CENTENE CORPORATION" {
			continue
		}
		seen++
		if r.Ticker != "CNC" {
			t.Errorf("ticker: got %q want %q", r.Ticker, "CNC")
		}
		if r.MeetingDate != "20050722" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20050722")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q -- the Vote Cast column", r.HowVoted, "For")
		}
		if r.FundName == "" {
			t.Errorf("fund: got %q, want the CHESAPEAKE AGGRESSIVE GROWTH FUND account", r.FundName)
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 CENTENE CORPORATION proposal in %d parsed", seen, len(rows))
	}
}
