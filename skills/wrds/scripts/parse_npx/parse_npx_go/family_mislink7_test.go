package main

import (
	"path/filepath"
	"testing"
)

// familyMislink7Dispatch runs the real dispatch on a family MISLINK7 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyMislink7Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink7", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink7", fixture), sink, make([]byte, headBytes))
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

// 000079/792359/0000950123-04-010355.txt: verbatim source lines 11-18, 22-26,
// 53-59, 125-131, 18405-18421, 28253-28265, 31898-31914 and 43205-43221, then
// the filing's own last three lines. Every byte stands where the source prints
// it. Dispatches to `issnpx` (the precondition asserts it).
//
// PHOENIX EDGE SERIES FUND, period 20040630. The filing declares NO series --
// it predates <SERIES-ID> -- so cikSeries.back backfills the registrant's 68
// DICTIONARY rows into meta.SeriesDecls and issFilingIndex builds the index
// over them. Every banner is the house token glued by a hyphen to a
// SUB-ADVISER brand: `PHOENIX-JANUS ...`, `PHOENIX-LORD ABBETT ...`. On the
// whole filing, the real dispatch with the registrant's 68 dictionary rows
// collapses ten distinct sleeves onto three ids:
//
//	1964 S000001964 "PHOENIX-OAKHURST GROWTH & INCOME SERIES"          (correct)
//	1576 S000001964 "PHOENIX-JANUS GROWTH SERIES"                      (wrong)
//	1576 S000001964 "PHOENIX-MFS INVESTORS GROWTH STOCK SERIES"        (wrong)
//	 613 S000001964 "PHOENIX-STATE STREET RESEARCH SMALL-CAP GROWTH SERIES" (wrong)
//	 168 S000001964 "PHOENIX-ENGEMANN SMALL & MID CAP GROWTH SERIES"    (wrong)
//	1055 S000001958 "PHOENIX-LORD ABBETT LARGE CAP VALUE SERIES"        (wrong)
//	 902 S000001958 "PHOENIX-LAZARD SMALL-CAP VALUE SERIES"             (wrong)
//	 582 S000001958 "PHOENIX-LORD ABBETT MID-CAP VALUE SERIES"          (wrong)
//	 641 S000001958 "PHOENIX-SANFORD BERNSTEIN SMALL-CAP VALUE SERIES"  (correct)
//
// THE RUNG, probed on the real filing's own index (not judged by eye). Every
// (ix, key) rung of the distinctive-token/pair/stem family returns nil on
// these three headings, while issResolveFundUncached answers, and the rung
// inside it is issCutGluedBrand (layout_issnpx.go:1981), whose candidate loop
// runs k from len(toks)-1 DOWN to 1 -- shortest remainder FIRST:
//
//	issCutGluedBrand(ix, "PHOENIX-JANUS GROWTH SERIES", "phoenix edge series fund")
//	  cand="phoenix series"        -> nil
//	  cand="phoenix growth series" -> S000001964 "PHOENIX GROWTH AND INCOME SERIES" (WINS)
//	issCutGluedBrand(ix, "PHOENIX-LORD ABBETT LARGE CAP VALUE SERIES", ...)
//	  cand="phoenix series"            -> nil
//	  cand="phoenix value series"      -> nil
//	  cand="phoenix cap value series"  -> S000001958 "PHOENIX SMALL-CAP VALUE SERIES" (WINS)
//	  cand="phoenix large cap value series" -> nil
//
// The shortest remainder is the LEAST evidence and it is tried first, so the
// candidate that still carries the sleeve's own discriminating words is never
// reached. The same ordering is measurably losing the RIGHT answer elsewhere
// in this filing: on `PHOENIX-SENECA MID-CAP GROWTH SERIES` the loop takes
// `phoenix growth series` -> S000001964 while the later candidate
// `phoenix mid cap growth series` is an exact hit on the declared
// S000001959 `PHOENIX MID-CAP GROWTH SERIES`, and on
// `PHOENIX-LORD ABBETT MID-CAP VALUE SERIES` the later candidate
// `phoenix mid cap value series` exactly names S000001957.
//
// The registrant's dictionary distinguishes these sleeves perfectly well
// (S000001959 PHOENIX MID-CAP GROWTH, S000001965 PHOENIX-ENGEMANN SMALL-CAP
// GROWTH, S000001957 PHOENIX-SANFORD BERNSTEIN MID-CAP VALUE are all present),
// so the collapse is the rung widening, not a thin dictionary.
//
// The three headings asserted blank here name NO declared sleeve of this
// registrant at any vintage: there is no `PHOENIX GROWTH SERIES`, no
// `... INVESTORS GROWTH STOCK ...` and no `... LARGE CAP VALUE ...` among the
// 68 rows. A link key is never guessed, so blank is the honest value.
// `PHOENIX-OAKHURST GROWTH & INCOME SERIES` is the contrast and must keep
// S000001964 -- `PHOENIX GROWTH AND INCOME SERIES` is the declared name and
// OAKHURST is the same sleeve's sub-adviser brand.
//
// Rows affected on this filing: 4,282 wrong under S000001964 and 2,539 under
// S000001958 (measured on the real dispatch over the whole filing); the family
// is 3 filings / 4,808 pool rows. Every one of these rows IMPROVES the coverage
// metric while carrying a series the bytes do not name.
//
// Fix in layout_issnpx.go, issCutGluedBrand: run the candidate loop from the
// LONGEST remainder to the shortest (k ascending), so the candidate that keeps
// the most of the printed heading answers first, and refuse a candidate that
// has dropped a token the heading prints and the declared name contradicts
// (`GROWTH` against `GROWTH AND INCOME`, `LARGE CAP` against `SMALL-CAP`).
// Only the brand between the house token and the fund stem may be dropped, not
// the stem's own discriminating words.
func TestFamilyMislink7PhoenixGluedBrandShortestRemainderWins(t *testing.T) {
	rows := familyMislink7Dispatch(t, "phoenix_edge_glued_brand.txt", "phoenix_edge_dict.tsv", "issnpx", 24)
	want := map[string]string{
		"PHOENIX-JANUS GROWTH SERIES":                "",
		"PHOENIX-MFS INVESTORS GROWTH STOCK SERIES":  "",
		"PHOENIX-LORD ABBETT LARGE CAP VALUE SERIES": "",
		"PHOENIX-OAKHURST GROWTH & INCOME SERIES":    "S000001964",
	}
	for _, r := range rows {
		w, ok := want[r.FundName]
		if !ok {
			t.Errorf("fixture precondition: unexpected fund %q", r.FundName)
			continue
		}
		if r.SeriesID == w {
			continue
		}
		if w == "" {
			t.Errorf("a sub-adviser sleeve the registrant never declared was stamped with a sibling sleeve's id: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want blank (issCutGluedBrand took the SHORTEST brand-cut candidate; no declared name of CIK 792359 spells this heading at any vintage)", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
			continue
		}
		t.Errorf("contrast section regressed: fund=%q item=%q series=%q want %s", r.FundName, r.ItemSeq, r.SeriesID, w)
	}
}

// 000103/1033669/0000930413-17-002976.txt: verbatim source lines 1-16, 39-113,
// 122, 27005-27021 and 65887-65903, then the filing's own last four lines.
// Every byte stands where the source prints it. The header range 39-113 is
// contiguous and unabridged, so the fixture declares exactly the five SERIES
// blocks the real filing declares, in the source's own order -- S000010297,
// S000047898, S000051021, S000051022, S000051023 -- and no chassis rule that
// keys on the declared-series COUNT can fire here without firing on the real
// filing. Dispatches to `issnpx` (the precondition asserts it).
//
// LAZARD RETIREMENT SERIES INC, CIK 1033669, period 20170630. The filer's
// series are the RETIREMENT sleeves -- separate registered series from the
// retail ones of the sibling registrant The Lazard Funds Inc, CIK 874964 --
// but the filing heads all 30 of its sections with the RETAIL spelling, with
// no `Retirement` infix. On the whole filing the real dispatch stamps 25 of 29
// resolved headings with a series of CIK 874964 through cikSeries.crossCIK,
// e.g. 5,345 rows S000037196 `Lazard Global Dynamic Multi-Asset Portfolio`
// while the filer's own sleeve is S000037000
// `Lazard Retirement Global Dynamic Multi-Asset Portfolio`. About 24,800 rows
// of this one filing carry a retail id on a Retirement filer -- a wrong link
// key, not a missing one.
//
// THE TWO ROUTES, probed on the real filing's own index:
//
//	"Lazard Managed Equity Volatility Portfolio"   (header-declared sleeve)
//	  issNearMissDecl -> S000051023 "Lazard Retirement Managed Equity Volatility Portfolio"
//	  crossCIK        -> S000049416 (CIK 874964)   -- never reached; the chain answered first
//	"Lazard Global Dynamic Multi-Asset Portfolio"  (sleeve declared only in the dictionary)
//	  issResolveFundUncached -> nil                -- the own declaration is not in the index
//	  crossCIK               -> S000037196 (CIK 874964)  (WINS)
//
// So one filing resolves the same naming convention two ways depending only on
// whether the header happened to declare that sleeve. issNearMissDecl is the
// existing exact-after-infix rule and it is NOT a guess -- it reads the whole
// heading against the whole declared name and admits exactly the one inserted
// token -- and the contrast section proves it reaches the filer's own id
// whenever the declaration is in the index. It is not in the index here:
// cikSeries.back backfills dictionary rows only for a filing that declares
// nothing, and this filing declares five. Nothing in the chain as it stands
// can therefore reach S000037000, so this test asserts BLANK rather than the
// filer's own id: a wrong series id is worse than a blank one, and asserting
// S000037000 would be asserting a production change rather than a defect.
//
// The premise is in the dictionary fixture, verbatim from cik_series.tsv:
//
//	0001033669 S000037000 Lazard Retirement Global Dynamic Multi-Asset Portfolio 20190630
//	0000874964 S000037196 Lazard Global Dynamic Multi-Asset Portfolio            20180630
//
// The filer's own declared name differs from the printed heading by exactly one
// token, `Retirement`, which is a token of the filer's own COMPANY CONFORMED
// NAME (`LAZARD RETIREMENT SERIES INC`). That is the signal: when the filer's
// own declarations -- header or dictionary, any vintage -- carry a name that
// differs from the heading only by a registrant-brand infix token, the heading
// is the filer's own sleeve printed short of its brand, and the sibling's
// identically-spelled retail series is the wrong answer.
//
// Rows affected: 5,345 on the asserted heading, ~24,800 across the filing's 25
// cross-CIK headings; the family is one filing.
//
// Fix in cik_series.go, func (d *cikSeries) crossCIK: before returning a
// sibling registrant's series, refuse when a declaration of the FILER's own
// CIK (meta.SeriesDecls or d.byCIK[cik], any vintage) differs from the heading
// only by an inserted token that is a token of the registrant name -- the same
// one-token-edit test issNearMissDecl already applies, read against the filer's
// own dictionary rather than the filing index.
func TestFamilyMislink7LazardRetirementCrossCIKInfix(t *testing.T) {
	rows := familyMislink7Dispatch(t, "lazard_retirement_infix.txt", "lazard_retirement_dict.tsv", "issnpx", 14)
	for _, r := range rows {
		switch r.FundName {
		case "Lazard Global Dynamic Multi-Asset Portfolio":
			if r.SeriesID != "" {
				t.Errorf("a Retirement filer's heading was stamped with the RETAIL sibling's series: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want blank (S000037196 is CIK 874964's retail sleeve; this filer's own S000037000 is `Lazard Retirement Global Dynamic Multi-Asset Portfolio`, the same name plus the registrant-brand infix `Retirement`)", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
			}
		case "Lazard Managed Equity Volatility Portfolio":
			if r.SeriesID != "S000051023" {
				t.Errorf("contrast section regressed: fund=%q item=%q series=%q want S000051023 (the header-declared sleeve, reached by issNearMissDecl over the same one-token infix)", r.FundName, r.ItemSeq, r.SeriesID)
			}
		default:
			t.Errorf("fixture precondition: unexpected fund %q", r.FundName)
		}
	}
}
