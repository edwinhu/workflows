package main

import (
	"path/filepath"
	"testing"
)

// familyNSNEWDispatch runs the real dispatch on a family NSNEW fixture, loading
// the registrant's own cik_series.tsv rows as the dictionary when one is named.
// The 2004-2005 filings of this family declare NO series in the SGML header, so
// the dictionary is the only thing a fund heading can resolve against; the 2011
// filings declare their own and name no dictionary.
func familyNSNEWDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_nsnew", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_nsnew", fixture), sink, make([]byte, headBytes))
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

// 000075/756913/0001206774-04-001363.txt: 11-28, 54-60, 121-137, 278105-278109.
// Manufacturers Investment Trust declares NO series in the SGML header of this
// 2004 filing, so cik_series.tsv for CIK 0000756913 is the whole index, and it
// carries the declared name this filing's headings reach, verbatim:
//
//	0000756913	S000008227	Emerging Small Company Trust
//
// The filing opens each fund's section with a banner at column 0, one text run,
// verbatim (line 123):
//
//	<TABLE>
//	<S>    <C>                                                            <C>        <C>        <C>
//	2A01 MIT Emerging Small Company Trust
//
//	- ------------------------------------------------------------------------------
//	ABX AIR, INC.                                                                  Agenda: 932135038
//
// and prints NINETY such banners, `2A02 Quantitative Equity Trust`,
// `2C25 MIT Blue Chip Growth Trust`, one per fund per page. parseAgenda adopts a
// banner only from `A two-cell line carrying no label` (layout_agenda.go:204-207):
// the Royce template this layout was written from prints the fund on the left and
// the registrant on the right of ONE line, two cells. This vendor prints a SINGLE
// cell -- the account code `2A01` is separated from the name by one space, which
// icrCells does not split on -- so `len(cells) >= 2` is false and the banner is
// never taken. A full-file dispatch emits 55,892 rows of which 55,887 carry a
// blank series_id, and the fund_name they carry is the junk the fall-through
// leaves behind: `03` on 14,000 rows, `(Address of principal executive offices)`
// on the first five. (In the fixture, which cuts the cover page out, the junk
// the fall-through leaves is the SGML header's own `FISCAL YEAR END:` line --
// the same branch, the nearest two-cell line above the table.)
//
// The name itself resolves: measured on this filing's own index,
// icrResolveFundShared returns S000008227 for `2A01 MIT Emerging Small Company
// Trust` verbatim, for `MIT Emerging Small Company Trust` and for `Emerging Small
// Company Trust` -- the leading-token walk in icrResolveFund already reaches it.
// Nothing new has to resolve; the string simply has to be handed over.
//
// Fix in layout_agenda.go, parseAgenda's banner branch: a ONE-cell line that is
// not a vote row, not an identity pair and not a rule is a banner candidate too,
// and the `len(cells) >= 2` test should be `len(cells) >= 1`. The rule that
// adopts it at the next dashed rule, and icrResolveFundShared/htmlDictionaryFund
// that resolve it, are already in place and unchanged.
func TestFamilyNSNEWManufacturersOneCellCodedBannerNeverRead(t *testing.T) {
	rows := familyNSNEWDispatch(t, "mit_coded_one_cell_banner.txt", "manufacturers_dict.tsv", "agenda", 2)
	for _, r := range rows {
		if r.SeriesID != "S000008227" {
			t.Errorf("one-cell banner `2A01 MIT Emerging Small Company Trust` never adopted: fund=%q issuer=%q cusip=%q desc=%.40q series=%q want S000008227", r.FundName, r.IssuerName, r.CUSIP, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000071/710826/0001206774-04-001312.txt: 11-28, 51-57, 121-124, 206-236,
// 175778-175782. Metropolitan Series Fund declares NO series in the SGML header
// of this 2004 filing either, and cik_series.tsv for CIK 0000710826 carries the
// name its first banner reaches, verbatim:
//
//	0000710826	S000006536	Capital Guardian U.S. Equity Portfolio
//
// This filing DOES print the two-cell banner parseAgenda expects (line 123),
// verbatim:
//
//	Capital Guardian US Equity Portfolio                                                         0000710826
//
// and the layout reads it: the first row of a full-file dispatch comes out
// fund=`Capital Guardian US Equity Portfolio` series=`S000006536`. 32,583 of the
// filing's 33,230 rows are nevertheless blank, because the banner is DESTROYED
// part-way down the first fund's section and never recovers.
//
// The destroyer is a shareholder proposal. agProponents (layout_agenda.go:37) is
// the closed vocabulary `MGMT SHLDR MANAGEMENT SHAREHOLDER SHRHLDR ISSUER`; this
// vendor spells the shareholder proponent `Shr`, which is in none of them, and
// prints 2,767 such rows in this filing (4,980 in the Manufacturers one),
// verbatim:
//
//	02     PROPOSAL TO RATIFY THE APPOINTMENT OF                          Mgmt          For           For
//	       KPMG LLP AS INDEPENDENT AUDITOR.
//
//	<PAGE>
//
//	03     PROPOSAL RELATING TO THE ADOPTION OF A                          Shr          For         Against
//
// agVoteRow refuses that row, and the refusal FALLS THROUGH to the banner branch,
// which accepts any multi-cell line: `heading` becomes `03`, the next dashed rule
// adopts it as the fund, and every block below the first shareholder proposal is
// filed under the fund name `03` with no series. The census shows exactly that --
// `03` on 8,821 rows, `04` on 6,177, `02` on 5,169 -- and the 88 rows of this
// filing whose For/Against-Management cell is empty (`Mgmt   No Action`, four
// cells) leak through the same branch.
//
// Fix in layout_agenda.go, two parts and both in the same function:
// add `SHR` to agProponents so the shareholder rows are read as votes at all,
// and make parseAgenda's banner branch refuse a line whose FIRST cell is an item
// number while a block is open -- a proposal row the vote reader declines must be
// dropped, never promoted to a fund heading. The fund of a section may only be
// replaced by a line that is not part of that section's table.
func TestFamilyNSNEWMetLifeShrProposalRowBecomesTheFundBanner(t *testing.T) {
	rows := familyNSNEWDispatch(t, "metlife_shr_row_becomes_banner.txt", "metlife_dict.tsv", "agenda", 6)
	for _, r := range rows {
		if r.SeriesID != "S000006536" {
			t.Errorf("a `Shr` proposal row was adopted as the fund banner: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000006536", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000081/811869/0000811869-04-000076.txt: 11-28, 52-61, 717-737, 92806-92810.
// Thrivent Mutual Funds declares NO series in the SGML header of this 2004
// filing; cik_series.tsv for CIK 0000811869 carries, verbatim:
//
//	0000811869	S000001359	Thrivent Technology Fund
//
// The votesummary layout reads the fund banner correctly and writes it onto every
// row. A full-file dispatch emits 29,476 rows, ALL of them carrying
// fund_name=`THRIVENT TECHNOLOGY FUND` and ALL of them carrying a blank
// series_id. The banner is printed as the last text line above the stacked column
// header, verbatim:
//
//	                                              Vote Summary Report
//	                                          Jul 01, 2003 - Sep 30, 2003
//
//	THRIVENT TECHNOLOGY FUND
//
//	Mtg              Company/                                     Mgmt       Vote        Record              Shares
//	Date/Type        Ballot Issues                     Security   Rec        Cast        Date                 Voted
//
// and `THRIVENT TECHNOLOGY FUND` normalises onto the dictionary name EXACTLY.
//
// The reason nothing is stamped is that layout_votesummary.go NEVER CONSULTS THE
// SERIES INDEX AT ALL. Every other text layout builds one -- layout_agenda.go:111,
// layout_proxyedge.go:220, layout_twoband.go:118, layout_labelvalue.go:205,
// layout_pvtext.go:1099, layout_htmltable.go:103 all call newISSSeriesIndex and
// then icrResolveFundShared/htmlDictionaryFund -- and parseVoteSummaryRaw sets
// VoteRow.FundName and stops. The chassis cannot cover for it: main.go:425 builds
// dictFallback from the dictionary entries the header does NOT declare, and
// cikDict.back (main.go:335) has already moved the whole dictionary INTO
// meta.SeriesDecls for a header that declares none, so `extra` is empty,
// exactFallback returns nil and dictFallback.apply is a no-op for exactly the
// 2004-2005 filings this layout serves.
//
// Rows reached: 114,206 of the 182,332 no-series rows this layout contributes to
// the pool, measured by resolving each filing's own blank fund names against its
// own index (43 pool filings). The remainder is the Principal Variable Contracts
// floor recorded in the report.
//
// Fix in layout_votesummary.go, parseVoteSummaryRaw: build
// `newISSSeriesIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName))`
// plus `cikDict.exactFallback(meta)` once at the head, resolve each new `fund`
// banner through icrResolveFundShared and then htmlDictionaryFund, and carry the
// resulting id onto every row of that section -- the same four lines
// layout_agenda.go:111-113,140-143 already runs.
func TestFamilyNSNEWThriventVoteSummaryNeverResolvesItsBanner(t *testing.T) {
	rows := familyNSNEWDispatch(t, "thrivent_votesummary_banner.txt", "thrivent_dict.tsv", "votesummary", 2)
	for _, r := range rows {
		if r.SeriesID != "S000001359" {
			t.Errorf("votesummary read the banner but never resolved it: fund=%q issuer=%q cusip=%q item=%q series=%q want S000001359", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000106/1064642/0000950123-11-081354.txt: 1-9, 14-16, 48-69, 837-845, 884-910,
// 170567-170571. SPDR Series Trust declares 82 series in the SGML header of this
// 2011 filing, among them, verbatim:
//
//	<SERIES-ID>S000006973
//	<SERIES-NAME>SPDR(R) Dow Jones Total Market ETF
//
// The splittable layout reads the ISS institutional-account report's identity
// block and takes the fund from it, verbatim:
//
//	SPDR DOW JONES TOTAL MARKET ETF (FORMERLY SPDR DJ WILSHIRE TOTAL MARKET ETF)
//
//	--------------------------------------------------------------------------------
//	SPECTRUM PHARMACEUTICALS, INC.
//
//	Institutional Account Name: SPDR DJ Wilshire Total Market ETF
//
// -- the account name is the fund's FORMER spelling, which the page banner above
// it names as such. A full-file dispatch emits 60,525 rows of which 11,737 carry
// a blank series_id, 10,920 of them under this one heading.
//
// The heading resolves. Measured on this filing's own header decls,
// icrResolveFundShared returns S000006973 for `SPDR DJ Wilshire Total Market ETF`
// verbatim. What splittable uses instead is the BARE resolver:
// layout_splittable.go:163 builds `seriesByName(meta.SeriesDecls)` and line 621
// calls `icrResolveFund` on it, which is exact-plus-leading-token-walk and
// nothing else -- no newISSSeriesIndex, no issResolveFund rule chain, no
// htmlDictionaryFund. `icrResolveFund` on that map returns "" for this heading
// and for `SPSR S&P Emerging Markets ETF` (7,919 rows, CIK 1168164) and
// `SDPR S&P International Materials Sector ETF` (1,442 rows), all of which
// icrResolveFundShared resolves.
//
// Rows reached: 23,048 of the 25,540 no-series rows splittable contributes to the
// pool (5 filings).
//
// Fix in layout_splittable.go: replace the `seriesIdx = seriesByName(...)` /
// `icrResolveFund(seriesIdx, row.FundName)` pair (lines 163 and 618-624) with
// `newISSSeriesIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName))` +
// `icrResolveFundShared`, falling back to `htmlDictionaryFund` with
// `cikDict.exactFallback(meta)`; keep the existing `resolved` memo, which is what
// keeps the per-row cost flat.
func TestFamilyNSNEWSPDRSplitTableUsesBareResolverOnly(t *testing.T) {
	rows := familyNSNEWDispatch(t, "spdr_institutional_account_name.txt", "", "splittable", 6)
	for _, r := range rows {
		if r.SeriesID != "S000006973" {
			t.Errorf("splittable resolved the account name through the bare index only: fund=%q issuer=%q cusip=%q item=%q series=%q want S000006973", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.SeriesID)
		}
	}
}
