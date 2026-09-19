package main

import (
	"path/filepath"
	"testing"
)

// familySkip4Dispatch runs the real dispatch on a family SKIP4 fixture and
// returns the rows with the manifest row, asserting no precondition: the defect
// under test IS the empty result, so a precondition on it would turn each of
// these into a fixture error rather than a failed assertion.
//
// Family SKIP4 is the residue of families SKIP, SKIP2 and SKIP3. Batches 71-83
// landed votesummary, proxyedge, agenda, the twoband layouts, the SEI pvtext
// header, the ProxyEdge text report and Vote Group text in splittable, the div
// unwrapping in labelvalue, the wide (21-24 label) htmltable header, the
// column-wise split header join and the split ballot-row merge; 670 of the large
// skipped filings still emit nothing. Every sampled member reaches that skip the
// same way: htmltable offers itself to everything (matchHTMLTable returns true
// unconditionally, text_parser.go:113), reads the body, adopts no header and
// returns errLayoutDeclined (layout_htmltable.go). What differs is WHICH grammar
// the filing is written in, and that is what each test below names.
func familySkip4Dispatch(t *testing.T, fixture string) ([]VoteRow, FilingMeta) {
	t.Helper()
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_skip4", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	return rows, meta
}

// 000091/914036/0001193125-20-228094.txt: 1-12, 14-16, 196-203, 1272-1281,
// 9232-9244, 9261-9262 and the filing's own last four lines. Lincoln Variable
// Insurance Products Trust 2020 (CIK 914036, 64.2 MB, the largest filing in the
// pool) prints the ISS institutional export as FIXED-WIDTH TEXT inside <PRE>,
// not as an HTML table:
//
//	Institutional Account Name   LVIP BlackRock Dividend Value Managed Volatility
//	Fund
//	Institutional Account Number (All)
//
//	                       Primary                   Proposal            Vote     Vote Against
//	Company Name  Ticker  Security ID  Meeting Date  Number  Proposal Text  ...  Instruction  Management
//	------------  ------  -----------  ------------  ------  -------------  ---  -----------  ------------
//	Alcon Inc.                         Accept Financial Statements
//	               ALC    H01301128     06-May-20     1      and Statutory Reports  Management  For  No
//
// splittable MATCHES this body -- `institutional account name` is its first
// signature (spSignatures, layout_splittable.go:107) -- and then DECLINES it
// (measured: `splittable:MATCH rows=0 err=layout declined the body`). htmltable
// declines it too. The reader splittable runs is the ProxyEdge/Vote Group text
// path (spIsTextReport), which keys on a `ProxyEdge -` banner or on
// `Vote Group:` with a rule-cut `Proposal Number` header; this filing prints
// neither, so no block delimiter is found and nothing is read. The column header
// here is TWO stacked lines over a dashed rule of `-` runs (which is what
// spHeaderSpans already reads for Scudder), the fund is the
// `Institutional Account Name` label with its value on the SAME line and wrapped
// onto the next, and a ballot row is either one physical line or a
// continuation-wrapped pair whose issuer is printed on the first line and whose
// ticker, security id, date, item, vote sit on the last.
//
// Fix in layout_splittable.go: give the institutional-account signature a reader
// of its own rather than routing it into the ProxyEdge-text path -- key the
// block on the dashed rule under the two stacked header lines (spTrailingBlock /
// spHeaderSpans already cut exactly that shape), read the fund from the
// `Institutional Account Name` label including its wrapped tail, and join a
// wrapped issuer line to the row beneath it.
func TestFamilySkip4LincolnISSInstitutionalPreText(t *testing.T) {
	rows, meta := familySkip4Dispatch(t, "lincoln_iss_institutional_pre.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 2 Alcon Inc. proposals (ticker ALC, security H01301128, meeting 06-May-20, items 1 Accept Financial Statements and Statutory Reports and 5.2 Reelect Lynn Bleil as Director, Vote Instruction For) for LVIP BlackRock Dividend Value Managed Volatility Fund",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "Alcon Inc." {
			continue
		}
		seen++
		if r.Ticker != "ALC" {
			t.Errorf("ticker: got %q want %q", r.Ticker, "ALC")
		}
		if r.MeetingDate != "20200506" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20200506")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q -- the Vote Instruction column", r.HowVoted, "For")
		}
		if r.FundName == "" {
			t.Errorf("fund: got %q, want the LVIP BlackRock Dividend Value Managed Volatility Fund account", r.FundName)
		}
	}
	if seen != 2 {
		t.Fatalf("found %d of the 2 Alcon Inc. proposals in %d parsed", seen, len(rows))
	}
}

// 000161/1617113/0001144204-19-040532.txt: 1-2, 4-7, 44-49, 76-77, 81, 86, 194,
// 200-256, 30998 and the filing's own last four lines. CSOP ETF Trust 2019
// (CIK 1617113, 42.9 MB) prints an ORDINARY HTML table of EIGHTEEN columns whose
// header labels are hard-wrapped ACROSS SOURCE LINES INSIDE one <TD>:
//
//	<TD ...><FONT STYLE="font-size: 8pt">Company Name</FONT></TD>
//	<TD ...><FONT STYLE="font-size: 8pt">Primary Security
//	ID</FONT></TD>
//	<TD ...><FONT STYLE="font-size: 8pt">Proposal
//	Long Text</FONT></TD>
//	<TD ...><FONT STYLE="font-size: 8pt">Proposal
//	Short Text</FONT></TD>
//	<TD ...><FONT STYLE="font-size: 8pt">Vote
//	Options</FONT></TD>
//	<TD ...><FONT STYLE="font-size: 8pt">Vote</FONT></TD>
//
// Eighteen labels is inside htmlHeaderMaxCells, so the width is not the refusal;
// htmltable MATCHES and DECLINES (measured: `htmltable:MATCH rows=0 err=layout
// declined the body`), and no named layout matches at all. Two columns are
// proposal text (`Proposal Long Text` and `Proposal Short Text`) and the vote is
// the bare label `Vote`, with `Vote Options` -- the ballot's list of choices, not
// a cast vote -- sitting ahead of it.
//
// Fix in layout_htmltable.go, in htmlCanonLabel / htmlMapFields: a label split
// over source lines inside its own cell must be joined on the space before the
// synonym lookup, and `Vote Options` must not be taken for the vote column when a
// bare `Vote` column is present in the same header.
func TestFamilySkip4CSOPEighteenColumnWrappedLabels(t *testing.T) {
	rows, meta := familySkip4Dispatch(t, "csop_eighteen_column_wrapped_labels.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 1 CHINA STATE CONSTRUCTION ENGINEERING CORPORATION L proposal (security Y1R16Z106, meeting 02-Jul-2018, Vote For) for CSOP FTSE China A50 ETF",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName == "" {
			continue
		}
		seen++
		if r.MeetingDate != "20180702" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20180702")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q -- the Vote column, not Vote Options", r.HowVoted, "For")
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 CHINA STATE CONSTRUCTION proposal in %d parsed", seen, len(rows))
	}
}
