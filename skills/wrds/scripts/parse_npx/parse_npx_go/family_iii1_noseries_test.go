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

// 000081/811707/0001104659-04-026180.txt: 1-59, 296-633, 223106-223117.
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
// The htmltable layout reads the issuer, the meeting date and the CUSIP out of
// that same row and drops the leading portfolio cell: a full-file dispatch emits
// 51 rows and ALL 51 carry a blank series_id AND a blank fund_name, so
// dictFallback.apply returns on its `r.FundName == ""` guard and no lookup is
// ever attempted. All 51 rows of the filing are residue.
//
// This is the same vendor and the same defect as family HHH1's EquiTrust Series
// Fund (CIK 34549), whose column header reads `Series Fund` on ONE line. Here
// the header is `Variable Insurance` / `Series Fund` across a `<br>`, so a fix
// that keys on the literal single-line header text repairs the sibling filing
// and leaves this one in residue.
//
// The attribution is decidable per row: the six portfolio names the column
// prints (`Value Growth Portfolio`, `High Grade Bond Portfolio`, `Strategic
// Yield Portfolio`, `Managed Portfolio`, `Blue Chip Portfolio`, `Money Market
// Portfolio`) are each the dictionary name minus the registrant prefix
// `EquiTrust Variable Insurance Series Fund`, which the registrant-prefix strip
// already removes for banner headings.
//
// Fix in the htmltable per-row fund column path (layout_htmltable.go, the column
// header map that parseHTMLTableRaw builds and the row builder that fills
// VoteRow.FundName next to htmlBareFundLine): a first column whose header cell
// ends in `Series Fund` after the wrap is joined -- as `Fund #` already is in
// family DDD -- is a per-row fund column, and its value must be handed to
// icrResolveFundShared the way a section heading is, rather than dropped.
func TestFamilyIII1EquiTrustVISWrappedPortfolioColumnNeverResolves(t *testing.T) {
	rows := familyIII1Dispatch(t, "equitrust_vis_row_portfolio_column.txt", "equitrust_vis_dict.tsv", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000007087" {
			t.Errorf("per-row `Value Growth Portfolio` column under a wrapped `Variable Insurance / Series Fund` header not resolved: fund=%q issuer=%q cusip=%q series=%q want S000007087", r.FundName, r.IssuerName, r.CUSIP, r.SeriesID)
		}
	}
}
