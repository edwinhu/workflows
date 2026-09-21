package main

import (
	"path/filepath"
	"testing"
)

// Wilshire Mutual Funds Inc. (CIK 0000890453) prints `... Company Growth Fund`
// in its body and declares `... COMPANY GROWTH PORTFOLIO` in its own SGML
// header, for the same series, in the same filing, for the same period. The
// parser reads the heading correctly and verbatim into the fund-name column,
// finds the right series, and then throws the answer away at issTierMismatch
// (layout_issnpx.go:7089, called from :2646), which refuses a resolved
// candidate whenever the heading's trailing type word differs from the declared
// name's AND issDeclaresTypeWord reports some series in the same pool typed with
// the heading's word.
//
// That guard exists for Summit Mutual Funds, a genuine two-tier trust whose
// `... INDEX FUND` and `... INDEX PORTFOLIO` banners are different funds. At
// 890453 its premise is false. The three `fund`-typed pool entries that trip it
// -- S000001049 `WILSHIRE 5000 INDEX FUND`, S000019534 `WILSHIRE LARGE CAP CORE
// 130/30 FUND`, S000022095 `Wilshire/MAXAM Diversity Fund` -- are unrelated
// sibling funds, not the `Fund`-tier twins of any `Portfolio`-typed name. No
// competing `Wilshire Large Company Growth Fund` exists at this CIK at any
// vintage, in the header or in cik_series.tsv, and no CIK anywhere carries
// `Wilshire Large Company ...` or `Wilshire Small Company ...` in any form.
//
// The registrant itself supplies the discriminator: S000001049 is declared
// `DOW JONES WILSHIRE 5000 INDEX PORTFOLIO` in the 2006 header and
// `WILSHIRE 5000 INDEX FUND` in the 2009/2010 headers. One id, both type words,
// one registrant -- direct proof that `Portfolio` and `Fund` do not separate
// tiers here.
//
// Cost on the four real filings, measured at HEAD (474870d1) with the 41,139-row
// corpus dictionary and the 8,767-row applied overlay: 20,336 blank rows
// (373 + 6,237 + 5,718 + 8,008). Returning false from issTierMismatch drives
// that to 0. The overlay is irrelevant -- a run without -series-map produced the
// identical 20,336.
//
// FIXTURES. Verbatim archive bytes, closed with the document's own trailing
// tags. No SERIES-NAME, CUSIP or vote row is fabricated.
//
//	wilshire_lcg_2010.txt -- 0001135428-10-000342 (md5 of the archive copy
//	    a11035f417fe22def0e45caae3bac94b) lines 1-210: the whole SGML header
//	    with all SEVEN <SERIES> declarations, and the FORM N-PX preamble.
//	    Then lines 38514-38553: the `Wilshire Large Company Growth Fund`
//	    banner at byte 2765974 and the two ballots under it. All seven
//	    declarations are required -- with only the four `...PORTFOLIO` ids in
//	    the header the guard never engages and this heading resolves to
//	    S000001045 on the current binary, so a four-series fixture would pass
//	    vacuously.
//	wilshire_scg_2006.txt -- 0001193125-06-183725 (md5
//	    e4cec385df6b64d1d6e724a373801b42) lines 1-157 (header, five
//	    declarations at this vintage, document opening), then lines
//	    106416-106521 (the three-line stacked banner
//	    `Wilshire Mutual Funds` / `Kalmar Investment Advisers` /
//	    `Small Company Growth Fund` at byte 7930658, and its Niko Resources
//	    ballots), then lines 155595-156095 (the CONTROL section, banner
//	    `Wilshire Large Company Value Fund - WILSFD`, which resolves on the
//	    current binary). The control is not decoration: without a second
//	    section carrying a resolved heading the fixture is fully unlabelled
//	    and consolidatedSeries (main.go:742) stamps every declared id onto
//	    every row, hiding the refusal.
//
// The 2006 half also pins the trap. Under the ablation the unbranded
// `Small Company Growth Fund` resolves to S000003363, which belongs to CIK
// 0001331971 -- the crossCIK rung (layout_issnpx.go:2649-2660) prefers an exact,
// corpus-unique, contemporaneous sibling over a same-CIK answer reached by
// tolerance, and a type-word substitution is a tolerance. 2,743 rows of the 2006
// filing sit under that heading. A fix that trades 8,008 blanks for ~2,700 ids
// belonging to another registrant is worse than the blank by this project's own
// rule, so the registrant-scoped Portfolio/Fund answer must come ahead of
// crossCIK.
//
// Dictionary: all 15 cik_series.tsv rows of 0000890453 plus all 298 of
// 0001331971, copied verbatim. 0001331971 is what makes the crossCIK assertion
// real -- drop it and S000003363 becomes unreachable and the trap untested. No
// overlay; seriesMap is nil.
//
// This test FAILS at HEAD on both halves. Do not make it pass by weakening
// issTierMismatch to nothing: the Summit two-tier case it was written for still
// has to refuse.
func TestFamilyNS46WilshireTypeWordRefusal(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns46", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	t.Run("pvtext_2010", func(t *testing.T) {
		sink := &rowSink{}
		fixture := "wilshire_lcg_2010.txt"
		meta := processFile(fixture, filepath.Join("testdata", "family_ns46", fixture), sink, make([]byte, headBytes))
		if meta.ParseStatus != "ok" || meta.Layout != "pvtext" || meta.CIK != "0000890453" || meta.PeriodOfReport != "20100630" || len(meta.SeriesDecls) != 7 {
			t.Fatalf("dispatch precondition: CIK=%q period=%q layout=%q status=%q decls=%d rows=%d error=%q",
				meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(meta.SeriesDecls), len(sink.buf), meta.ErrorMsg)
		}
		if len(sink.buf) != 12 {
			t.Fatalf("fixture precondition: got %d rows, want 12 (the ABBOTT LABORATORIES director slate, items 1.1-1.12)", len(sink.buf))
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
				t.Errorf("heading %q: series=%q, want %s -- this filing's own header declares S000001045 as `WILSHIRE LARGE COMPANY GROWTH PORTFOLIO` (tickers DTLGX/WLCGX), one type word away, same registrant, same period of report; the `fund`-typed pool entries that refuse it (S000001049, S000019534, S000022095) are unrelated sibling funds, and S000001049 is itself declared `DOW JONES WILSHIRE 5000 INDEX PORTFOLIO` in 2006 and `WILSHIRE 5000 INDEX FUND` in 2009/2010, so `Portfolio` and `Fund` do not separate tiers at this CIK",
					r.FundName, r.SeriesID, wantID)
				break
			}
		}
	})

	t.Run("htmltable_2006_crossCIK_trap", func(t *testing.T) {
		sink := &rowSink{}
		fixture := "wilshire_scg_2006.txt"
		meta := processFile(fixture, filepath.Join("testdata", "family_ns46", fixture), sink, make([]byte, headBytes))
		if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || meta.CIK != "0000890453" || meta.PeriodOfReport != "20060630" || len(meta.SeriesDecls) != 5 {
			t.Fatalf("dispatch precondition: CIK=%q period=%q layout=%q status=%q decls=%d rows=%d error=%q",
				meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(meta.SeriesDecls), len(sink.buf), meta.ErrorMsg)
		}
		if len(sink.buf) != 25 {
			t.Fatalf("fixture precondition: got %d rows, want 25 (3 Niko Resources under the Kalmar/Small Company Growth banner + 22 control rows)", len(sink.buf))
		}

		var defect, control []VoteRow
		for _, r := range sink.buf {
			switch r.FundName {
			case "Wilshire Large Company Value Fund - WILSFD":
				control = append(control, r)
			default:
				defect = append(defect, r)
			}
		}
		if len(control) != 22 || len(defect) != 3 {
			t.Fatalf("fixture precondition: %d control rows and %d defect rows, want 22 and 3", len(control), len(defect))
		}

		// CONTROL. The same fund family, the same filing, five characters of
		// sleeve code apart: `- WILSFD` leaves `wilsfd` as the last token, so
		// issDropTypeWord reports the heading untyped and the guard never
		// engages. This must hold before the defect below means anything.
		for _, r := range control {
			if r.SeriesID != "S000001046" {
				t.Fatalf("control row (issuer %q): series=%q, want S000001046 -- the control resolves at HEAD; if it stopped resolving the fixture, not the defect, is what changed",
					r.IssuerName, r.SeriesID)
			}
		}

		// DEFECT + TRAP. S000001047 is the 890453 series this section's banner
		// names. S000003363 is `Small Company Growth Fund` at CIK 0001331971,
		// 20060630 -- the exact, corpus-unique, contemporaneous cross-CIK twin
		// that the ablation reaches and that a naive fix would stamp on 2,743
		// rows of this filing.
		for _, r := range defect {
			switch r.SeriesID {
			case "S000001047":
			case "S000003363":
				t.Errorf("issuer %q: series=S000003363, which belongs to CIK 0001331971 -- want S000001047. The registrant-scoped Portfolio/Fund answer must be reached BEFORE the crossCIK rung at layout_issnpx.go:2649-2660; a cross-registrant id is worse than the blank this row carries today",
					r.IssuerName)
			default:
				t.Errorf("issuer %q: series=%q fund_name=%q, want S000001047 -- the banner at byte 7930658 is the three-line stack `Wilshire Mutual Funds` / `Kalmar Investment Advisers` / `Small Company Growth Fund`, and this filing's header declares S000001047 as `WILSHIRE SMALL COMPANY GROWTH PORTFOLIO`. The htmltable caller discards the printed banner along with the id when issResolveFund returns (banner, nil), which is why these rows look heading-absent in LOST_BASE when they are the same type-word refusal",
					r.IssuerName, r.SeriesID, r.FundName)
			}
		}
	})
}
