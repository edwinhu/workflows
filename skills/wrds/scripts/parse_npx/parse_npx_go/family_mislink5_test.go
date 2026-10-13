package main

import (
	"path/filepath"
	"testing"
)

// familyMislink5Dispatch runs the real dispatch on a family MISLINK5 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyMislink5Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink5", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink5", fixture), sink, make([]byte, headBytes))
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

// 000110/1105128/0000948221-04-000353.txt: verbatim source lines 11-29, 51-56,
// 86-118 and 124-145, then one `</TABLE>` line copied verbatim from source line
// 12420 to close the table the line-range cut opened (the only bytes in the
// fixture that do not stand where the source prints them), then the filing's
// own last four lines. Dispatches to `splittable` (the precondition asserts
// it). Source lines 119-123 and 146-149 -- the two blocks' `Account Name` /
// `Custodian Account` sub-tables -- are the only bytes dropped from inside the
// range: the layout emits them as furniture rows whose how_voted reads
// `Shares` and `298`, which TestHowVotedVocabularyInvariant rightly refuses in
// testdata.
//
// UMB Scout Funds, period 20040630. The filing has NO `<SERIES-ID>` blocks --
// it predates them -- and opens four ProxyEdge sections. On the whole filing,
// with the registrant's 32 dictionary rows, the real dispatch emits:
//
//	3486 fund="Scout Equity Index"  series="S000044604"
//	 193 fund="Scout Energy"        series=""
//	 188 fund="Scout Tech Fund"     series=""
//
// S000044604 is declared at this CIK as `Scout Equity Opportunity Fund`, and
// only ever at vintage 20140630 -- ten years AFTER this filing's period. The
// bytes name no Opportunity sleeve. The section's two printed names are source
// lines 94 and 99, verbatim:
//
//	Selected Accounts: Scout Equity Index
//	                                                            UMB SCOUT EQUITY INDEX FUND
//
// The registrant's entire dictionary is 33 rows / 17 series and carries no
// Equity Index sleeve at any vintage, so the honest series on these rows is
// BLANK.
//
// THE HOP, measured on the real filing's own FilingMeta. The filing declares
// nothing, so cikSeries.back (cik_series.go:188) backfills the registrant's 32
// DICTIONARY rows into meta.SeriesDecls -- carrying their DeclDate -- and
// spSeriesIndex (layout_splittable.go:250) builds issFilingIndex over them.
// From there a dictionary row is indistinguishable from a header declaration
// and the whole issResolveFund tolerance chain may reach it. The
// crossCIK vintage guard (cik_series.go:172) does not cover this route: it
// fires only for a name found under ANOTHER cik. Measured on that index:
//
//	spIndex.resolve("Scout Equity Index")          => S000044604
//	spIndex.resolve("UMB SCOUT EQUITY INDEX FUND") => S000044604
//	icrResolveFund(ix.byName, "Scout Equity Index") => ""      (no exact/suffix rung answers)
//	issResolveFund(ix, "Scout Equity Index")        => S000044604 `Scout Equity Opportunity Fund` declDate=20140630
//
// and the rung inside that chain is issDistinctivePairDecl, and nothing else --
// called directly on this fixture's index:
//
//	issDistinctivePairDecl(ix, "scout equity index")          => S000044604
//	issDistinctivePairDecl(ix, "umb scout equity index fund") => S000044604
//	issDistinctiveTokenDecl / StemDecl / AbbrevStemDecl /
//	issWidthTruncatedDecl / issNearMissDecl                   => nil
//
// It answers on the adjacent ordered pair `scout equity`, which is distinctive
// among the 32 backfilled names. The pair reads two of the heading's three
// words and nothing contradicts it, because the words that DO contradict it --
// printed `Index` against declared `Opportunity` -- are never compared. The
// same rung is why a synthetic `Scout Equity Zebra` also returns S000044604,
// while `Scout Zebra Index` correctly returns "".
//
// Rows affected: 3,486 on this filing, and 455 more on the family's other
// filing (0000950137-05-010311.txt, period 20050630, heading `UMB Scout Equity
// Index`, same S000044604, measured on the real dispatch). All 3,941 carry a
// series, so no no-series tier surfaces them; on the 2004 filing LOST_BASE
// counted every row as lost, so the stamp is NEWER than the pool and its only
// effect is to convert blank rows into wrong link keys.
//
// Fix in layout_issnpx.go, issDistinctivePairDecl: a declaration whose
// DeclDate post-dates ix.period is not evidence about this filing and must not
// answer a rung that reads only part of the heading. The narrow form -- guard
// the distinctive-token/pair/stem family on ix.period -- is what is
// recommended, NOT a blanket vintage guard over the whole chain: on the
// family's 2005 filing the exact-name rungs resolve `UMB Scout Stock Fund`,
// `UMB Scout Growth Fund`, `UMB Scout Small Cap` and `UMB Scout WorldWide`
// against 20060630 dictionary rows, and those stamps are right. A link key is
// never guessed, so blank is asserted here.
func TestFamilyMislink5ScoutEquityIndexFutureVintagePair(t *testing.T) {
	rows := familyMislink5Dispatch(t, "umb_scout_equity_index.txt", "umb_scout_dict.tsv", "splittable", 9)
	for _, r := range rows {
		if r.FundName != "Scout Equity Index" {
			t.Errorf("fixture precondition: unexpected fund %q", r.FundName)
			continue
		}
		if r.SeriesID != "" {
			t.Errorf("a heading naming no declared sleeve was stamped from a declaration made ten years later: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want blank (S000044604 is `Scout Equity Opportunity Fund`, declared only at 20140630; this filing's period is 20040630 and its bytes print `Scout Equity Index`)", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
