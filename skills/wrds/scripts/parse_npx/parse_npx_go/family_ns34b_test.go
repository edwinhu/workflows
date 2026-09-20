package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// familyNS34bDispatch runs the real dispatch on a family NS34b fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// row's identity columns and never a broken fixture.
func familyNS34bDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns34b", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns34b", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	return rows
}

// 000155/1552947/0001580642-21-003998.txt (Two Roads Shared Trust, CIK 1552947,
// period 20210630, `proxyedge`): verbatim source lines 1-16, 83-94, 139-143,
// 177-237, 240-261 and the filing's own last six lines. Every byte is verbatim;
// the two header `<SERIES>` blocks (source lines 39-82) are supplied through
// `tworoads_dict.tsv` instead, to stay inside the line budget.
//
// THE SHAPE. This vendor hard-wraps a table cell across source lines, and
// `parseProxyEdge` reads the stripped document ONE LINE at a time rather than
// one CELL at a time, so every wrapped cell in the issuer block is misread.
// Source lines 198-199, 203, 208-209 and 215-216, verbatim:
//
//	<TD COLSPAN="5" ...; color: White"><B>NOVOLIPETSK
//	STEEL</B></FONT></TD>
//	<TD ... width: 13%"><FONT ...>X58996103</FONT></TD>
//	<TD ... width: 24%"><FONT ...>ExtraOrdinary
//	General Meeting</FONT></TD>
//	<TD ...><FONT ...>25-Sep-2020</FONT></TD>
//
// and the labels beside them, source lines 206-207 and 213-214, verbatim:
//
//	<TD ... width: 16%"><FONT ...><B>Meeting
//	Type:</B></FONT></TD>
//	<TD ...><FONT ...><B>Meeting
//	Date:</B></FONT></TD>
//
// PROBED, not judged by eye. `peNonBlank`/`peWholeCell` over this fixture
// (probe since deleted) print the block as, index, whole-cell flag, text:
//
//	31 whole=false "NOVOLIPETSK"
//	32 whole=false "STEEL"
//	33 whole=true  "Security:"
//	34 whole=true  "X58996103"
//	35 whole=false "Meeting"
//	36 whole=false "Type:"
//	37 whole=false "ExtraOrdinary"
//	38 whole=false "General Meeting"
//	39 whole=true  "Ticker:"
//	40 whole=false "Meeting"
//	41 whole=false "Date:"
//	42 whole=true  "25-Sep-2020"
//
// so the current tree walks it thus: line 32 (`STEEL`, the TAIL of the wrapped
// issuer cell) is followed by the identity label `Security:`, so the
// issuer-heading rule takes `STEEL` for the issuer; `Security:` then sets
// cusip=X58996103; the wrapped label `Meeting`/`Type:` matches no case and
// swallows `ExtraOrdinary`; line 38 (`General Meeting`, the TAIL of the wrapped
// MEETING TYPE VALUE) is followed by the identity label `Ticker:`, so the same
// issuer rule fires again -- issuer becomes the meeting-type fragment
// `General Meeting` AND the rule's reset wipes cusip, isin, date and type; the
// wrapped label `Meeting`/`Date:` then matches no case and swallows
// `25-Sep-2020`. Measured on the current tree, the one emitted row is
//
//	fund="Conductor Global Equity Fund" series="S000043622"
//	issuer="General Meeting" cusip="" isin="" ticker="Meeting" date=""
//
// which is what the whole filing does: all 1,685 rows carry
// issuer_name="General Meeting" with an empty cusip and an empty meeting date,
// while the issuer, the cusip and the date are all printed in the block above
// them. `icrCUSIP("X58996103")` is "X58996103" and `htmlDate("25-Sep-2020")` is
// "20200925", both probed, so the wanted values below are the parser's own
// normalisation of the printed bytes and nothing is invented.
//
// Fix location: `layout_proxyedge.go`. The cell stream `peNonBlank` builds must
// be a stream of CELLS, not of source lines -- `peWholeCell` already computes
// the run structure that says which lines were one hard-wrapped cell, so the
// join belongs there (and subsumes `peHeaderAt`'s existing two-line join hack
// for `Take`/`No Action`). With cells joined, `parseProxyEdge`'s label branch
// must also accept a label and its value inside ONE cell (`Meeting Type:` and
// its value arrive as separate cells here, but `Registrant:` arrives joined to
// its banner), and the bare-heading issuer rule must never fire on what was the
// tail of a wrapped cell. The same defect truncates the proposal text: this
// row's description is the tail `PAYMENT (DECLARATION) ON` of the wrapped cell
// `ON DIVIDEND` / `PAYMENT (DECLARATION) ON`.
//
// Series is out of scope here and stays as batch 134 left it (S000043622); it
// is asserted only so a fix to the identity columns cannot quietly undo it.
func TestFamilyNS34bTwoRoadsWrappedIssuerBlock(t *testing.T) {
	rows := familyNS34bDispatch(t, "tworoads_issuer_block.txt", "tworoads_dict.tsv", "proxyedge", 1)
	for _, r := range rows {
		if r.IssuerName != "NOVOLIPETSK STEEL" || r.CUSIP != "X58996103" || r.MeetingDate != "20200925" {
			t.Errorf("the NOVOLIPETSK STEEL ballot's identity columns are wrong: issuer=%q cusip=%q date=%q (want %q / %q / %q); fund=%q series=%q ticker=%q isin=%q desc=%q",
				r.IssuerName, r.CUSIP, r.MeetingDate,
				"NOVOLIPETSK STEEL", "X58996103", "20200925",
				r.FundName, r.SeriesID, r.Ticker, r.ISIN, r.VoteDescription)
		}
		// The Meeting Type cell reads `ExtraOrdinary General Meeting`. No part
		// of it is an issuer name, however the vendor wrapped it.
		if strings.Contains(strings.ToUpper(r.IssuerName), "MEETING") {
			t.Errorf("issuer_name is a Meeting Type fragment: issuer=%q", r.IssuerName)
		}
		if r.SeriesID != "S000043622" {
			t.Errorf("series regressed from what batch 134 left: series=%q fund=%q want %q", r.SeriesID, r.FundName, "S000043622")
		}
	}
}
