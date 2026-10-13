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
