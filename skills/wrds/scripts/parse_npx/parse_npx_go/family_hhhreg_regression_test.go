package main

import (
	"path/filepath"
	"testing"
)

// familyHHHRegDispatch runs the real dispatch on a family HHHreg fixture.
func familyHHHRegDispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_hhhreg", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000135/1355064/0001580642-18-004117.txt: 1-19, 45-46, 100-152, 254-268,
// 10036-10123, 15407-15412. Mutual Fund Series Trust declares eight series in
// the SGML header of this 2018 filing, so the chassis single-series stamp never
// fires. The filing opens each fund section with a banner row whose nonblank
// cells are the registrant, the label GLUED to the fund name, and the form item,
// verbatim (line 10039-10043):
//
//	<TD NOWRAP STYLE="padding-top: 0.75pt; ..."><FONT ...><B>Registrant:&nbsp;&nbsp;Mutual Fund Series Trust</B></FONT></TD>
//	<TD NOWRAP STYLE="padding: 0.75pt 5.4pt">&nbsp;</TD>
//	<TD NOWRAP COLSPAN="4" STYLE="padding-top: 0.75pt; ..."><FONT ...><B>Fund Name - Eventide Health Care &amp; Life Sciences Fund</B></FONT></TD>
//	<TD NOWRAP STYLE="padding: 0.75pt 5.4pt">&nbsp;</TD>
//	<TD NOWRAP STYLE="padding-top: 0.75pt; ..."><FONT ...>Item 1</FONT></TD>
//
// htmlLabelledCells sees THREE nonblank cells. The family II rule at
// layout_htmltable.go:4784 drops the leading `Registrant:` cell whenever there
// are exactly three, leaving
//
//	["Fund Name - Eventide Health Care & Life Sciences Fund", "Item 1"]
//
// which the two-cell path then reads as label and value: the fund name becomes
// the literal `Item 1`, resolves to nothing, and every row of the section comes
// out with a blank series_id. A full-file dispatch emits 1,433 rows, of which
// 502 carry fund_name=`Item 1` and no series -- the whole Eventide Healthcare &
// Life Sciences section. (Before family II the same 502 rows were not blank but
// misattributed: the banner was not read at all and they inherited the
// preceding section's S000059102, which is why the earlier binary reported one
// no-series row and this one reports 502. Neither number is the right answer.)
//
// The attribution is decidable from the banner's own bytes: the glued cell
// spells `Eventide Health Care & Life Sciences Fund`, the declared name
// `Eventide Healthcare & Life Sciences Fund` (S000039514) modulo the space in
// `Health Care`, which the resolver's own spacing normalisation already covers
// once the cell reaches it as a heading rather than as a label.
//
// Fix in layout_htmltable.go, htmlLabelledCells: the len(vals)==3 registrant
// rule must not fire when the third cell is a form-item cell
// (reHTMLBannerItemCell, as the len(vals)==4 rule beside it already tests) --
// there the middle cell is a label and value glued into ONE cell and must be
// read the way the Putnam single-cell path at the top of the function reads it,
// not paired with `Item 1`.
func TestFamilyHHHRegItemCellStealsGluedFundBanner(t *testing.T) {
	rows := familyHHHRegDispatch(t, "mfst_item_cell_glued_fund_banner.txt", "htmltable", 4)
	for _, r := range rows {
		if r.SeriesID != "S000039514" {
			t.Errorf("`Fund Name - Eventide Health Care & Life Sciences Fund` banner lost to the `Item 1` cell: fund=%q issuer=%q cusip=%q series=%q want S000039514", r.FundName, r.IssuerName, r.CUSIP, r.SeriesID)
		}
	}
}
