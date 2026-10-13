package main

import (
	"path/filepath"
	"testing"
)

// familyNS38Dispatch runs the real dispatch on a family NS38 fixture with NO
// dictionary and no overlay loaded -- this family's registrant declares its
// series in its own header, so the resolution under test is the filing's own --
// and asserts the fixture's preconditions (status, layout, row count) so a
// failure below is an assertion about the fund banner and never a broken
// fixture.
func familyNS38Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns38_csop", fixture), sink, make([]byte, headBytes))
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

// 000161/1617113/0001144204-16-119504.txt: verbatim source lines 1-86, 193-277,
// 1731-1811, 23935 and 320290-320294. Every byte is a line-range cut of the
// source; line 23935 is the filing's own `</TABLE>` and closes the table the
// 277/1731 cut leaves open (both spliced blocks are rows of the SAME <TABLE>,
// which opens at 205 and closes at 23935, so the splice is contiguous markup).
// Dispatches to `proxyedge` (the precondition asserts it).
//
// CSOP ETF Trust, CIK 1617113, period 20160630. 17,653 of the filing's 17,734
// rows carry NO series. The registrant declares three series in its own header
// (source lines 44-72) and prints all three as centered <P> banners, each once:
//
//	line   46  <SERIES-NAME>CSOP FTSE CHINA A50 ETF                      S000047470
//	line  197  CSOP FTSE China A50 ETF                                   (the banner)
//	line   56  <SERIES-NAME>CSOP China CSI 300 A-H Dynamic ETF           S000051155
//	line 23949 CSOP China CSI 300 A-H Dynamic ETF                        (the banner)
//	line   66  <SERIES-NAME>CSOP MSCI China A International Hedged ETF   S000051156
//	line 149631 CSOP MSCI China A International Hedged ETF               (the banner)
//
// CASE IS NOT THE DEFECT. The banner at line 197 is title-case (`China`) and the
// header is all-caps (`CHINA`), and the banner nevertheless resolves: measured
// on the whole filing through the real dispatch, the first 81 rows carry
// fund_name `CSOP FTSE China A50 ETF` AND series_id S000047470. The banner is
// read and answered. It is then OVERWRITTEN, at row 82, and never recovers --
// all 17,653 remaining rows carry a blank series and a fund_name that is a
// fragment of PROPOSAL TEXT. Measured on the whole filing, the 67 distinct
// fund_name values it emits are, in order of mass:
//
//	1,787 rows  fund_name = CAPITAL WITH SURPLUS RAISED FUNDS
//	1,419 rows  fund_name = WITH RAISED FUNDS: A NEWLY-ADDED
//	1,135 rows  fund_name = PARTY TRANSACTIONS OF USES OF FUNDS
//	1,090 rows  fund_name = RAISING MATCHING FUND IS IN COMPLIANCE
//	   81 rows  fund_name = CSOP FTSE China A50 ETF   <- the only real banner
//
// THE BYTES. The vendor hard-wraps a proposal cell with <BR>, one <FONT> per
// wrap line, each on its own SOURCE line. Source lines 1788-1792, verbatim
// (item 1 of the CITIC SECURITIES ballot, meeting 25-Aug-2015):
//
//	    <TD NOWRAP STYLE="...">...10pt">1</FONT></TD>
//	    <TD COLSPAN="3" STYLE="...">...10pt">TARGETED ADDITIONAL OFFERING H-SHARE</FONT><BR>
//	<FONT STYLE="...">TO NATIONAL COUNCIL FOR SOCIAL</FONT><BR>
//	<FONT STYLE="...">SECURITY FUND AND LISTING ON THE HONG</FONT><BR>
//	<FONT STYLE="...">KONG STOCK EXCHANGE: STOCK TYPE</FONT></TD>
//
// That is ONE cell, four wrap lines. But <BR> is a block tag (html.go:16) and so
// emits a newline, and the source newline that FOLLOWS each <BR> emits a second
// one -- so stripHTML hands proxyedge a BLANK LINE between every wrap line of
// the cell. Measured through stripHTML on source lines 1787-1800:
//
//	 2 |1|
//	 3 ||
//	 4 |TARGETED ADDITIONAL OFFERING H-SHARE|
//	 5 ||
//	 6 |TO NATIONAL COUNCIL FOR SOCIAL|
//	 7 ||
//	 8 |SECURITY FUND AND LISTING ON THE HONG|
//	 9 ||
//	10 |KONG STOCK EXCHANGE: STOCK TYPE|
//
// peWholeCell (layout_proxyedge.go:95-120) reads "stood alone between the blank
// lines the markup leaves around a cell" as the test for a whole cell, so it
// marks all four wrap lines whole. Every guard downstream then fires on the
// wrong thing:
//
//   - the bare-heading scan at layout_proxyedge.go:429-436 takes wrap line 3,
//     `SECURITY FUND AND LISTING ON THE HONG`, for a fund banner, because
//     peFundName (:257) matches the substring " FUND" and whole[i] is true. The
//     `!peItemCell(lines, i-1, labels)` guard does not help: line i-1 is another
//     wrap line, not the item number. The fund is replaced by proposal text.
//   - peVoteRow reads len(labels) CONSECUTIVE cells positionally, so a row whose
//     description wrapped over four lines is four cells too long and every field
//     after it shifts: item_seq carries description text and the item NUMBER is
//     lost on every row of the filing, the very first one included.
//
// Rows reached: 17,653 of this filing's 17,734. The wrap is the vendor's default
// (this filing wraps essentially every proposal), so the reach extends to the
// rest of the EDGARizerAgent/ProxyEdge family wherever <BR> is followed by a
// source newline -- the sibling shape peWholeCell's own comment records
// (American National 2009) wraps WITHOUT the newline and is unaffected.
//
// Fix in layout_proxyedge.go, in the cell model peWholeCell/peCellRun build (or
// in what parseProxyEdge is handed): the wrap lines of ONE <BR>-wrapped <td>
// must be one cell even when a blank line separates them, so that neither the
// head nor the tail of the wrap can be a fund banner and peVoteRow's positional
// read stays aligned. Nothing in this fixture requires a fix in stripHTML: the
// <td> boundaries are still in the stream, and the blank line is inside a cell.
func TestFamilyNS38CSOPWrappedProposalLineTakenForTheFundBanner(t *testing.T) {
	rows := familyNS38Dispatch(t, "csop_br_wrapped_cell_clobbers_the_fund_banner.txt", "proxyedge", 3)
	for _, r := range rows {
		if r.SeriesID != "S000047470" {
			t.Errorf("a <BR> wrap line of the proposal cell was taken for the fund banner: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000047470 (the banner `CSOP FTSE China A50 ETF`, source line 197)", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
