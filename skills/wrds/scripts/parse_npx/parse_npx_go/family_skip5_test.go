package main

import (
	"path/filepath"
	"testing"
)

// familySkip5Dispatch runs the real dispatch on a family SKIP5 fixture and
// returns the rows with the manifest row. Like familySkip4Dispatch it asserts
// no precondition: the defect under test IS the missing rows, so a precondition
// on them would turn each of these into a fixture error rather than a failed
// assertion.
//
// Family SKIP5 is the residue family SKIP4 left open after batch 85. Batch 85
// gave the ISS institutional-account signature a reader of its own in
// layout_splittable.go (spInstitutionalPreRows), which is why Lincoln Variable
// 2020 now emits 46 rows instead of zero. Both tests below are about what that
// reader, and htmltable, still do not reach.
func familySkip5Dispatch(t *testing.T, fixture string) ([]VoteRow, FilingMeta) {
	t.Helper()
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_skip5", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	return rows, meta
}

// 000091/914036/0001193125-20-228094.txt: verbatim lines 1-15, 365-372,
// 1272-1281, 66636-66695 and the filing's own last four lines. Lincoln Variable
// Insurance Products Trust 2020 (CIK 914036, 64.2 MB) emits 46 rows on the
// current tree -- not zero, as before batch 85, and not the whole export. The
// 46 are exactly the ballots printed on the FIRST page of each of the four fund
// reports that carry any. The ISS institutional export is PAGINATED: each page
// is its own <PRE>, and only a fund's first page repeats the stacked column
// header over its dashed rule. Continuation pages print bare ballot lines in a
// narrower fixed-width shape with no header and no rule at all, so
// spInstitutionalPreRows -- which keys a block on the dashed rule under the
// stacked labels -- opens no block for them and drops every one.
//
// The bytes at the stop (66658-66695, verbatim, elided in the middle):
//
//	AEDAS Homes                                                       Approve Consolidated and
//	SAU                                                               Standalone Financial
//	                     AEDAS   E01587109     30-Mar-20      1       Statements                      Management     For
//	                     Vote Against
//	Company Name         Management
//	------------         ------------
//	...
//	</PRE>
//	 </DIV>
//	<p style="margin-top:1em; margin-bottom:0em; page-break-before:always">
//	<HR SIZE="3" style="COLOR:#999999" WIDTH="100%" ALIGN="CENTER"><DIV ALIGN="LEFT">
//	<PRE>
//
//	AEDAS Homes                                   Advisory Vote on
//	SAU          AEDAS  E01587109  30-Mar-20  10  Remuneration Report            Management  For  No
//	AEDAS Homes                                   Approve Consolidated and
//	SAU                                           Standalone Management
//	             AEDAS  E01587109  30-Mar-20  2   Reports                        Management  For  No
//	AEDAS Homes
//	SAU          AEDAS  E01587109  30-Mar-20  3   Approve Discharge of Board     Management  For  No
//
// Two things happen at that boundary. The page's WIDE table spills its last
// column onto the same page as a second panel under its own two-line header and
// rule (`Vote Against / Management`), whose body lines are issuer names with a
// bare `No` -- a panel of the SAME ballots, not new ones. And the ballots that
// did not fit continue on the NEXT page with no header, so the AEDAS Homes SAU
// meeting of 30-Mar-20 prints item 1 on the first page and items 10, 2, 3, 4, 5
// on the second; the parser keeps item 1 and loses the rest.
//
// Fix in layout_splittable.go, spInstitutionalPreRows: carry the block's
// column spans across a page break -- when a <PRE> opens with body lines and no
// stacked header of its own, reuse the spans and the fund context of the
// preceding block rather than skipping the page -- and recognise the spilled
// `Vote Against / Management` panel as a continuation of the columns already
// read for that page rather than as a new block.
func TestFamilySkip5LincolnISSInstitutionalPageBreak(t *testing.T) {
	rows, meta := familySkip5Dispatch(t, "lincoln_iss_institutional_page_break.txt")
	var aedas []VoteRow
	for _, r := range rows {
		if r.IssuerName == "AEDAS Homes SAU" {
			aedas = append(aedas, r)
		}
	}
	if len(aedas) != 6 {
		t.Fatalf("read %d of the 6 AEDAS Homes SAU ballots (%d rows in all: status=%s layout=%s error=%q); the fixture prints item 1 on the first page and items 10, 2, 3, 4 and 5 on the page after the break, all security E01587109, meeting 30-Mar-20, Vote Instruction For, for LVIP BlackRock Global Real Estate Fund",
			len(aedas), len(rows), meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seenItem3 bool
	for _, r := range aedas {
		if r.CUSIP != "E01587109" {
			t.Errorf("security id: got %q want %q", r.CUSIP, "E01587109")
		}
		if r.MeetingDate != "20200330" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20200330")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q -- the Vote Instruction column", r.HowVoted, "For")
		}
		if r.ItemSeq == "3" {
			seenItem3 = true
		}
	}
	if !seenItem3 {
		t.Errorf("item 3 (Approve Discharge of Board) is printed on the page after the break and was not read")
	}
}

// 000107/1072962/0001193125-12-374997.txt: verbatim lines 1-10, 15-16,
// 372-381, 413-414, 421-422, 515-575 and the filing's own last four lines.
// Waddell & Reed Advisors Funds 2012 (CIK 1072962, 39.2 MB) emits ZERO rows on
// the current tree -- measured on the whole filing, not just this cut:
// `n_rows=0 parse_mode=text layout=unknown:management:150e3cdb parse_status=skip`.
// It is the ISS `Vote Summary Report` template, and its ballot header row opens
// with a COLSPAN="3" cell of PROSE:
//
//	<TD VALIGN="bottom" COLSPAN="3" NOWRAP> <P ...><B>Voting Policy: Waddell &amp; Reed
//	&nbsp;&nbsp;&nbsp;&nbsp;Ballot Count: 1</B></FONT></P></TD>
//	<TD ...><B>Proponent</B></TD>
//	<TD ...><B>Votable<BR>Proposal</B></TD>
//	<TD ...><B>Mgmt&nbsp;Rec</B></TD>
//	<TD ...><B>ISS&nbsp;Rec</B></TD>
//	<TD ...><B>Policy&nbsp;Rec</B></TD>
//	<TD ...><B>Vote<BR>Instruction</B></TD></TR>
//
// and the ballot beneath it is an ordinary row of that arity:
//
//	1 | Elect Director Andy D. Bryant | Mgmt | Yes | For | For | For | For
//
// Unlike the TDAM shape batch 76 landed, the header is NOT split across two
// <TR>s, so a column-wise join is not what this needs. The refusal is the prose
// guard in htmlHeaderShape: the leading cell is a sentence, so the row is not
// adopted as a header, and htmltable returns errLayoutDeclined over a body it
// matched.
//
// Fix in layout_htmltable.go, htmlHeaderShape: a header row whose LEADING cell
// is prose but whose remaining cells are short mapped labels should be admitted
// on those labels, with the prose cell dropped rather than the whole row
// refused.
func TestFamilySkip5WaddellProseHeaderCell(t *testing.T) {
	rows, meta := familySkip5Dispatch(t, "waddell_prose_header_cell.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 1 McKesson Corporation ballot (item 1, Elect Director Andy D. Bryant, Proponent Mgmt, Vote Instruction For) for the 23 Waddell & Reed Advisors Accumulative Fund account",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.ItemSeq != "1" {
			continue
		}
		seen++
		if r.VoteDescription != "Elect Director Andy D. Bryant" {
			t.Errorf("vote description: got %q want %q", r.VoteDescription, "Elect Director Andy D. Bryant")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q -- the Vote Instruction column", r.HowVoted, "For")
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 item-1 ballot in %d parsed", seen, len(rows))
	}
}
