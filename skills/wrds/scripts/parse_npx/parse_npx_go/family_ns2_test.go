package main

import (
	"path/filepath"
	"testing"
)

// familyNS2Dispatch runs the real dispatch on a family NS2 fixture, loading the
// registrant's own cik_series.tsv rows as the dictionary when one is named. The
// 2004 filings of this family declare NO series in the SGML header, so the
// dictionary is the only index a fund heading can resolve against; the 2010 and
// 2017 filings declare their own and name no dictionary.
func familyNS2Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns2", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns2", fixture), sink, make([]byte, headBytes))
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

// 000075/756913/0001206774-04-001363.txt: 11-28, 54-60, 121-126, 26549-26575,
// 278105-278109. Manufacturers Investment Trust, 2004, layout `agenda`. The
// sibling -001273.txt is the same shape; together they are 111,535 of the pool's
// no-series rows, and CIK 756913 contributes 117,383 over 29 filings.
//
// Batch 74 taught parseAgenda to adopt the ONE-cell coded banner this vendor
// prints at the top of each page (`2A01 MIT Emerging Small Company Trust`) and
// guarded the banner branch against a proposal row the vote reader declined --
// but the guard is `blockSeen && icrItem(cells[0])`, which only refuses a line
// that CARRIES an item number. On binary 213 the rows of these two filings are
// still no-series, and the fund names they carry are director names:
//
//	3578 "ROBIN S. CALLAHAN"      3398 "SHELDON B. LUBAR"
//	3569 "ADOPT THE FOLLOWING RESOLUTION:"  3213 "ANDREW COOK*"
//
// The shape is a TRUNCATED vote row. On a contested or consent ballot this
// vendor prints the Type column and stops -- no Vote cell, no
// For/Against-Management cell -- and only the first proposal of a slate carries
// an item number, verbatim (lines 26556-26558):
//
//	01     DONALD G. CALDER                                                Mgmt
//	       ROBIN S. CALLAHAN                                               Mgmt
//	       ERIBERTO R. SCOCIMARA                                           Mgmt
//
// agVoteRow refuses all three (n=3 and n=2, both below its `n < 4` floor). The
// first is refused again by the batch-74 guard because `01` is an item number.
// The other two carry NO item number, so the guard passes them, `banner` is true
// on `len(cells) >= 2`, and `heading` becomes `ERIBERTO R. SCOCIMARA`. The rule
// that opens the next issuer's block adopts it as the fund, and every row below
// it on the page is filed under a director's name with no series. This filing
// prints 3,954 such three-cell rows and their unnumbered continuations.
//
// The banner the page opened with resolves: measured on this filing's own index
// after cikDict.back, icrResolveFundShared returns S000008227 for
// `2A01 MIT Emerging Small Company Trust`. Over all 82 banners of the filing,
// weighting each by the vote lines beneath it, 75,399 of 78,054 (96.6%) return
// an id through the same icrResolveFundShared/htmlDictionaryFund chain the
// layout already calls; a strict exact dictionary match after stripping the
// account code reaches 59,559 (76.3%).
//
// Fix in layout_agenda.go, parseAgenda's banner branch (the `banner :=` /
// `if !isVote && banner && !(blockSeen && icrItem(cells[0]))` pair): while a
// block is open, a line that NAMES THE TYPE COLUMN is part of that block's
// table whatever its cell count -- refuse a candidate whose last cell is an
// agProponent, not only one whose first cell is an icrItem. A proposal row the
// vote reader declined must never be promoted to a fund heading.
func TestFamilyNS2ManufacturersTruncatedVoteRowBecomesTheFundBanner(t *testing.T) {
	rows := familyNS2Dispatch(t, "mit_truncated_vote_row_banner.txt", "manufacturers_dict.tsv", "agenda", 3)
	for _, r := range rows {
		if r.SeriesID != "S000008227" {
			t.Errorf("a truncated `Mgmt` proposal row was adopted as the fund banner: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000008227", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000108/1081400/0001081400-10-000095.txt: 11-15, 22-26, 50-55, 129-133,
// 158-162, 412-422, 34666-34668, 34672-34673, 34677-34678, 34680-34681,
// 34688-34689, 34698-34700, 70714-70721. Wells Fargo Funds Trust, 2010, layout
// `labelvalue`. The sibling 000108/1081402/0001081400-10-000103.txt (Wells Fargo
// Variable Trust) is the same shape.
//
// The header declares the fund, verbatim (lines 132-133):
//
//	<SERIES-ID>S000007344
//	<SERIES-NAME>Opportunity Fund
//
// and the dictionary for CIK 0001081400 carries `Wells Fargo Advantage
// Opportunity Fund` as an alias of the same id. The body prints the fund banner
// inside an HTML div, with the service mark ESCAPED in the source, verbatim
// (lines 34666-34668):
//
//	    <div ...><font ...>=============
//	Wells Fargo Advantage Opportunity Fund&lt;sup&gt;SM&lt;/sup&gt;
//	==============</font></div>
//
// The layout reads the banner and then unescapes the entities, so the markup
// itself lands in fund_name: a full-file dispatch emits 8,877 rows of which
// 2,767 are blank, and every blank one carries a fund name ending in
// `<sup>SM</sup>`:
//
//	874 "Wells Fargo Advantage Mid Cap Disciplined Fund"
//	839 "Wells Fargo Advantage Opportunity Fund<sup>SM</sup>"
//	547 "Wells Fargo Advantage Discovery Fund<sup>SM</sup>"
//	507 "Wells Fargo Advantage Enterprise Fund<sup>SM</sup>"
//
// With the markup removed the same chain the layout already calls resolves all
// three: icrResolveFundShared returns S000007344 for `Wells Fargo Advantage
// Opportunity Fund`, S000007345 for `... Discovery Fund` and S000007346 for
// `... Enterprise Fund`, and on the Variable Trust sibling S000007227 and
// S000007218 for the `VT` spellings. Rows reached: 1,893 in this filing plus
// 1,385 in 000108/1081402/0001081400-10-000103.txt = 3,278 pool rows. (The
// 874-row `Mid Cap Disciplined Fund` heading carries no markup and is a separate
// floor -- the dictionary holds `Mid Cap Disciplined Fund` but no
// `Wells Fargo Advantage` alias of it.)
//
// Fix in the HTML text path the labelvalue layout feeds from -- stripHTML /
// htmlUnescape in layout_htmltable.go, or the heading normaliser
// normalizeSeriesName in header.go: a tag that survives entity decoding is
// markup, not part of the name, and must be stripped from a fund heading before
// it is handed to the resolver. Stripping it in stripHTML is wrong for a filing
// whose escaped angle brackets are content, so the narrow fix is in the fund
// heading candidate only.
func TestFamilyNS2WellsFargoSupMarkupSurvivesIntoTheFundName(t *testing.T) {
	rows := familyNS2Dispatch(t, "wf_sup_markup_fund_heading.txt", "", "labelvalue", 1)
	for _, r := range rows {
		if r.SeriesID != "S000007344" {
			t.Errorf("escaped <sup> markup survived into the fund name: fund=%q issuer=%q item=%q desc=%.40q series=%q want S000007344", r.FundName, r.IssuerName, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000093/934563/0001193125-17-270540.txt: 12-16, 51-52, 98-101, 203-206,
// 382-391, 445716-445726, 445763-445774, 445811-445822, 1135139-1135141.
// HC Capital Trust, 2017, layout `splittable` -- one of the family's 10 pool
// filings (38K rows; this one contributes 10,627).
//
// The ISS institutional-account report names the account across four physical
// lines of the left column, and splittable reassembles them correctly:
//
//	HC Capital Trust - The Small
//	Capitalization Equity
//	Portfolio (Russell 2000
//	Passive Growth Sleeve)          unassigned    Outerwall Inc.   OUTR  USA ...
//
// The reassembled name is
// `HC Capital Trust - The Small Capitalization Equity Portfolio (Russell 2000
// Passive Growth Sleeve)`. The trailing parenthetical is the SLEEVE -- the
// mandate inside the portfolio that the sub-adviser runs -- not part of the
// series name. The series is the portfolio, and the dictionary for CIK
// 0000934563 carries it verbatim:
//
//	0000934563	S000009380	The Small Capitalization Equity Portfolio
//
// while the header of this filing declares the same id under its later spelling,
// `The Small Capitalization - Mid Capitalization Equity Portfolio`.
//
// A full-file dispatch emits 73,348 rows of which 23,511 are blank, and the
// parenthetical sleeve headings are the mass of them:
//
//	8143 "HC Capital Trust - The Small Capitalization Equity Portfolio (Russell 2000 Passive Growth Sleeve)"
//	4586 "HC Capital Trust The ESG Growth Portfolio EAFE Quality Yield"
//	5154 "HC Capital Trust Large Cap Traditional Value Portfolio"
//
// With the parenthetical dropped, `HC Capital Trust - The Small Capitalization
// Equity Portfolio` resolves to S000009380 through htmlDictionaryFund on this
// filing's own index -- measured, and exact, not a walk. Rows reached: 8,143 in
// this filing. (`... The ESG Growth Portfolio EAFE Quality Yield` needs the same
// treatment for a sleeve printed WITHOUT parentheses and is not asserted here;
// `Large Cap Traditional Value Portfolio` matches no dictionary name at all and
// is a floor.)
//
// The fixture declares TWO series on purpose. With one, the chassis stamps the
// filing single-series and the defect is hidden; the second,
// `The Institutional Small Capitalization - Mid Capitalization Equity Portfolio`
// (S000022549), is also the name whose presence the fix has to stay clear of.
//
// Fix in layout_splittable.go, spIndex.resolve (the memoised
// icrResolveFundShared / htmlDictionaryFund pair batch 74 installed): when the
// verbatim account name resolves to nothing and the name ends in a balanced
// parenthetical, retry once with the parenthetical removed, and accept the
// answer only when that retry resolves EXACTLY. The `resolved` memo already in
// place carries the retry at no per-row cost.
func TestFamilyNS2HCCapitalSleeveParentheticalRefusesTheAccountName(t *testing.T) {
	rows := familyNS2Dispatch(t, "hc_sleeve_parenthetical_account.txt", "hc_capital_dict.tsv", "splittable", 1)
	for _, r := range rows {
		if r.SeriesID != "S000009380" {
			t.Errorf("a trailing sleeve parenthetical refused the account name: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000009380", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
