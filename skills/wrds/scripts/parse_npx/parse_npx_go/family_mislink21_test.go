package main

import (
	"path/filepath"
	"testing"
)

// familyMislink21Dispatch runs the real dispatch on a family MISLINK21 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the fund banner and never a broken fixture.
func familyMislink21Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink21", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink21", fixture), sink, make([]byte, headBytes))
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

// 000081/813900/0000892569-08-001214.txt: verbatim source lines 1-2, 11-30,
// 51-56, 117-120, 189-191, 193-198, 236-252, 5469-5484, 5495-5497, and the
// filing's own last four lines minus the trailing
// `-----END PRIVACY-ENHANCED MESSAGE-----` (which, left in, is swallowed into
// the last wrapped proposal by the line-range cut and would make the fixture
// rather than the parser the thing under test). Every byte is a cut of the
// source. Dispatches to `issnpx` (the precondition asserts it).
//
// THE TWO EARLIER SECTIONS ARE LOad-BEARING. Source lines 244-252 carry the two
// `AMERICAN FUNDS GROWTH ...` feeder-portfolio sections that print no votes.
// Cut them out and the banner resolves correctly (`S000007766`, class
// `C000021137`, fund name `Pacific Select Fund EMERGING MARKETS PORTFOLIO`);
// leave them in and it resolves to `S000036460`. Measured by growing the cut a
// section at a time.
//
// PACIFIC SELECT FUND, CIK 813900, period 20080630, layout `issnpx`, 39,262
// rows in the flagged group. The registrant is a two-tier trust: its SGML
// header declares exactly ONE series, `S000007766 Pacific Select Fund
// (811-05141)`, and hangs all 33 portfolios off it as CLASS CONTRACTS. So the
// 22 distinct portfolio banners under one series id that the corpus-wide
// detector flags are, for 21 of them, exactly what the bytes name -- not a
// mislink. The 22nd is.
//
// THE BYTES. Source line 5473, the banner, verbatim:
//
//	========================== EMERGING MARKETS PORTFOLIO ==========================
//
// and source lines 118-119, the filing's OWN class-contract declaration,
// verbatim:
//
//	<CLASS-CONTRACT-ID>C000021137
//	<CLASS-CONTRACT-NAME>Emerging Markets Portfolio
//
// The banner and that declaration are the same name character for character
// once case is folded. The parser stamps neither the declared series nor blank:
// it stamps `S000036460`, whose only spelling anywhere is the dictionary row
//
//	0000813900	S000036460	Emerging Markets Debt Portfolio	20120630
//
// -- a DIFFERENT fund of the same registrant, declared four years after this
// period, and a name the bytes of this filing never print. 1,783 rows.
//
// WHY IT IS THE DEFECT AND NOT A JUDGEMENT CALL. The dictionary fixture holds
// two rows and the answer flips on which of them is present. With only the
// EXACT row `S000026009 Emerging Markets Portfolio` loaded, the row comes out
// `S000007766` -- the filing's own declaration, which is what the bytes say.
// Add the INEXACT `S000036460 Emerging Markets Debt Portfolio` row and the
// answer becomes `S000036460`. An inexact dictionary name therefore outranks
// BOTH the filing's own exact class-contract declaration AND an exact
// same-CIK dictionary name. That ordering is the bug; it is the mirror of
// family MISLINK20, where an exact sibling lost to a same-CIK tolerance hit.
//
// Fix location: `layout_issnpx.go`, `issResolveFund` (`:2575`). The exactness
// test it already runs for the cross-CIK rung, `issBannerDeclaredExact`
// (`:2613`), must also gate the same-CIK dictionary fallback: a banner that
// exactly matches a declared CLASS-CONTRACT-NAME of the filing's own header
// resolves to that contract's series and no tolerance rung may overwrite it.
// The same precedence belongs at the tail of `dictFallback.apply`
// (`cik_series.go:411`) -- an exact same-CIK dictionary name must beat an
// inexact one before either is offered.
//
// This test asserts the row is NOT `S000036460`. A wrong series is worse than a
// blank one, so blank and the declared `S000007766` both pass; only the
// undeclared Debt Portfolio id fails.
func TestFamilyMislink21PacificSelectClassContractLosesToInexactDictName(t *testing.T) {
	rows := familyMislink21Dispatch(t, "pacific_select_emerging_markets.txt", "pacific_select_dict.tsv", "issnpx", 4)
	for _, r := range rows {
		if r.FundName != "EMERGING MARKETS PORTFOLIO" && r.FundName != "Pacific Select Fund EMERGING MARKETS PORTFOLIO" {
			t.Fatalf("fixture banner not read as printed: fund=%q", r.FundName)
		}
		if r.SeriesID != "" && r.SeriesID != "S000007766" {
			t.Errorf("a banner that exactly matches the filing's own declared CLASS-CONTRACT-NAME was stamped from an inexact dictionary name: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want \"\" or S000007766 (declared in this filing's header, class C000021137 `Emerging Markets Portfolio`); S000036460 is `Emerging Markets Debt Portfolio`, declared 20120630, and the bytes never print that name",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000132/1324443/0001324443-08-000067.txt: verbatim source lines 12-15, 17-18,
// 22-26, 63-64, 184-187, 200-201, 269-279, 1017753-1017755 and 558550-558655,
// then the filing's own last four lines minus the trailing
// `-----END PRIVACY-ENHANCED MESSAGE-----`. Every byte is a cut of the source.
// Dispatches to `htmltable` (the precondition asserts it).
//
// 142 LINES, NOT 80. This filing prints one table cell per source line -- four
// lines of `<TD>`/`<FONT>`/`&nbsp;`/`</TD>` per rendered column -- so ONE
// issuer identity block plus ONE proposal row is 106 verbatim source lines
// (558550-558655) and nothing shorter dispatches: cutting the block at 558630
// or 558645 drops the filing to `parse_status=skip`, signature
// `unknown:ticker:...`, measured. Sparse cuts inside the block that keep only
// the non-empty cells also fall back to `skip`. The floor is the layout's, not
// the fixture's.
//
// AMERICAN INDEPENDENCE FUNDS TRUST, CIK 1324443, period 20080630, layout
// `htmltable`, 23,462 rows in the flagged group here and 28,893 in the sibling
// filing 0001324443-08-000065.txt, which carries the identical shape.
//
// THE BYTES. Source line 1017755, the real fund banner, verbatim:
//
//	<FONT size=2 face="CourierNewPSMT,Courier New,Courier,monospace">========================= NESTEGG DOW JONES U.S. 2040 ==========================</FONT></P>
//
// and source lines 558552 and 558556, the issuer heading three lines later,
// verbatim:
//
//	<FONT size=2 face="CourierNewPSMT,Courier New,Courier,monospace">--------------------------------------------------------------------------------</FONT>
//	<FONT size=2 face="CourierNewPSMT,Courier New,Courier,monospace">ESSILOR INTERNATIONAL</FONT>&nbsp;
//
// followed immediately by that block's `Ticker:` / `Security ID: F31668100` /
// `Meeting Date:` / `Record Date:` rows. `ESSILOR INTERNATIONAL` is an ISSUER:
// it is the name on an identity block, the row's own `issuer_name` column
// carries it, and the filing goes on to vote its proposals. The parser
// nonetheless promotes it to the FUND banner and stamps `S000011459`, declared
// at source line 186-187 as
//
//	<SERIES-ID>S000011459
//	<SERIES-NAME>American Independence Funds International Equity Fund
//
// on the strength of the word the issuer and the fund happen to share. The same
// filing does it to `HERMES INTERNATIONAL` (8,955 rows) and to the proposal
// fragment `Equity Fund Raising` (1,794 rows), and 000076/763852 does it to
// eight REIT issuers under `JPMORGAN U.S. REAL ESTATE FUND`.
//
// WHY IT IS THE DEFECT. Run this fixture with NO dictionary loaded and the row
// comes out with `fund_name` and `series_id` both blank: the promotion is not a
// reading of the layout's own heading grammar, it is "this bare cell resolved
// to a series, therefore it is a banner". An identity block's own name line can
// never be a fund banner -- this is exactly the rule family MISLINK18 (commit
// e51d1a48) installed for `labelvalue`, and `htmltable` did not get it.
//
// Fix location: `layout_htmltable.go` -- the bare-cell banner candidate must be
// refused when the rows that follow it are that cell's own identity block
// (`Ticker:` / `Security ID:` / `Meeting Date:`), before any series resolution
// is attempted, mirroring the MISLINK18 refusal in `layout_labelvalue.go`.
// Resolution must never be what decides that a line is a heading.
//
// This test asserts the issuer name is not the fund name and its series is not
// stamped on the row. A wrong banner is worse than a blank one, so blank passes
// and so does the enclosing `NESTEGG DOW JONES U.S. 2040`; only the issuer's
// own name fails.
func TestFamilyMislink21AmIndIssuerNamePromotedToFundBanner(t *testing.T) {
	rows := familyMislink21Dispatch(t, "amind_essilor_issuer_banner.txt", "amind_dict.tsv", "htmltable", 1)
	for _, r := range rows {
		if r.IssuerName != "ESSILOR INTERNATIONAL" {
			t.Fatalf("fixture issuer not read as printed: issuer=%q", r.IssuerName)
		}
		if r.FundName == "ESSILOR INTERNATIONAL" || r.SeriesID == "S000011459" {
			t.Errorf("an ISSUER heading was promoted to the fund banner and carried the fund's series: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want fund \"\" or `NESTEGG DOW JONES U.S. 2040` (the banner printed at source line 1017755) and series \"\" or that fund's; S000011459 is `American Independence Funds International Equity Fund`, which the bytes print nowhere in this section",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
