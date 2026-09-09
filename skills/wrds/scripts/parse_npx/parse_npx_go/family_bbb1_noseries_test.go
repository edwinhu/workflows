package main

import (
	"path/filepath"
	"testing"
)

// familyBBB1Dispatch runs the real dispatch on a family BBB no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when one
// is named.
func familyBBB1Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_bbb1", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_bbb1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000104/1047712/0001145443-06-002812.txt: 14-15, 17-18, 25-26, 51-53, 108-111,
// 152-156, 159-160, 164, 223-228, 264, 270, 273-312. Undiscovered Managers
// Funds' 2006 N-PX declares four series, S000004187 `JPMorgan Realty Income
// Fund` among them, and prints an equals-rule heading over every section. The
// three UNDISCOVERED MANAGERS sections resolve; the JPMorgan one, which is the
// FIRST section and the only one preceded by the cover page, does not, and its
// rows lose the issuer as well.
//
// The cover page's last table closes without a </tr>:
//
//	    <TD WIDTH="82%" VALIGN="TOP">
//	        <p style='...'><font size=2>&nbsp;...July 1, 2005 through June 30, 2006</font></p></td> </table>
//
//	<h3>==================== JPMORGAN REALTY INCOME FUND ====================</h3>
//	<h3>ALEXANDRIA REAL ESTATE EQUITIES, INC.</h3>
//	<table width="400px">
//
// (*htmlRowFeed).scan (layout_htmltable.go:855) delimits on </tr>, so that row's
// segment runs to the NEXT <tr> -- the one inside the vote table below the two
// headings. The segment's own `<tr` sits at offset 0, so
// pre = htmlPreText(seg[:start]) is empty and BOTH headings are swallowed into
// the unterminated cover row. Cut the same section out of the filing without the
// cover table above it and it resolves to S000004187 with the issuer set.
//
// 439 of the filing's 2,291 rows -- the whole JPMorgan Realty Income Fund
// section -- carry a blank fund_name, a blank issuer_name and a blank series_id.
//
// Fix in (*htmlRowFeed).scan: when the segment carries a </table> after its
// <tr>, the markup past that terminator is not part of the row; surface it as
// the following row's pre instead of discarding it.
func TestFamilyBBB1JPMorganCoverRowSwallowsHeading(t *testing.T) {
	rows := familyBBB1Dispatch(t, "jpm_cover_row_unclosed.txt", "", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000004187" {
			t.Errorf("JPMorgan Realty Income Fund heading swallowed by the unterminated cover row: fund=%q issuer=%q item=%q series=%q want S000004187", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000125/1257927/0001104659-08-055612.txt: 14-15, 17-18, 25-26, 49-50, 51-60,
// 81-90, 111-115, 119-121, 558-706, 781-1076. The Weitz Funds' 2008 N-PX
// declares six series and prints the fund not as a section heading but as the
// LEADING COLUMN of the vote table, under a two-line header cell
// `WEITZ` / `FUND&nbsp;NAME`. The value is printed once per issuer block and
// left blank on every continuation row:
//
//	 <td width="6%" valign="top" bgcolor="#CCEEFF" ...>
//	  <p style="margin:0in 0in .0001pt;"><font size="1" ...>BALANCED</font></p>
//	 </td>
//	...
//	 <td width="6%" valign="top" bgcolor="#CCEEFF" ...>
//	  <p style="margin:0in 0in .0001pt;"><font size="1" ...>&nbsp;</font></p>
//	 </td>
//
// `BALANCED` resolves to S000003482 (`Balanced Fund`) on the row that prints it,
// and the next row -- the same issuer's proposal 2 -- carries the blank cell and
// loses both fund_name and series_id, even though issuer_name and cusip ARE
// carried across it. 441 of the filing's 616 rows are such continuation rows.
//
// Fix in parseHTMLTableRaw (layout_htmltable.go:99), at the fundCol read near
// layout_htmltable.go:298: a blank fund column on a row whose issuer is carried
// is a repeat of the fund above it, not a new nameless fund -- carry curFund and
// curSeries rather than clearing them.
func TestFamilyBBB1WeitzFundColumnBlankContinuation(t *testing.T) {
	rows := familyBBB1Dispatch(t, "weitz_fund_column_blank_continuation.txt", "", "htmltable", 2)
	for _, r := range rows {
		if r.SeriesID != "S000003482" {
			t.Errorf("blank fund column on a continuation row: fund=%q issuer=%q item=%q series=%q want S000003482", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000088/887589/0000891804-04-001821.txt: 14-15, 17-18, 25-26, 47-49, 53,
// 1502-1519. Credit Suisse Institutional Fund Inc's 2004 N-PX declares no series
// and is backed by the dictionary's seven names for CIK 887589. Every section
// carries an equals-rule heading and four of them resolve; this one does not:
//
//	============================= HARBINGER PORTFOLIO ==============================
//
//	ACCREDO HEALTH, INC.
//
//	Ticker:       ACDO           Security ID:  00437V104
//
// The dictionary's only name for S000011315 is `Harbinger Portolio` -- the SEC's
// own misspelling of `Portfolio`, carried verbatim into cik_series.tsv. The
// heading and the dictionary name differ by one dropped letter in the TYPE word;
// the distinctive token `Harbinger` is owned by exactly one series of this CIK
// and by no other name in the dictionary, so the type word is the whole of the
// difference. 242 rows leave series_id blank.
func TestFamilyBBB1HarbingerDictionaryTypo(t *testing.T) {
	rows := familyBBB1Dispatch(t, "harbinger_dict_typo.txt", "harbinger_dict.tsv", "issnpx", 4)
	for _, r := range rows {
		if r.SeriesID != "S000011315" {
			t.Errorf("Harbinger Portfolio vs dictionary `Harbinger Portolio`: fund=%q issuer=%q item=%q series=%q want S000011315", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
