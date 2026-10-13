package main

import (
	"path/filepath"
	"testing"
)

const ns1650TwoRoadsDir = "family_ns1650_tworoads_proxyedge_fund_seed"

// ns1650TwoRoadsDispatch runs the real dispatch on a fixture in this family's
// testdata dir with the named dictionary loaded, asserting the fixture's own
// preconditions -- status, layout, row count -- so a failure in the body of
// either test below is an assertion about the fund this row was filed under and
// never a broken fixture. Same mechanism as ns1644419ProxyRecordDispatch,
// pointed at its own testdata dir.
func ns1650TwoRoadsDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns1650TwoRoadsDir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1650TwoRoadsDir, fixture), sink, make([]byte, headBytes))
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

// Two Roads Shared Trust, CIK 0001552947, period 20210630, filing
// 000155/1552947/0001580642-21-003998.txt (`proxyedge`, 1,680 rows). The SAME
// filing families NS34 and NS34b were cut from, and both of those are green on
// HEAD -- `go test -run 'TestFamilyNS34'` -> ok. Neither reaches this filing's
// remaining residue, because each cut its fixture in a way that removed the
// bytes that actually break the real document.
//
// MEASURED ON THE REAL FILING, not read off the code. Running the tracked
// binary /scratch/nyu/eddyhu/npx-reconcile-corpus/bin/parse_npx_go_375 over just
// these bytes, with -cik-series and -series-map both pointed at the real corpus
// files, the filing's 1,680 rows split by fund_name thus (field 8 is series_id,
// field 10 is fund_name in the votes TSV):
//
//	rows  fund_name                                     series_id
//	 573  The Corporation Trust Company                 (blank)   <- section 1, ALL of it
//	 377  Conductor International Equity Value Fund      S000065356
//	 536  FROM APPROPRIATING FUNDS                      (blank)   <- section 2
//	 194  DEPOSIT SERVICES, FUND TRANSFER               (blank)   <- section 2
//
// 1,303 of 1,680 rows carry no series. The panel's LOST_BASE still records 573
// for this filing: that census was taken on binary 370/371, and re-running 370,
// 371, 372, 374 and 375 over the same two paths gives 573, 573, 1303, 1303,
// 1303 -- so the 730 rows of the third and fourth lines above are a REGRESSION
// introduced at binary 372, and the second test below pins it.
//
// The filing is ONE document holding TWO fund sections, each opened by its own
// `Registrant:` banner. Source lines 180-182 and 31891-31893, verbatim:
//
//	    <TD STYLE="text-align: left; font: 10pt Arial, Helvetica, Sans-Serif; padding: 3pt"><FONT STYLE="font-size: 10pt">Registrant:
//	    <U>TWO ROADS SHARED TRUST - Conductor Global Equity Fund</U> </FONT></TD>
//	    <TD COLSPAN="4" STYLE="text-align: right; font: 10pt Arial, Helvetica, Sans-Serif; padding: 3pt">Item 1, Exhibit 24</TD></TR>
//
//	    <TD STYLE="text-align: left; font: 10pt Arial, Helvetica, Sans-Serif; padding: 3pt"><FONT STYLE="font-size: 10pt">Registrant:
//	    <U>TWO ROADS SHARED TRUST - Conductor International Equity Value Fund</U> </FONT></TD>
//	    <TD COLSPAN="4" STYLE="text-align: right; font: 10pt Arial, Helvetica, Sans-Serif; padding: 3pt">Item 1, Exhibit 25</TD></TR>
//
// Section 2's banner IS read (row 573 onwards carries S000065356). Section 1's
// is not, and that is what this family's first test is about.
//
// Neither fund name is invented here. The filing's own SEC-HEADER declares
// exactly two series, source lines 39-82, and both fixtures carry that block
// verbatim: S000043622 `Conductor Global Equity Value Fund` and S000065356
// `Conductor International Equity Value Fund`. dict.tsv is all 56 real
// cik_series.tsv rows for this CIK, verbatim, so nothing below is made
// unambiguous by hiding a rival spelling -- the file holds two rival names for
// S000043622 and three for S000042694.

// SHAPE 1. `ITEM 1. PROXY VOTING RECORD:` is a whole cell ending in a colon, so
// the label branch of parseProxyEdge (layout_proxyedge.go:840-847) reads it as a
// LABEL and consumes the NEXT cell as its value. The next cell is the section's
// entire Registrant banner, so the banner is swallowed by a label the switch at
// layout_proxyedge.go:865-905 has no case for, and the `REGISTRANT` case never
// runs. The fund is left as the bare-heading scan
// (layout_proxyedge.go:959) set it one cell earlier, off the cover page's
// agent-for-service paragraph -- source line 141, verbatim:
//
//	<P STYLE="font: 12pt Times New Roman, Times, Serif; margin: 0; text-align: center">The Corporation Trust Company</P>
//
// which satisfies peFundName because `Trust` is a fund word. "The Corporation
// Trust Company" is CSC's Delaware registered agent, not a fund: fund_name is
// wrong as well as series being blank.
//
// PROBED, not judged by eye. peCellLines/peWholeCells/peCellAt over the two
// fixtures that differ by exactly one source line print the cell stream as,
// index, whole-cell flag, line, joined cell:
//
//	WITHOUT source line 165
//	18 whole=true  "The Corporation Trust Company"                        -> "The Corporation Trust Company"
//	19 whole=false "Registrant:"                                          -> "Registrant: TWO ROADS SHARED TRUST - Conductor Global Equity Fund"
//	20 whole=false "TWO ROADS SHARED TRUST - Conductor Global Equity Fund" -> "TWO ROADS SHARED TRUST - Conductor Global Equity Fund"
//
//	WITH source line 165
//	18 whole=true  "The Corporation Trust Company"                        -> "The Corporation Trust Company"
//	19 whole=true  "ITEM 1. PROXY VOTING RECORD:"                         -> "ITEM 1. PROXY VOTING RECORD:"
//	20 whole=false "Registrant:"                                          -> "Registrant: TWO ROADS SHARED TRUST - Conductor Global Equity Fund"
//	21 whole=false "TWO ROADS SHARED TRUST - Conductor Global Equity Fund" -> "TWO ROADS SHARED TRUST - Conductor Global Equity Fund"
//
// and the emitted row, over fixtures differing ONLY in whether source line 165
// is present (every other byte identical, dictionary identical):
//
//	without line 165 -> fund="Conductor Global Equity Fund" series="S000043622"
//	with    line 165 -> fund="The Corporation Trust Company" series=""
//
// So the swallowing IS the defect, and it is why NS34's fixture is green while
// the real filing is not: NS34 kept source lines 139-143 and 177-237 and cut
// everything between, which dropped line 165. Source line 165, verbatim:
//
//	<P STYLE="font: 12pt Times New Roman, Times, Serif; margin: 0; text-align: justify">ITEM 1. PROXY VOTING RECORD:</P>
//
// Section 2 has no such cell above its banner -- the marker is printed once, on
// the cover page -- which is exactly why section 2 resolves and section 1 does
// not, and why the split is 573 / 1,107 and not some other split.
//
// Fix location: layout_proxyedge.go, the label branch at 827-847. A cell ending
// in a colon that matches NONE of the switch's labels must not consume the next
// cell -- an unrecognised label has no value to take, and taking one hides the
// following banner. `ITEM 1. PROXY VOTING RECORD:` is the N-PX item heading, a
// document marker, not a field label.
//
// FIXTURE. tworoads2021_item_one_colon_swallows_banner.txt is verbatim source
// lines 1-94 (the SEC-DOCUMENT opener, the whole SEC-HEADER including the
// SERIES-AND-CLASSES-CONTRACTS-DATA block declaring both series, the document
// preamble, <TEXT>, <HTML>, <BODY>), 139-143 (the cover page's
// agent-for-service block, which is where the current tree takes its fund name
// from), 163-261 (the `ITEM 1. PROXY VOTING RECORD:` line, the section's own
// `Registrant:` banner table, the whole NOVOLIPETSK STEEL issuer block, the
// proposal table header and its first item row) and 93158-93162 (the filing's
// own last five lines). Nothing is synthesised and nothing is edited.
func TestFamilyNS1650TwoRoadsItemOneColonSwallowsBanner(t *testing.T) {
	rows := ns1650TwoRoadsDispatch(t, "tworoads2021_item_one_colon_swallows_banner.txt", "dict.tsv", "proxyedge", 1)
	for i, r := range rows {
		// The identity columns are NS34b's subject and are asserted only so a
		// fix to the fund seed cannot quietly undo them.
		if r.IssuerName != "NOVOLIPETSK STEEL" || r.CUSIP != "X58996103" || r.MeetingDate != "20200925" {
			t.Errorf("row %d: identity regressed from what NS34b left: issuer=%q cusip=%q date=%q want %q / %q / %q",
				i+1, r.IssuerName, r.CUSIP, r.MeetingDate, "NOVOLIPETSK STEEL", "X58996103", "20200925")
		}
		if r.FundName != "Conductor Global Equity Fund" || r.SeriesID != "S000043622" {
			t.Errorf("row %d: the `ITEM 1. PROXY VOTING RECORD:` cell swallowed the section's Registrant banner, so the row is filed under the cover page's agent for service: fund=%q series=%q want %q / %q (issuer=%q cusip=%q date=%q desc=%q)",
				i+1, r.FundName, r.SeriesID, "Conductor Global Equity Fund", "S000043622",
				r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription)
		}
	}
}

// SHAPE 2, the 730-row regression introduced at binary 372. This vendor wraps a
// long proposal description over several ITEM ROWS, each continuation row
// printing an empty Item cell and the next slice of the description. NS34b made
// peCellLines join a hard-wrapped cell into one cell, which is right, but a
// joined continuation cell now looks exactly like a whole one-cell banner: when
// its text happens to carry a fund word it is taken for a fund banner by the
// bare-heading scan at layout_proxyedge.go:959 and clears the section's fund for
// every row after it.
//
// The guard that should stop it, peItemCell(lines, tbl, i-1, i, labels), tests
// the cell BEFORE this one. In the FIRST continuation row of a run that cell is
// the previous row's Item cell and the guard holds; in the SECOND and later it
// is the previous continuation row's own prose cell, and the guard does not.
// PROBED by adding back exactly one preceding continuation row, everything else
// byte-identical:
//
//	fixture = ... issuer block, item-table header, 49738-49766  -> fund="Conductor International Equity Value Fund" series="S000065356"
//	fixture = ... issuer block, item-table header, 49728-49766  -> fund="FROM APPROPRIATING FUNDS"                  series=""
//
// Source lines 49728-49741, verbatim but for the STYLE attributes elided here
// (the fixture itself carries them in full):
//
//	<TR >
//	  <TD ><FONT >&nbsp;</FONT></TD>
//	  <TD ><FONT >CONTROLLERS
//	  AND RELATED PARTIES</FONT></TD>
//	  ... six empty cells ...
//	<TR >
//	  <TD ><FONT >&nbsp;</FONT></TD>
//	  <TD ><FONT >FROM APPROPRIATING
//	  FUNDS</FONT></TD>
//
// `FROM APPROPRIATING FUNDS` is the tail of ZHUZHOU CRRC TIMES ELECTRIC's
// proposal 29, not a fund: it carries the fund word `FUNDS` and nothing else
// recommends it. On the real filing this fires twice in section 2 -- at this
// cell (536 rows) and again at `DEPOSIT SERVICES, FUND TRANSFER`, source line
// 82535 (194 rows) -- and the fund transitions traced over the whole filing are
// row 0 -> "The Corporation Trust Company", row 573 -> "Conductor International
// Equity Value Fund" / S000065356, row 950 -> "FROM APPROPRIATING FUNDS" / "",
// row 1486 -> "DEPOSIT SERVICES, FUND TRANSFER" / "". Row 950 is the row this
// fixture pins.
//
// Fix location: layout_proxyedge.go. peItemCell must recognise a CONTINUATION
// RUN, not just the row immediately below a real item row -- a row whose Item
// cell is empty is inside the proposal table whatever the row above it held --
// or peWrappedProse must mark a joined wrapped cell so the bare-heading scan
// refuses it as it did before the cells were joined.
//
// FIXTURE. tworoads2021_second_continuation_cell_as_banner.txt is verbatim
// source lines 1-94 (as above), 31891-31893 (section 2's own `Registrant:`
// banner, the fund the row is entitled to), 48263-48317 (the ZHUZHOU CRRC TIMES
// ELECTRIC issuer block and the proposal table's column header), 49728-49766
// (the two consecutive blank-Item continuation rows, the blank row between them
// and proposal 30, the first real item row after them) and 93158-93162. Nothing
// is synthesised and nothing is edited; the cut at 48318-49727 drops proposals
// 1-29, which is why the fixture emits one row where the real block emits many.
func TestFamilyNS1650TwoRoadsContinuationCellAsFundBanner(t *testing.T) {
	rows := ns1650TwoRoadsDispatch(t, "tworoads2021_second_continuation_cell_as_banner.txt", "dict.tsv", "proxyedge", 1)
	for i, r := range rows {
		if r.IssuerName != "ZHUZHOU CRRC TIMES ELECTRIC CO LTD" || r.CUSIP != "Y9892N104" || r.MeetingDate != "20201207" {
			t.Errorf("row %d: the fixture's own issuer block has moved: issuer=%q cusip=%q date=%q want %q / %q / %q",
				i+1, r.IssuerName, r.CUSIP, r.MeetingDate, "ZHUZHOU CRRC TIMES ELECTRIC CO LTD", "Y9892N104", "20201207")
		}
		if r.FundName != "Conductor International Equity Value Fund" || r.SeriesID != "S000065356" {
			t.Errorf("row %d: a proposal continuation cell was taken for a fund banner and cleared section 2's fund: fund=%q series=%q want %q / %q (issuer=%q cusip=%q date=%q desc=%q)",
				i+1, r.FundName, r.SeriesID, "Conductor International Equity Value Fund", "S000065356",
				r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription)
		}
	}
}
