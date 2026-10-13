package main

import (
	"path/filepath"
	"testing"
)

// familyJJJ1Dispatch runs the real dispatch on a family JJJ no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when one
// is named.
func familyJJJ1Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_jjj1", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_jjj1", fixture), sink, make([]byte, headBytes))
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

// 000078/789281/0001623632-23-001067.txt: 1-20, 47-57, 114-121, 219-357,
// 3734-3797. Federated Hermes Income Securities Trust declares SEVEN series in
// the SGML header of this 2023 filing, so nothing is stamped by the chassis and
// the htmltable layout must read the per-row `Fund Name` column. It does, for
// 3525 of the 3573 rows. The remaining 48 are the shape.
//
// The vendor's table has a fifteen-cell header, verbatim (one <TD> per line,
// abridged to the cell text):
//
//	Issuer Name | Country | Meeting Date | Meeting Type | Record Date |
//	Ticker | Security ID | Symbol Type | Ballot Issue Number | Proposal Text |
//	Proponent | Mgmt Reco | Vote Cast | Fund Name | Logical Ballot Status
//
// A well-formed data row fills all fifteen. 48 rows OMIT one value mid-row and
// PAD THE TAIL with an empty cell, keeping the count at fifteen, so every value
// after the omission sits one column to the LEFT of its header. The Bank of
// America row at line 3782 of the filing drops `Proponent` -- the word `Mgmt`
// is glued onto the end of the proposal text instead -- and ends, verbatim:
//
//	<TD STYLE="border-right: Black 1pt solid; border-bottom: Black 1pt solid; padding-top: 6pt; padding-bottom: 6pt"><FONT STYLE="font-size: 9pt">Amendment to the Bank of America Corporation Equity Plan Mgmt</FONT></TD>
//	<TD STYLE="border-right: Black 1pt solid; border-bottom: Black 1pt solid; padding-top: 6pt; padding-bottom: 6pt"><FONT STYLE="font-size: 9pt">For</FONT></TD>
//	<TD STYLE="border-right: Black 1pt solid; border-bottom: Black 1pt solid; padding-top: 6pt; padding-bottom: 6pt"><FONT STYLE="font-size: 9pt">For</FONT></TD>
//	<TD STYLE="border-right: Black 1pt solid; border-bottom: Black 1pt solid; padding-top: 6pt; padding-bottom: 6pt"><FONT STYLE="font-size: 9pt">Federated Hermes Capital Income Fund</FONT></TD>
//	<TD STYLE="border-right: Black 1pt solid; border-bottom: Black 1pt solid; padding-top: 6pt; padding-bottom: 6pt"><FONT STYLE="font-size: 9pt">Voted</FONT></TD>
//	<TD STYLE="border-right: Black 1pt solid; border-bottom: Black 1pt solid; padding-top: 6pt; padding-bottom: 6pt"><FONT STYLE="font-size: 9pt">&nbsp;</FONT></TD></TR>
//
// The other 47 (every Unilever plc row from line 26054 on) drop `Record Date`
// the same way. Positionally, `Fund Name` therefore reads `Voted` -- the
// LOGICAL BALLOT STATUS -- which resolves to nothing, and the row keeps a blank
// series_id. All 48 are dictionary-known funds naming themselves one cell over.
//
// Fix in layout_htmltable.go, where parseHTMLTableRaw maps a data row's cells
// onto the header positions: when a row's LAST cell is empty and the row is not
// otherwise short, the omission is upstream and the tail pad is filler -- drop
// the trailing empty and re-align the remaining values RIGHT against the header
// from the first cell that does not fit its column's vocabulary, rather than
// left from cell zero. `Voted`/`Unvoted`/`Not Voted` landing in the fund column
// while the previous cell holds a declared series name is the decidable signal.
func TestFamilyJJJ1FederatedTailPaddedRowShiftsFundColumn(t *testing.T) {
	rows := familyJJJ1Dispatch(t, "federated_hermes_tail_padded_row.txt", "", "htmltable", 4)
	for _, r := range rows {
		if r.SeriesID != "S000009073" {
			t.Errorf("tail-padded row shifted the `Fund Name` column onto `Logical Ballot Status`: fund=%q issuer=%q cusip=%q series=%q want S000009073", r.FundName, r.IssuerName, r.CUSIP, r.SeriesID)
		}
	}
}

// 000109/1091159/0000910472-04-000098.txt: 1-64, 200-450. Choice Funds declares
// NO series in the SGML header of this 2004 filing, so the resolver sees only
// cik_series.tsv for CIK 0001091159, four ids under one spelling each:
//
//	0001091159	S000011002	Choice Focus Fund
//	0001091159	S000011003	Choice Balanced Fund
//
// The filing prints NO per-fund section heading. It names the fund in the FIRST
// COLUMN OF EVERY ISSUER ROW, under a column header cell that reads, verbatim:
//
//	<P style="margin:0pt; padding-right:-30pt; line-height:10pt; font-family:Times New Roman; font-size:8pt"><B>Choice Product</B></P>
//
// and the first row beneath it opens with the fund and then carries the
// identity the layout does read, verbatim:
//
//	<TR><TD style="border-left:0.5pt solid #000000; border-right:0.5pt solid #000000; border-bottom:0.5pt solid #000000" valign=top width=131.933><P style="margin:0pt; padding-right:-30pt; line-height:10pt; font-family:Times New Roman; font-size:8pt"><B>Choice Balanced Fund</B></P>
//	...
//	<P style="margin:0pt; padding-right:-30pt; line-height:10pt; font-family:Times New Roman; font-size:8pt" align="center">Nokia Corporation</P>
//	...
//	<P style="margin:0pt; padding-right:-30pt; line-height:10pt; font-family:Times New Roman; font-size:8pt">654902204</P>
//
// The vendor prints that cell ONLY on the first row of each fund's block. Every
// continuation row opens with it blank, verbatim:
//
//	<TR><TD style="border-left:0.5pt solid #000000; border-right:0.5pt solid #000000; border-bottom:0.5pt solid #000000" valign=top width=131.933>&nbsp;</TD><TD style="border-right:0.5pt solid #000000; border-bottom:0.5pt solid #000000" valign=top width=132.133>
//
// The htmltable layout reads neither: a full-file dispatch emits 48 rows, ALL
// of them with a blank fund_name AND a blank series_id, so dictFallback.apply
// returns on its `r.FundName == ""` guard and no lookup is ever attempted. The
// production census counts all 48 rows of this filing as no-series.
//
// This is the family III1 EquiTrust shape under a different column header:
// `Choice Product` is a per-row fund column, and an EMPTY cell in it means
// "same as above". The four names the column prints are the dictionary names
// exactly, with no prefix or suffix to strip.
//
// Fix in the htmltable per-row fund column path (layout_htmltable.go, the
// column header map parseHTMLTableRaw builds and the row builder that fills
// VoteRow.FundName next to htmlBareFundLine): a first column whose header cell
// reads `Choice Product` -- more generally, a leading column whose header is
// not one of the identity vocabularies and whose values match declared or
// dictionary series names -- is a per-row fund column, and an empty cell in it
// inherits the last non-empty value of that column.
func TestFamilyJJJ1ChoiceProductRowFundColumnNeverRead(t *testing.T) {
	rows := familyJJJ1Dispatch(t, "choice_product_row_fund_column.txt", "choice_funds_dict.tsv", "htmltable", 6)
	for _, r := range rows {
		if r.SeriesID != "S000011003" {
			t.Errorf("`Choice Product` per-row fund column never read: fund=%q issuer=%q cusip=%q series=%q want S000011003", r.FundName, r.IssuerName, r.CUSIP, r.SeriesID)
		}
	}
}

// 000005/51815/0001104659-06-057529.txt: 1-100, 240-700, 17827-17960.
// Stonebridge Funds declares TWO series in the SGML header of this 2006 filing,
// verbatim:
//
//	<SERIES-ID>S000006629
//	<SERIES-NAME>Stonebridge Growth Fund
//	<CLASS-CONTRACT-TICKER-SYMBOL>SBGFX
//	<SERIES-ID>S000006630
//	<SERIES-NAME>Stonebridge Small-Cap Growth Fund
//	<CLASS-CONTRACT-TICKER-SYMBOL>SBAGX
//
// and prints TWO section headings, verbatim, 17,000 lines apart:
//
//	<p style="margin:0in 0in .0001pt;"><b><font size="2" face="Times New Roman" style="font-size:10.0pt;font-weight:bold;">Stonebridge Aggressive Growth Fund</font></b></p>
//
//	<p style="margin:0in 0in .0001pt;"><b><font size="2" face="Times New Roman" style="font-size:10.0pt;font-weight:bold;">Stonebridge Growth Fund</font></b></p>
//
// Neither the header nor cik_series.tsv carries `Stonebridge Aggressive Growth
// Fund`. A full-file dispatch nevertheless stamps BOTH sections S000006629: the
// 40 rows under `Stonebridge Aggressive Growth Fund` and the 5 rows under
// `Stonebridge Growth Fund` come out with the same series_id. That is worse
// than the blank the production census recorded for those 40 rows -- it is 40
// rows of the wrong fund's votes filed under a fund that has its own heading in
// the same document.
//
// Two DISTINCT headings in one filing cannot be the same series; that is
// decidable from the filing alone and needs no guess about which id the
// Aggressive Growth Fund actually is. (The class ticker SBAGX under
// S000006630 is suggestive, but the dictionary does not say so and this test
// does not assert it.)
//
// Fix in the issnpx/htmltable section resolver (layout_issnpx.go,
// issResolveFund and the type-word relaxation it applies before falling back):
// a heading that reaches a declared name only by DROPPING or SUBSTITUTING a
// distinguishing word -- `Aggressive` here -- must not resolve when that
// declared name is itself printed as a heading elsewhere in the same filing.
// Sibling-collision protection already exists for the dictionary path; it has
// to cover headings the same document declares.
func TestFamilyJJJ1StonebridgeAggressiveHeadingStealsSiblingSeries(t *testing.T) {
	rows := familyJJJ1Dispatch(t, "stonebridge_two_headings.txt", "", "htmltable", 7)
	for _, r := range rows {
		if r.FundName == "Stonebridge Aggressive Growth Fund" && r.SeriesID == "S000006629" {
			t.Errorf("heading `Stonebridge Aggressive Growth Fund` stamped with the sibling series that has its own heading in the same filing: issuer=%q cusip=%q series=%q", r.IssuerName, r.CUSIP, r.SeriesID)
		}
	}
}
