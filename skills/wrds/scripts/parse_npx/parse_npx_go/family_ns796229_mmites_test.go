package main

import (
	"path/filepath"
	"testing"
)

// ns796229Dispatch runs the real dispatch on a family NS796229 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture. Same mechanism as ns909504Dispatch in
// family_ns_909504_gamco_abbrev_test.go, pointed at its own testdata dir.
func ns796229Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns796229", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns796229", fixture), sink, make([]byte, headBytes))
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

// CIK 0000796229 (The TETON Westwood Funds, filed 2007 as `WESTWOOD FUNDS`,
// registrant caption `The GAMCO Westwood Funds`) prints its ProxyEdge account
// banner with a vendor CONTRACTION of the declared fund name rather than an
// abbreviation the per-word rungs can reach.
//
// 000079/796229/0000935069-07-001948.txt (period 20070630) has exactly ONE
// distinct `Selected Accounts:` banner, reprinted on all 63 pages of the report
// (source lines 6429, 6513, 6592, ... -- 63 occurrences, one spelling):
//
//	Selected Accounts: NPX GABELLI WESTWOOD MMITES FD                   Page 1 of 63
//
// so the heading pools nothing: the whole filing's no_series mass is one fund.
// Measured by running HEAD (parse_npx_go_351) over the FULL filing with
// -cik-series pointed at the real cik_series.tsv, all 397 rows come back with a
// blank series_id and fund_name exactly `NPX GABELLI WESTWOOD MMITES FD`:
//
//	397  []  [NPX GABELLI WESTWOOD MMITES FD]
//
// which is this filing's whole known-registrant no_series row count.
//
// The registrant declares the fund in this filing's own header (source lines
// 160-161 verbatim: `<SERIES-ID>S000001084` / `<SERIES-NAME>WESTWOOD MIGHTY
// MITES FUND`), alongside five siblings, all six of which the fixture declares:
//
//	S000001080  WESTWOOD BALANCED FUND
//	S000001081  WESTWOOD EQUITY FUND
//	S000001082  WESTWOOD INCOME FUND
//	S000001083  WESTWOOD INTERMEDIATE BOND FUND
//	S000001084  WESTWOOD MIGHTY MITES FUND
//	S000001085  WESTWOOD SMALL CAP EQUITY FUND
//
// No sibling shares the MITES stem, and the corpus dictionary confirms
// S000001084 is the only series anywhere under this CIK, at any vintage,
// carrying the token MITES (`WESTWOOD MIGHTY MITES FUND` 20080630, `TETON
// WESTWOOD MIGHTY MITES FUND` 20130630). The fixture's dict carries all 15
// dictionary rows for this CIK verbatim, so nothing below is made unambiguous
// by hiding a rival.
//
// The banner decomposes exactly as the sibling Gabelli families' banners do:
// `NPX` is the vendor report-type token (stripped for other `Selected Accounts:
// NPX GABELLI ...` banners -- see family_ns12_test.go and
// family_ns_909504_gamco_abbrev_test.go), `GABELLI WESTWOOD` is the pre-TETON
// house brand, and `FD` abbreviates `FUND`. What is NEW here is `MMITES`: not a
// prefix or a vowel-dropped spelling of any declared word, but a contraction of
// the two declared words `MIGHTY MITES` that keeps the leading M of each and
// drops the interior of the first (M + MITES). The per-word rungs are word-to-
// word, so no rung sees `MMITES` as reaching either `MIGHTY` or `MITES`.
//
// Fixture: 000079/796229/0000935069-07-001948.txt verbatim source lines 11-213
// (the whole SEC header, its six `<SERIES>` blocks -- this filing prints its own
// `</SERIES>` closers, so nothing is inserted -- and the document preamble
// through `<TEXT>`), 6425-6507 (page 1 of the report: the `<PAGE>` marker, the
// ProxyEdge/date-range/banner triplet, and the page's own `<TABLE>` through its
// own `</TABLE>`, covering the WILLAMETTE VALLEY VINEYARDS and PALM HARBOR
// HOMES issuer sections in full plus the STOLT OFFSHORE section as far as the
// page carries it), and 11732-11735 (the document's own closing tags). No
// synthetic text. Dispatches to `splittable` (the precondition asserts it).
func TestNS796229WestwoodNPXMMitesContractionBlocksResolution(t *testing.T) {
	rows := ns796229Dispatch(t, "westwood_npx_mmites_contraction_unresolved.txt", "westwood_dict.tsv", "splittable", 9)
	for _, r := range rows {
		if r.SeriesID != "S000001084" {
			t.Errorf("the MMITES contraction blocked the declared Westwood Mighty Mites Fund: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000001084", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
