package main

import (
	"path/filepath"
	"testing"
)

// familyKKK2Dispatch runs the real dispatch on a family KKK no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when one
// is named.
func familyKKK2Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_kkk2", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_kkk2", fixture), sink, make([]byte, headBytes))
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

// 000022/225930/0000225930-04-000028.txt: 11-32, 54-60, 104-120, 10703-10735.
// Templeton Funds Inc (CIK 225930) files this 2004 N-PX/A, which EDGAR carries
// with no series tags, so the resolver sees cik_series.tsv, three ids:
//
//	0000225930	S000008745	Templeton World Fund
//	0000225930	S000008746	Templeton Foreign Fund
//	0000225930	S000062009	Templeton International Climate Change Fund
//
// A full-file dispatch emits 3749 rows across three headings. The last 20 sit
// under a heading naming a fund the registrant never declared, introduced by a
// banner that says what happened to it, verbatim:
//
//	VOTES BY VICTORY INTERNATIONAL FUND PRIOR TO THE REORGANIZATION WITH TEMPLETON
//	FOREIGN FUND EFFECTIVE OCTOBER 24, 2003.
//
//	=========================== VICTORY INTERNATIONAL FUND ========================
//
//
//	BHP BILLITON LTD
//
//	Ticker:                      Security ID:  Q1498M100   ISIN: AU00000BHP4
//	Meeting Date: 13-NOV-03      Meeting Type: AGM
//
// `Victory International Fund` is a merged-away predecessor: it has no series
// id of its own under this CIK and never will, so resolving the HEADING is a
// floor. The filing is not silent about the attribution, though -- the banner
// prints the SURVIVING fund by name, and `TEMPLETON FOREIGN FUND` is a declared
// dictionary name mapping to S000008746, the same id the parser already stamps
// on the 2271 rows under that fund's own heading earlier in the file. These 20
// votes were cast by the assets that became S000008746 and the document says so
// in the two lines above the heading.
//
// The production census counts these 20 rows as no-series. On the full file the
// parser is worse than blank: the heading fuzz-matches `Templeton International
// Climate Change Fund` and all 20 rows come out S000062009 -- a fund that did
// not exist in 2004. On this cut nothing matches and the row is blank. Either
// way the successor id printed on the page is never read.
//
// Fix in layout_issnpx.go, in issResolveFund and the section-heading scan that
// feeds it: when the lines immediately preceding a section heading match
// `VOTES BY <X> PRIOR TO THE REORGANIZATION WITH <Y>` and the heading is <X>,
// resolve the section to <Y> -- the successor -- rather than to <X>, and never
// fall through to a fuzzy match on <X>. The banner is a two-line construction
// (`WITH` ends line one here), so the scan has to join the wrapped lines before
// matching. Three of the six family KKK filings carry this exact banner
// (225930, 809707, 38721), which is where their whole no-series residue lives.
func TestFamilyKKK2VictoryReorganizationBannerSuccessorNeverRead(t *testing.T) {
	rows := familyKKK2Dispatch(t, "templeton_victory_reorg.txt", "templeton_funds_dict.tsv", "issnpx", 3)
	for _, r := range rows {
		if r.FundName != "VICTORY INTERNATIONAL FUND" {
			continue
		}
		if r.SeriesID != "S000008746" {
			t.Errorf("reorganization banner successor `TEMPLETON FOREIGN FUND` never read: fund=%q issuer=%q cusip=%q series=%q want S000008746", r.FundName, r.IssuerName, r.CUSIP, r.SeriesID)
		}
	}
}

// 000003/38721/0000038778-06-000030.txt: 11-16, 25-26, 49-54, 73-74, 103-104,
// 138-139, 168-169, 196-204, 7291-7318. Franklin Custodian Funds Inc declares
// FIVE series in the SGML header of this 2006 filing, so the chassis stamps
// nothing and the layout must resolve each section heading:
//
//	<SERIES-ID>S000006756
//	<SERIES-NAME>FRANKLIN INCOME FUND
//
// A full-file dispatch emits 3101 rows; the last 18 carry the same
// reorganization banner as the Templeton filing, verbatim:
//
//	VOTES BY FRANKLIN MULTI-INCOME TRUST PRIOR TO THE REORGANIZATION WITH
//	FRANKLIN INCOME FUND A SERIES OF FRANKLIN CUSTODIAN FUNDS, INC. EFFECTIVE
//	AUGUST 4, 2005
//
//	========================= FRANKLIN MULTI-INCOME TRUST ==========================
//
// Here the banner is explicit that the successor is a series OF THIS
// REGISTRANT -- `A SERIES OF FRANKLIN CUSTODIAN FUNDS, INC.` -- and
// `FRANKLIN INCOME FUND` is declared in this filing's own header as
// S000006756. On the full file the parser instead stamps all 18 rows
// S000006757, `FRANKLIN U.S. GOVERNMENT SECURITIES FUND`, a sibling the banner
// does not mention; on this cut the heading resolves to nothing and the rows
// come out blank. The declared successor is read in neither case.
//
// Same fix and same site as
// TestFamilyKKK2VictoryReorganizationBannerSuccessorNeverRead: this filing is
// the second witness, and it shows the successor clause can run past the fund
// name into `A SERIES OF <registrant>` before the effective date, so the
// extracted <Y> must stop at that boundary rather than swallow the trust name.
func TestFamilyKKK2FranklinMultiIncomeReorganizationBanner(t *testing.T) {
	rows := familyKKK2Dispatch(t, "franklin_multi_income_reorg.txt", "", "issnpx", 10)
	for _, r := range rows {
		if r.FundName != "FRANKLIN MULTI-INCOME TRUST" {
			continue
		}
		if r.SeriesID != "S000006756" {
			t.Errorf("reorganization banner successor `FRANKLIN INCOME FUND` never read: fund=%q issuer=%q cusip=%q series=%q want S000006756", r.FundName, r.IssuerName, r.CUSIP, r.SeriesID)
		}
	}
}

// 000070/703642/0000088053-16-001869.txt: 11-16, 50-76, 79-87, 142-178. DWS
// Money Market Trust declares TWO series in the SGML header of this 2016
// filing, and the second is a superstring of the first plus a class word:
//
//	<SERIES-ID>S000032033
//	<SERIES-NAME>NY Tax Free Money Fund
//	<CLASS-CONTRACT-NAME>Investment Class
//	...
//	<SERIES-ID>S000032034
//	<SERIES-NAME>Tax Free Money Fund Investment
//
// The whole filing is 16 rows and ALL 16 are no-series. It prints two section
// headings, each carrying a leading one-letter fund CODE inside the equals
// rule, verbatim:
//
//	===================== L     Tax Free Money Fund Investment =====================
//
//	=================== M     NY Tax Free Money Fund Investment ====================
//
// The `L` section is a no-activity notice and emits nothing. Every row of the
// filing sits under `M`, whose heading is the declared name `NY Tax Free Money
// Fund` with the class word `Investment` appended -- and with the code letter
// left in, the parser carries the whole string through as the fund name,
// verbatim in the emitted rows:
//
//	fund_name = "M  NY Tax Free Money Fund Investment"
//
// so nothing resolves. The votes corroborate S000032033 rather than the
// sibling: they are BlackRock NEW YORK municipal closed-end funds
// (`BLACKROCK MUNI NEW YORK INTERMEDIATE DURATION FUND, INC.`, security id
// 09255F307), which the NY fund holds and the non-NY sibling does not.
//
// Fix in layout_issnpx.go, in the equals-rule heading normaliser that runs
// before issResolveFund: strip a leading single-letter (or short all-caps)
// column code followed by run-of-spaces from a centred `==== ... ====` heading,
// and then, when the remainder matches no declared name outright, retry with a
// trailing CLASS-CONTRACT-NAME word removed -- `Investment` is the class name
// `Investment Class` under S000032033, not part of the series name. The
// sibling-collision guard must not refuse here: `NY Tax Free Money Fund
// Investment` is a strict superstring of one declared name and NOT of the
// other, since the other lacks the `NY`.
func TestFamilyKKK2DWSLetterCodeHeadingWithClassWord(t *testing.T) {
	rows := familyKKK2Dispatch(t, "dws_ny_tax_free_letter_code.txt", "", "issnpx", 11)
	for _, r := range rows {
		if r.SeriesID != "S000032033" {
			t.Errorf("letter-coded heading with a trailing class word never resolved: fund=%q issuer=%q cusip=%q series=%q want S000032033", r.FundName, r.IssuerName, r.CUSIP, r.SeriesID)
		}
	}
}
