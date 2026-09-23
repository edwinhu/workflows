package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// Vericimetry Funds (CIK 0001524968), filing agent 0001398344, verbatim bytes.
// Fixture: 000152/1524968/0001398344-22-017468.txt (md5
// a9f1c8b64b11a4c2a4d88cf8340a813d), lines 1-156 (the SGML header, the N-PX
// cover page and the opening `<TABLE>` of the single voting-record table that
// runs to line 82106), lines 42204-42267 (the whole LANDSEA HOMES CORPORATION
// section), 45115-45185 (MATSON, INC.), 77591-77704 (VALARIS LIMITED) and
// 82106-82174 (the table close, the signature block and the document's closing
// tags), concatenated in file order.
//
// The registrant's sections are Broadridge/ProxyEdge-style label rows inside one
// giant table -- `TICKER:`, `MEETING DATE:`, `MEETING TYPE:`, `RECORD DATE:`,
// `SECURITY ID:`, then a `#PROPOSAL / BOARD REC / VOTE CAST / SPONSOR` header and
// the ballots. htmlReadContext already reads TICKER and SECURITY ID correctly
// (the fixture's CUSIPs 51509P103, 57686G105 and G9460G101 all land), but every
// MEETING DATE value in this filing is printed as a sentence fragment carrying a
// leading `be held` (the vendor truncated `The meeting will be held ...`):
//
//	be held Thursday, April 28, 2022
//	be held Wednesday, June 8, 2022 at 9:00 AM Pacific Time
//	be held Wednesday, June 8, 2022 at 8:00 a.m., Eastern Time
//	be held Wednesday, 8 June 2022
//	be held on Thursday, April 28, 2022
//
// -- 24 distinct value strings across the filing, every one of them prefixed.
// htmlDate strips a leading weekday token only when the weekday is the literal
// first word; here the first word is `be`, so nothing is stripped, brDate then
// sees six or more space/comma-delimited fields where it requires exactly three,
// and returns empty. ctx.MeetingDate stays blank for every proposal row in every
// section of the filing even though the filing prints the date on the face of
// each section.
//
// The three sections in this fixture cover the three shapes the prefix family
// takes: a plain `be held <Weekday>, <Month> <Day>, <Year>` (MATSON), the same
// with a trailing local-time clause the fix must also discard (LANDSEA, `at 9:00
// AM Pacific Time`), and a day-first `be held <Weekday>, <Day> <Month> <Year>`
// (VALARIS, `Wednesday, 8 June 2022`) -- the one ordering in the filing that a
// month-first-only reader would silently mis-date rather than blank. The sibling
// filing 0001398344-23-017193.txt prints the same family.
//
// This test asserts only the meeting date. It does not assert the ticker: the
// VALARIS section's own `TICKER:` row is blank in the real bytes, so those rows
// inherit the previous section's ticker, which is existing behaviour and not this
// family's subject.
func TestFamilyMeetingDateBeHeldPrefix(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict, seriesMap = nil, nil

	sink := &rowSink{}
	fixture := "vericimetry_beheld.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_meetingdate_beheld", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || meta.CIK != "0001524968" || meta.PeriodOfReport != "20220630" {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	if len(sink.buf) != 14 {
		t.Fatalf("fixture precondition: %d rows, want 14 (LANDSEA 2, MATSON 3, VALARIS 9)", len(sink.buf))
	}

	// Keyed by CUSIP, which the parser already reads correctly, so a failure
	// here is unambiguously the date and not a section-attribution problem.
	want := map[string]struct {
		date    string
		printed string
	}{
		"51509P103": {"20220608", "be held Wednesday, June 8, 2022 at 9:00 AM Pacific Time"},
		"57686G105": {"20220428", "be held Thursday, April 28, 2022"},
		"G9460G101": {"20220608", "be held Wednesday, 8 June 2022"},
	}
	seen := map[string]int{}
	reported := map[string]bool{}
	for i, r := range sink.buf {
		w, ok := want[r.CUSIP]
		if !ok {
			t.Fatalf("row %d has unexpected cusip %q (issuer %q) -- the fixture holds exactly three sections",
				i, r.CUSIP, r.IssuerName)
		}
		seen[r.CUSIP]++
		if r.MeetingDate != w.date && !reported[r.CUSIP] {
			reported[r.CUSIP] = true
			t.Errorf("issuer=%s cusip=%s meeting_date=%q, want %q -- the section prints %q; the leading `be held` defeats the weekday strip in htmlDate, so brDate sees too many fields and returns empty",
				strings.TrimSpace(r.IssuerName), r.CUSIP, r.MeetingDate, w.date, w.printed)
		}
	}
	for cusip, n := range map[string]int{"51509P103": 2, "57686G105": 3, "G9460G101": 9} {
		if seen[cusip] != n {
			t.Fatalf("fixture precondition: %d rows under cusip %s, want %d", seen[cusip], cusip, n)
		}
	}
}
