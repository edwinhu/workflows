package main

import (
	"path/filepath"
	"testing"
)

// familyDDD1Dispatch runs the real dispatch on a family DDD no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when one is
// named.
func familyDDD1Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ddd1", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ddd1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000122/1228431/0000910472-06-000321.txt: 14-15, 17-18, 24-25, 49-54, 59-64,
// 69-71, 76-83, 163-242. New River Funds' 2006 N-PX declares both of its series
// in the SGML header and prints one section per fund. The SECOND section names
// its fund in a bold banner of its own and resolves:
//
//	<FONT FACE="Arial" size="2"><B>NEW RIVER FUNDS: NEW RIVER SMALL CAP FUND</B></FONT></P>
//
// The FIRST section names its fund inside the vote table itself, in a
// colspan=6 cell of the table's own opening row, behind a `Registrant:` label
// and padded with entity runs on both sides of the fund name:
//
//	<TR><TD valign=bottom width=1033.4 colspan=6><P style="margin:0pt; "><B>
//		<font size="2">Registrant: NEW RIVER FUNDS: &nbsp;NEW RIVER CORE EQUITY FUND
//		&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</font></B></P>
//	</TD><TD valign=bottom width=91>&nbsp;</TD>...
//
// The rows beneath it come out with a blank fund_name and a blank series_id
// although `New River Core Equity Fund` is declared in the header as
// S000011050. 334 of the filing's 478 rows are that first section -- every row
// the filing prints before the Small Cap banner.
//
// Fix in parseHTMLTableRaw (layout_htmltable.go), in the `Registrant:` cell read
// near layout_htmltable.go:254: the label is recognised when it stands in a cell
// of its own, but here the label, the registrant and the fund share ONE
// colspan=6 cell that is also the table's first row, so the row is consumed as
// table furniture rather than read as a heading; the `&nbsp;` padding after the
// fund name must be trimmed and the registrant prefix `NEW RIVER FUNDS: `
// stripped before the declared-series lookup, which is what the Small Cap banner
// already gets.
func TestFamilyDDD1NewRiverRegistrantCellHeadingLosesCoreEquity(t *testing.T) {
	rows := familyDDD1Dispatch(t, "newriver_registrant_core_equity.txt", "", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000011050" {
			t.Errorf("`Registrant:` cell heading not read: fund=%q issuer=%q item=%q series=%q want S000011050", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000107/1074440/0001144204-05-026987.txt: 14-15, 17-18, 25-26, 50-54, 214,
// 229-375. Amidex Funds Inc's 2005 N-PX declares no series in its header and
// prints NO per-fund section heading at all. It names the fund on EVERY vote
// row instead, in the table's first column, whose header cell reads `Fund #`:
//
//	<div ...><font ...><strong>Fund
//	  #</strong></font></div>
//
//	<td align="left" valign="top" width="20%" bgcolor="#c0c0c0">
//	  <div ...><font ...>AMIDEX
//	    Cancer Innovations &amp; Healthcare Fund</font></div>
//	</td>
//
// The remaining header cells are `Company Name`, `Symbol`, `CUSIP`, `Date`,
// `Matter #`, `Matter`, `Proposed By`, `Vote casted`, `Vote`,
// `Management Vote` -- so `Company Name` is the ISSUER and the fund lives only
// in the `Fund #` column. The header mapping has no fund-name column, so all 332
// of the filing's rows come out with a blank fund_name and a blank series_id,
// although cik_series.tsv carries `Amidex Cancer Innovations & Healthcare Fund`
// for S000004490 and `Amidex35 Israel Mutual Fund` for S000004489 -- both of
// which the filing prints, 193 rows naming the Cancer fund.
//
// Fix in the header mapping of parseHTMLTableRaw (layout_htmltable.go): `Fund #`
// must map to a fund-name column, and its per-row cell must set the standing
// fund for that row the way a section heading does, so the series index resolves
// it. Today the `#` makes it read as a sequence column and the cell lands in
// item_seq -- the observed row carries item="AMIDEX Cancer Innovations &
// Healthcare Fund" with fund_name blank.
func TestFamilyDDD1AmidexFundNameColumnNeverRead(t *testing.T) {
	rows := familyDDD1Dispatch(t, "amidex_fund_name_column.txt", "amidex_dict.tsv", "htmltable", 1)
	for _, r := range rows {
		if r.SeriesID != "S000004490" {
			t.Errorf("`Fund #` column never read as the fund: fund=%q issuer=%q item=%q series=%q want S000004490", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
