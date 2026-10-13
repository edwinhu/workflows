package main

import (
	"path/filepath"
	"testing"
)

// familyNS13Dispatch runs the real dispatch on a family NS13 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS13Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns13", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns13", fixture), sink, make([]byte, headBytes))
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

// 000072/729528/0000729528-04-000014.txt: verbatim source lines 11-33, 43-56,
// 64-66, 80-86, 115-159 and the filing's own last four lines. Dispatches to
// `agenda` (the precondition asserts it).
//
// American Funds Insurance Series, 2004. 6,381 of 6,381 rows carry no series,
// and the fund_name emitted on every one of them is the REGISTRANT'S OWN CIK.
// The vendor prints the fund as a ruled banner and then right-aligns the CIK
// on the line beneath it, immediately above the block rule -- source lines
// 130-133 verbatim:
//
//	=========================================ASSET ALLOCATION FUND==================
//	                                                                     0000729528
//
//	- --------------------------------------------------------------------------------
//
// parseAgenda (layout_agenda.go:233) keeps the LAST unlabelled line before the
// rule as the page's banner, so the CIK line overwrites the banner the line
// above it.
//
// The banner resolves as printed -- rules and all. Measured through
// icrResolveFundShared on this filing's own index plus the registrant's 70
// dictionary rows:
//
//	"=========================================ASSET ALLOCATION FUND=================="  => S000008796
//	"ASSET ALLOCATION FUND"  => S000008796      "0000729528"                => ""
//	"BLUE CHIP INCOME AND GROWTH FUND" => S000008794   "BOND FUND"          => S000008797
//	"GROWTH FUND" => S000008791    "GLOBAL DISCOVERY FUND" => S000008783
//	"GROWTH-INCOME FUND" => S000008795   "GLOBAL GROWTH FUND" => S000008786
//	"HIGH-INCOME BOND FUND" => S000008787   "INTERNATIONAL FUND" => S000008792
//	"NEW WORLD FUND" => S000008793   "GLOBAL SMALL CAPITALIZATION FUND" => S000008790
//
// i.e. every one of the filing's eleven vote-bearing banners answers exactly;
// only the CIK line blocks them. Rows reached: all 6,381 of the measured
// filing (which is also its pool count); the family is 2 filings and 8,582
// pool rows.
//
// The dictionary fixture carries 44 series, so the answer is a lookup and not
// a single-series stamp.
//
// Fix in layout_agenda.go, parseAgenda at :225-235: a line whose whole content
// is a bare digit run -- the registrant's own CIK, which the vendor stamps as
// a page footer -- is never a fund banner, and must not displace the banner
// above it.
func TestFamilyNS13AmericanFundsCIKLineTakenForTheBanner(t *testing.T) {
	rows := familyNS13Dispatch(t, "american_funds_cik_line_taken_for_banner.txt", "american_funds_dict.tsv", "agenda", 18)
	for _, r := range rows {
		if r.SeriesID != "S000008796" {
			t.Errorf("the registrant's CIK line was taken for the fund banner: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000008796", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000076/764797/0000088053-05-000934.txt: verbatim source lines 11-30, 50-59,
// 65-78, 121-130 and 3028-3060, plus the filing's own last five lines.
// Dispatches to `splittable` (the precondition asserts it).
//
// Scudder Variable Series I, 2005. 4,400 of 4,400 rows carry no series, and
// the fund_name emitted on every one of them is the FIRST of the filing's NINE
// ProxyEdge accounts. The vendor opens each account with its own page header
// (source lines 125 and 3032, verbatim):
//
//	Selected Accounts: SVS I 21st Century Growth Port
//	Selected Accounts: SVS I Capital Growth Port
//
// but only the first sits inside the `<TABLE>` / `<CAPTION>` opener at source
// lines 128-129; the other eight are printed after a `<PAGE>` break inside the
// same table, and the layout never re-reads them. All nine accounts and all
// 4,400 rows therefore carry `SVS I 21st Century Growth Port`.
//
// Two of the nine names resolve against the registrant's 17 dictionary rows --
// measured through icrResolveFundShared on this filing's own index:
//
//	"SVS I Capital Growth Port"     => S000006245    "SVS I Money Market Portfolio" => S000006250
//	"SVS I 21st Century Growth Port" => ""           "SVS I Balanced Port"          => ""
//	"SVS I Bond Portfolio"          => ""            "SVS I Global Discovery Port"  => ""
//	"SVS I Growth and Income Port"  => ""            "SVS I Health Sciences Port"   => ""
//	"SVS I International Port"      => ""
//
// (the seven that stay blank are the abbreviated-ProxyEdge-name floor of NS11
// §2, a sub-floor inside this family; the Money Market section carries `NO
// PROXIES RECEIVED OR VOTED FOR THIS FUND` and no rows).
//
// Rows reached: the Capital Growth section is 207 of the filing's 1,059
// item-numbered lines, i.e. ~860 of its 4,400 rows; the family is 2 filings
// and 8,025 pool rows.
//
// Fix in layout_splittable.go / the ProxyEdge account reader it shares with
// layout_proxyedge.go: a `Selected Accounts:` line must re-open the account
// wherever it appears, not only in the block that opens the `<TABLE>`.
func TestFamilyNS13SVS1FirstAccountKeptForTheWholeTable(t *testing.T) {
	rows := familyNS13Dispatch(t, "svs1_first_account_kept_for_the_whole_table.txt", "svs1_dict.tsv", "splittable", 5)
	for _, r := range rows {
		if r.SeriesID != "S000006245" {
			t.Errorf("the first ProxyEdge account was kept for a later account's ballots: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000006245", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000089/898745/0000898745-09-000417.txt: verbatim source lines 11-26,
// 1421-1424, 1821-1824, 3337-3342, 3344-3349, 95596-95617, 95626-95649 and
// 95650-95692, plus the document and filing tails at 166718-166723 and the
// last three lines. Two `</SERIES>` lines and one `</TABLE>` line were
// inserted to close the blocks the line-range cuts opened -- the only bytes in
// the fixture that are not verbatim. The cut lands mid-ballot, so the emitted
// item/description columns are a truncation artifact; the assertion is on the
// series id. Dispatches to `htmltable` (the precondition asserts it).
//
// Principal Funds, Inc., 2009. 2,732 of 4,658 rows carry no series. The
// section's own title names the fund -- twice, each with an explicit date
// window -- and the vendor then prints a STALE label below it, which the
// layout adopts. Source lines 95603-95614, verbatim:
//
//	<P><B><FONT face=Arial size=3>Principal Funds, Inc. - SmallCap Value Fund II (05/01/09 through 06/30/09)</FONT></B></P>
//	<P><B><FONT face=Arial size=3>Principal Funds, Inc. - SmallCap Value Fund III (07/01/08 through 04/30/09)</FONT></B></P>
//	<P><B><FONT face=Arial size=3>Sub-Advisor:&nbsp; Los Angeles Capital Management and Equity Research, Inc.</FONT></B></P>
//	...
//	<TD align=left><B><FONT face=sans-serif size=1>Item 1: Proxy Voting Record - Principal Investors Fund, Inc. - Partners SmallCap</FONT></B>&nbsp;</TD>
//	...
//	<TD align=left><FONT face=sans-serif size=1>Fund Name : Principal Investors Fund, Inc. - Partners SmallCap</FONT>&nbsp;</TD>
//
// The two sibling sections in the same filing that DO resolve (source lines
// 3461 and 147952) carry the same Arial title and NO `Fund Name :` line.
// `Partners SmallCap` is a truncated pre-2008 brand that names no series: the
// registrant registered seven Partners SmallCap * funds, so it is ambiguous
// even as a stem. The titles resolve as printed -- measured through
// icrResolveFundShared on this filing's own index plus the registrant's 97
// pre-20090630 dictionary rows:
//
//	"Principal Funds, Inc. - SmallCap Value Fund III (07/01/08 through 04/30/09)" => S000007178
//	"Principal Funds, Inc. - SmallCap Value Fund II (05/01/09 through 06/30/09)"  => S000007169
//	"Principal Investors Fund, Inc. - Partners SmallCap" => ""    "Partners SmallCap" => ""
//
// The fixture's one ballot is 3Com, meeting 09/24/2008, which falls in the
// printed `07/01/08 through 04/30/09` window and so belongs to SmallCap Value
// Fund III.
//
// Rows reached: the section carries 60 ballots dated 2008 and 356 dated 2009,
// so all 2,732 blank rows are reachable once the title is read, split by the
// printed date windows (~390 to Fund III, ~2,340 to Fund II); the family is 7
// filings and 7,894 pool rows.
//
// Fix in layout_htmltable.go, in the section-heading reader: a `Fund Name :`
// label that resolves to nothing must not displace the section's own title
// block, and a title carrying a parenthetical date window selects by the row's
// meeting date.
func TestFamilyNS13PrincipalStaleFundNameLabelDisplacesTheTitle(t *testing.T) {
	rows := familyNS13Dispatch(t, "principal_stale_fund_name_label.txt", "principal_dict.tsv", "htmltable", 1)
	for _, r := range rows {
		if r.SeriesID != "S000007178" {
			t.Errorf("a stale vendor Fund Name label displaced the section's own title: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000007178", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
