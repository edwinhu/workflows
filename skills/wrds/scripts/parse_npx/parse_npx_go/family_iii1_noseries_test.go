package main

import (
	"path/filepath"
	"testing"
)

// familyIII1Dispatch runs the real dispatch on a family III no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when one is
// named.
func familyIII1Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_iii1", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_iii1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000081/811707/0001104659-04-026180.txt: 1-59, 296-473, 1434-1593,
// 223106-223117. The Abbott block is in the cut on purpose: the portfolio cell
// is printed only on the FIRST row of an issuer block, so a cut of the 7-Eleven
// block alone resolves every row and stops reproducing the real filing's blank.
// EquiTrust Variable Insurance Series Fund declares NO series in the SGML header
// of this 2004 filing, so the resolver sees only cik_series.tsv for CIK
// 0000811707, six ids under one spelling each:
//
//	0000811707	S000007087	EquiTrust Variable Insurance Series Fund Value Growth Portfolio
//	0000811707	S000007091	EquiTrust Variable Insurance Series Fund Blue Chip Portfolio
//
// The filing prints NO per-fund section heading. It names the portfolio in the
// FIRST COLUMN OF EVERY VOTE ROW, under a column header cell that WRAPS across
// two lines, verbatim:
//
//	<td width="12%" valign="bottom" style="border:none;border-bottom:solid windowtext 1.0pt;padding:0in 0in 0in 0in;width:12.06%;">
//	<p style="margin:0in 0in .0001pt;text-autospace:none;"><b><font size="1" face="Times New Roman" style="font-size:7.0pt;font-weight:bold;">Variable Insurance<br>
//	Series Fund</font></b></p>
//	</td>
//
// and the row beneath it opens with the portfolio and then carries the identity
// the layout does read:
//
//	<p style="margin:0in 0in .0001pt;text-autospace:none;"><font size="1" face="Times New Roman" style="font-size:7.0pt;">Value Growth Portfolio</font></p>
//	...
//	<p style="margin:0in 0in .0001pt;text-autospace:none;"><font size="1" face="Times New Roman" style="font-size:7.0pt;">7-Eleven</font></p>
//	...
//	<p align="right" style="margin:0in 0in .0001pt;text-align:right;text-autospace:none;"><font size="1" face="Times New Roman" style="font-size:7.0pt;">20040421</font></p>
//	...
//	<p style="margin:0in 0in .0001pt;text-autospace:none;"><font size="1" face="Times New Roman" style="font-size:7.0pt;">817826209</font></p>
//
// The vendor prints that cell ONLY on the first row of each issuer block. The
// next block opens with the cell empty, verbatim:
//
//	 <tr>
//	  <td width="12%" valign="top" style="padding:0in 0in 0in 0in;width:12.06%;">
//	  <p style="margin:0in 0in .0001pt;"><font size="1" face="Times New Roman" style="font-size:1.0pt;">&nbsp;</font></p>
//	  </td>
//	...
//	  <p style="margin:0in 0in .0001pt;text-autospace:none;"><font size="1" face="Times New Roman" style="font-size:7.0pt;">Abbott Laboratories</font></p>
//
// and the htmltable layout does not carry the last non-empty value forward past
// the issuer change. A full-file dispatch emits 51 rows: 13 -- the 7-Eleven
// block, whose first row prints the portfolio -- carry fund_name `Value Growth
// Portfolio` and S000007087, and the other 38 carry a blank fund_name AND a
// blank series_id, so dictFallback.apply returns on its `r.FundName == ""`
// guard and no lookup is ever attempted. The production census counts all 51
// rows of this filing as no-series.
//
// The attribution is decidable per row: the six portfolio names the column
// prints (`Value Growth Portfolio`, `High Grade Bond Portfolio`, `Strategic
// Yield Portfolio`, `Managed Portfolio`, `Blue Chip Portfolio`, `Money Market
// Portfolio`) are each the dictionary name minus the registrant prefix
// `EquiTrust Variable Insurance Series Fund`, which the registrant-prefix strip
// already removes for banner headings, and a blank cell in this vendor's layout
// means "same as above" -- the filing never re-states a portfolio it has not
// finished.
//
// Fix in the htmltable per-row fund column path (layout_htmltable.go, the column
// header map that parseHTMLTableRaw builds and the row builder that fills
// VoteRow.FundName next to htmlBareFundLine): a first column whose header cell
// reads `Variable Insurance / Series Fund` once the `<br>` wrap is joined is a
// per-row fund column, as `Fund #` already is in family DDD, and an EMPTY cell
// in it must inherit the last non-empty value of that column rather than reset
// the section to nothing.
func TestFamilyIII1EquiTrustVISBlankPortfolioCellNeverResolves(t *testing.T) {
	rows := familyIII1Dispatch(t, "equitrust_vis_row_portfolio_column.txt", "equitrust_vis_dict.tsv", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000007087" {
			t.Errorf("blank `Variable Insurance / Series Fund` cell on a continuation issuer block not inherited: fund=%q issuer=%q cusip=%q series=%q want S000007087", r.FundName, r.IssuerName, r.CUSIP, r.SeriesID)
		}
	}
}
