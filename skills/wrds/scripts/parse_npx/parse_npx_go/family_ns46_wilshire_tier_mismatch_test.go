package main

import (
	"path/filepath"
	"testing"
)

// Wilshire Mutual Funds Inc. (CIK 0000890453) prints `Wilshire Large Company
// Growth Fund` as a body banner and declares that same series, in the same
// filing's own SGML header, for the same period of report, as `WILSHIRE LARGE
// COMPANY GROWTH PORTFOLIO` (S000001045, tickers DTLGX/WLCGX). One trailing
// type word apart. The parser reads the banner correctly and verbatim into the
// fund-name column, finds S000001045, and then discards it at issTierMismatch
// (layout_issnpx.go:7089, called from :2646), which refuses a resolved
// candidate when the heading's trailing type word differs from the declared
// name's AND issDeclaresTypeWord reports some series in the same pool typed
// with the heading's word.
//
// The guard exists for Summit Mutual Funds, a genuine two-tier trust whose
// `... INDEX FUND` and `... INDEX PORTFOLIO` banners are different funds. At
// 890453 its premise is false. The three fund-typed pool entries that trip it
// -- S000001049 `WILSHIRE 5000 INDEX FUND`, S000019534 `WILSHIRE LARGE CAP
// CORE 130/30 FUND`, S000022095 `Wilshire/MAXAM Diversity Fund` -- are
// unrelated sibling funds, not the Fund-tier twins of any Portfolio-typed
// name. No competing `Wilshire Large Company Growth Fund` exists at this CIK
// at any vintage, in the header or in cik_series.tsv.
//
// The registrant supplies the discriminator itself: S000001049 is declared
// `DOW JONES WILSHIRE 5000 INDEX PORTFOLIO` at 20060630 and `WILSHIRE 5000
// INDEX FUND` from 2009 on. One id, both type words, one registrant -- direct
// proof that Portfolio and Fund do not separate tiers here.
//
// Cost on the four real 890453 filings, measured at 474870d1 with the
// 41,139-row corpus dictionary: 20,336 blank rows (373 + 6,237 + 5,718 +
// 8,008). The overlay is irrelevant -- a run without -series-map produced the
// identical figure.
//
// FIXTURE. Verbatim archive bytes of 000089/890453/0001135428-10-000342.txt
// (md5 of the archive copy a11035f417fe22def0e45caae3bac94b), excerpted, never
// paraphrased: lines 1-214 (the whole SGML header including all SEVEN <SERIES>
// declarations, the FORM N-PX preamble and the document's single <TABLE>),
// line 219 (the <S>/<C> column ruler), lines 38516-38565 (the `Wilshire Large
// Company Growth Fund` banner whose `Wilshire` begins at byte 2765974, and the
// 3M / ABBOTT LABORATORIES ballots under it), line 62456 (</TABLE>) and the
// document's own four trailing lines. All seven declarations are load-bearing:
// with only the four `...PORTFOLIO` ids present, issDeclaresTypeWord finds no
// fund-typed sibling, the guard never engages, and the banner resolves -- so a
// four-series fixture would pass vacuously.
//
// Dictionary: all 15 cik_series.tsv rows this CIK carries in the corpus
// dictionary, copied verbatim. They matter -- the 20060630 `DOW JONES WILSHIRE
// 5000 INDEX PORTFOLIO` and 20250630 `FT WILSHIRE 5000 INDEX FUND` aliases are
// the rename evidence, and the S000019534 aliases are pool members. No
// overlay; seriesMap is nil.
//
// This test FAILS at 474870d1: all 15 rows carry a blank series_id. Do not
// make it pass by weakening issTierMismatch to nothing -- the Summit two-tier
// case it was written for still has to refuse.
func TestFamilyNS46WilshireTierMismatchRefusal(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns46", "dict_tier.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	sink := &rowSink{}
	fixture := "wilshire_lcg_2010_tier.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_ns46", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "pvtext" || meta.CIK != "0000890453" || meta.PeriodOfReport != "20100630" || len(meta.SeriesDecls) != 7 {
		t.Fatalf("dispatch precondition: CIK=%q period=%q layout=%q status=%q decls=%d rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(meta.SeriesDecls), len(sink.buf), meta.ErrorMsg)
	}
	if len(sink.buf) != 15 {
		t.Fatalf("fixture precondition: got %d rows, want 15 (ABBOTT LABORATORIES items 1.1-1.12 and ABBOTT LABORATORIES INC items 1.1-1.3)", len(sink.buf))
	}

	const wantFund = "Wilshire Large Company Growth Fund"
	const wantID = "S000001045"
	for _, r := range sink.buf {
		if r.FundName != wantFund {
			t.Fatalf("fund_name=%q, want %q verbatim from the banner at byte 2765974 -- the heading is read correctly; the defect is what happens to the id afterwards",
				r.FundName, wantFund)
		}
	}
	for _, r := range sink.buf {
		if r.SeriesID != wantID {
			t.Errorf("heading %q (issuer %q item %q): series=%q, want %s -- this filing's own header declares S000001045 as `WILSHIRE LARGE COMPANY GROWTH PORTFOLIO`, one type word away, same registrant, same period of report; the fund-typed pool entries that refuse it (S000001049, S000019534, S000022095) are unrelated sibling funds, and S000001049 is itself declared `DOW JONES WILSHIRE 5000 INDEX PORTFOLIO` at 20060630 and `WILSHIRE 5000 INDEX FUND` from 2009 on, so Portfolio and Fund do not separate tiers at this CIK",
				r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID, wantID)
			break
		}
	}
}
