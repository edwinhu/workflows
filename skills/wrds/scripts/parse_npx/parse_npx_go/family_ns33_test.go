package main

import (
	"path/filepath"
	"testing"
)

// familyNS33Dispatch runs the real dispatch on a family NS33 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS33Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns33", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns33", fixture), sink, make([]byte, headBytes))
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

// 000074/743773/0000743773-04-000020.txt: verbatim source lines 11-34 (the SEC
// document opener through the registrant's conformed name and CIK), 50-59 (the
// FORMER COMPANY block, `</SEC-HEADER>` and the document opener through
// `<TEXT>`), 105-112 (`Item 1. Proxy Voting Record`, the `FORM N-PX REPORT`
// banner, the ICA file number, the reporting period and the registrant line),
// 6236-6269 (the `SUMMIT RUSSELL 2000 SMALL CAP INDEX FUND` banner and the
// whole 1-800-FLOWERS.COM block under it) and the filing's own last six lines.
// Every byte is verbatim. Dispatches to `issnpx` (the precondition asserts it).
//
// Summit Mutual Funds, Inc., CIK 743773, period 20040630, `issnpx`. The
// registrant is a two-tier trust: a retail `... FUND` and an insurance-separate-
// account `... PORTFOLIO` are DIFFERENT series with DIFFERENT ids. Source lines
// 6238 and 14332, verbatim:
//
//	=================== SUMMIT RUSSELL 2000 SMALL CAP INDEX FUND
//	=================== SUMMIT RUSSELL SMALL CAP INDEX PORTFOLIO
//
// The CIK's 49 dictionary rows declare S000010995 under three names across
// three vintages -- `Russell 2000 Small Cap Index Portfolio` (20060630),
// `Calvert VP Russell 2000 Small Cap Index Portfolio` (20100630) and
// `CVT Russell 2000 Small Cap Index Portfolio` (20240630) -- every one of them
// a PORTFOLIO. No `Russell ... Fund` id was ever minted at this CIK. That the
// distinction is real, and that the chain can honour it, is proved at the same
// CIK by NASDAQ, which is declared on BOTH tiers and is stamped correctly:
//
//	resolve "SUMMIT NASDAQ-100 INDEX FUND"      -> "S000010984"  (NASDAQ 100 Index Fund)
//	resolve "SUMMIT NASDAQ 100 INDEX PORTFOLIO" -> "S000010994"  (NASDAQ 100 Index Portfolio)
//	resolve "SUMMIT BOND FUND"                  -> "S000010986"  (Bond Fund)
//	resolve "SUMMIT BOND PORTFOLIO"             -> "S000010990"  (Bond Portfolio)
//
// PROBED, not judged by eye, against this filing's own index (49
// dictionary-backfilled decls; the 2004 filing declares no `<SERIES>` blocks,
// `grep -c SERIES-ID` -> 0):
//
//	icrResolveFundShared(ix, "SUMMIT RUSSELL 2000 SMALL CAP INDEX FUND") -> "S000010995"
//	icrResolveFundShared(ix, "SUMMIT RUSSELL SMALL CAP INDEX PORTFOLIO") -> "S000010995"
//	icrResolveFundShared(ix, "SUMMIT S&P 500 INDEX FUND")                -> "S000010991"
//	icrResolveFundShared(ix, "SUMMIT S&P 500 INDEX PORTFOLIO")           -> "S000010991"
//	icrResolveFundShared(ix, "SUMMIT S&P MID CAP 400 INDEX FUND")        -> "S000010992"
//	icrResolveFundShared(ix, "SUMMIT S&P MID CAP 400 INDEX PORTFOLIO")   -> "S000010992"
//	icrResolveFundShared(ix, "SUMMIT XYZZY FUND")                        -> ""
//
// so where only the Portfolio tier is declared, the chain drops the tier word
// and hands the PORTFOLIO's id to the FUND heading -- one id carried by two
// headings the bytes keep apart. Measured on the current tree with the full
// 41,139-row dictionary, the whole filing emits 15,045 rows, of which 1,791
// (`RUSSELL 2000 SMALL CAP INDEX FUND`), 690 (`S&P 500 INDEX FUND`) and 451
// (`S&P MID CAP 400 INDEX FUND`) = 2,932 carry a Portfolio id their bytes do
// not name. The correct series for them is BLANK.
//
// Fix location: `layout_icr.go`, `icrResolveFundShared` (:786) -- the rung that
// reaches a declared name after discarding the trailing tier word. `Fund` and
// `Portfolio` are not interchangeable suffixes at a CIK that declares both, so
// that rung must refuse a candidate whose declared tier word differs from the
// heading's whenever the CIK declares any series on the heading's own tier. The
// correction is a refusal, not an attribution: no new id is guessed, and the
// NASDAQ and Bond pairs above are unaffected because they match on tier
// exactly, one rung earlier.
//
// The parser is not the only writer of this id. `series_map_applied.tsv`
// carries the same tier collapse for this accession at confidence 1.0 --
// `SUMMIT RUSSELL 2000 SMALL CAP INDEX FUND  S000010995  1.0  1791`,
// `SUMMIT S&P 500 INDEX FUND  S000010991  1.0  690` and
// `SUMMIT S&P MID CAP 400 INDEX FUND  S000010992  1.0  451` -- so the overlay
// would re-stamp these rows even after the parser refuses. Both writers have to
// move together for the 2,932 rows to come out blank.
func TestFamilyNS33SummitFundVersusPortfolioTier(t *testing.T) {
	rows := familyNS33Dispatch(t, "summit_fund_vs_portfolio.txt", "summit_dict.tsv", "issnpx", 6)
	for _, r := range rows {
		if r.SeriesID != "" {
			t.Errorf("rows under `SUMMIT RUSSELL 2000 SMALL CAP INDEX FUND` carry the PORTFOLIO tier's id: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want \"\"",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000079/796298/0000950123-04-010137.txt: verbatim source lines 11-27 (the SEC
// document opener through the registrant's conformed name and CIK), 50-68 (the
// three FORMER COMPANY blocks, `</SEC-HEADER>` and the document opener through
// `<TEXT>`), 134-172 (the `FORM N-Px REPORT` banner, the ICA file number, the
// reporting period, the registrant line, the ruled fund banner and the whole 3M
// CO block under it) and the filing's own last six lines. Every byte is
// verbatim. Dispatches to `issnpx` (the precondition asserts it).
//
// Phoenix-Oakhurst Income & Growth Fund, CIK 796298, period 20040630, `issnpx`.
// The filing prints one ruled banner, source line 149, verbatim:
//
//	==================== PHOENIX-OAKHURST INCOME & GROWTH FUND =====================
//
// and that banner is the registrant's OWN conformed name. Source lines 25 and
// 52, verbatim:
//
//	COMPANY CONFORMED NAME:			PHOENIX OAKHURST INCOME & GROWTH FUND
//	FORMER CONFORMED NAME:	PHOENIX INCOME & GROWTH FUND
//
// The CIK declares two ids, S000001378 `PHOENIX INCOME & GROWTH FUND` and
// S000001379 `PHOENIX GLOBAL UTILITIES FUND`. The registrant's FORMER conformed
// name is byte-for-byte the declared name of S000001378, and it is the only one
// of the three former names that is a declared series name at this CIK
// (`NATIONAL INCOME & GROWTH FUND` and `NATIONAL TOTAL INCOME FUND` are
// declared at no CIK at any vintage), so the resolution is unique and no guess
// is involved.
//
// PROBED, not judged by eye, against this filing's own index (2
// dictionary-backfilled decls; the 2004 filing declares no `<SERIES>` blocks,
// `grep -c SERIES-ID` -> 0):
//
//	icrResolveFundShared(ix, "PHOENIX-OAKHURST INCOME & GROWTH FUND") -> ""
//	icrResolveFundShared(ix, "PHOENIX OAKHURST INCOME & GROWTH FUND") -> ""
//	icrResolveFundShared(ix, "PHOENIX INCOME & GROWTH FUND")          -> "S000001378"
//	icrResolveFundShared(ix, "INCOME & GROWTH FUND")                  -> "S000001378"
//	icrResolveFundShared(ix, "PHOENIX GLOBAL UTILITIES FUND")         -> "S000001379"
//	icrResolveFundShared(ix, "PHOENIX-OAKHURST XYZZY FUND")           -> ""
//
// The blank is not the hyphen: the unhyphenated registrant name resolves to
// nothing either. It is the interior brand word `OAKHURST`, which the SEC added
// to the registrant in 1994 and never added to the series. `issFormerKeys`
// (layout_issnpx.go:1419) already registers the registrant's former names on
// the index, so the missing step is that a banner equal to the registrant's own
// CURRENT name is never routed to them. Measured on the current tree with the
// full 41,139-row dictionary, all 1,964 rows of this filing are blank.
//
// Fix location: `layout_issnpx.go`, `issFilingIndex` (:1432) / `issFormerKeys`
// (:1419) -- when a heading normalizes to the registrant's own current
// conformed name, resolve it through the registrant's former conformed names,
// admitting the result only when EXACTLY ONE former name is a declared series
// name at this CIK. The collision refusal is what keeps it from guessing: a
// registrant whose former names hit two declared series, or none, stays blank.
func TestFamilyNS33PhoenixOakhurstRegistrantHeading(t *testing.T) {
	rows := familyNS33Dispatch(t, "phoenix_oakhurst_registrant_heading.txt", "phoenix_dict.tsv", "issnpx", 7)
	for _, r := range rows {
		if r.SeriesID != "S000001378" {
			t.Errorf("rows under the registrant's own banner `PHOENIX-OAKHURST INCOME & GROWTH FUND` are unresolved: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want \"S000001378\"",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
