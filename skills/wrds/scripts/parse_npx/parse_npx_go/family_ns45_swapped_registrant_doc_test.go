package main

import (
	"path/filepath"
	"testing"
)

// John Hancock Investment Trust II (CIK 0000743861) filed its sibling's
// document. The 2020 submission 0001438934-20-000324 carries
// `<FILENAME>BRD031_0000022370_2020.txt`, whose body is BYTE-IDENTICAL to the
// document John Hancock Investment Trust (CIK 0000022370) filed the same day as
// 0001438934-20-000323 (md5 99f464de44e9a647b2179998a7ca0906 over
// <TEXT>..</TEXT> in both). The body names its own owner three times -- the
// document filename, `NAME OF REGISTRANT: John Hancock Investment Trust`, and
// `INVESTMENT COMPANY ACT FILE NUMBER: 811-00560` -- while the filer's SGML
// header declares only the two series 743861 actually owns (Financial
// Industries Fund S000000634, Regional Bank Fund S000000635), neither of which
// heads a section. Every one of the 16 printed banners belongs to 22370.
//
// The twin filings therefore parse the same bytes to opposite results. On run73
// the 22370 copy resolves all 15 non-empty banners; the 743861 copy resolves
// none of them -- 19,046 of its 19,718 rows blank, and the remaining 672
// (`2X64 JHF Small Cap Core Fund`) carried by a series_map_applied.tsv row to
// S000000636, `Small Cap Equity Fund`, a 743861 fund last declared in 2006. The
// sibling row one line away in the same overlay maps the identical banner in
// the identical body to S000043450. The registrant-scoped pool is the whole
// defect: no rung is wrong, they are all reading the wrong registrant.
//
// The banner shape itself is already handled. issLeadingCodeToken cuts `2X16`
// and the JHF/JH house token resolves against the declarations -- which is why
// the 22370 copy answers, and why this CIK's own 2021 filing resolves
// `2X13 JHF Financial Industries Fund` without help. crossCIK cannot stand in
// for it: the printed form `jhf balanced fund` has zero rows across all
// cik_series.tsv names, and even expanded to `balanced fund` it is 16
// registrant/series pairs corpus-wide (`fundamental large cap core fund`, 2),
// so an exact-and-unique cross-CIK rung would refuse 1,625 of the 19,718 rows
// even if fed the cut heading it is not currently fed (cik_series.go:511 passes
// r.FundName raw).
//
// The family is three filings, all Broadridge-prepared John Hancock
// submissions: this one, 000075/756913/0001438934-22-000237.txt
// (`BRD031_0000743861_2022.txt`, 1,193 blank plus 1,004 rows of
// `2X13 JHF Financial Industries Fund` wrongly stamped S000008229, a 756913
// fund) and 000075/756913/0001438934-09-000323.txt (`brd031_0001189740.txt`,
// 39 rows blank). Measured across the 6,539 Broadridge filings in the corpus,
// 3,553 embed the filer's own zero-padded CIK in the document filename and
// exactly 3 embed a different one -- these three.
//
// FIXTURES. Both are verbatim archive bytes, closed with the document's own
// trailing tags:
//
//	jhit2_wrong_registrant_doc.txt -- 0001438934-20-000324 lines 1-205 (the
//	    whole SGML header with both 743861 declarations, the FORM N-PX
//	    preamble, the `2X16 JHF Balanced Fund` banner at line 158 and its
//	    ABBOTT LABORATORIES ballot), then lines 9602-9626 (the
//	    `2X64 JHF Small Cap Core Fund` banner and its AMBARELLA ballot) and
//	    lines 72776-72802 (`3380 JHF Diversified Real Assets Fund` and its
//	    ACTIVIA PROPERTIES ballot).
//	jhit_own_registrant_doc.txt -- the CONTROL: 0001438934-20-000323 lines
//	    1-570 (its header, all 15 declarations) followed by the same three
//	    body slices, which are the same bytes in both archive copies.
//
// Three banners, not one, because they exercise the three dictionary shapes:
// `Balanced Fund` is declared bare, `John Hancock Small Cap Core Fund` and
// `John Hancock Diversified Real Assets Fund` carry the house name.
//
// Dictionary: all 33 cik_series.tsv rows of the two CIKs, copied verbatim (3
// for 0000743861, 30 for 0000022370). No overlay -- seriesMap is nil, so the
// 672-row wrong stamp is not reproduced here; what is reproduced is the parse
// the overlay was built on top of.
//
// This test FAILS today on the 743861 half and passes on the control. Touch no
// production code to make it pass by loosening a rung: the fix is to resolve
// against the registrant the embedded document names.
func TestFamilyNS45SwappedRegistrantDocument(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns45", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	want := map[string]string{
		"2X16 JHF Balanced Fund":                "S000000629",
		"2X64 JHF Small Cap Core Fund":          "S000043450",
		"3380 JHF Diversified Real Assets Fund": "S000061352",
	}

	run := func(fixture, cik string, decls int) map[string]map[string]int {
		t.Helper()
		sink := &rowSink{}
		meta := processFile(fixture, filepath.Join("testdata", "family_ns45", fixture), sink, make([]byte, headBytes))
		if meta.ParseStatus != "ok" || meta.Layout != "broadridge" || meta.CIK != cik || meta.PeriodOfReport != "20200630" || len(meta.SeriesDecls) != decls {
			t.Fatalf("%s: dispatch precondition: CIK=%q period=%q layout=%q status=%q decls=%d rows=%d error=%q",
				fixture, meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(meta.SeriesDecls), len(sink.buf), meta.ErrorMsg)
		}
		if len(sink.buf) != 30 {
			t.Fatalf("%s: fixture precondition: got %d rows, want 30 (21 ABBOTT + 5 AMBARELLA + 4 ACTIVIA)", fixture, len(sink.buf))
		}
		got := map[string]map[string]int{}
		for _, r := range sink.buf {
			if got[r.FundName] == nil {
				got[r.FundName] = map[string]int{}
			}
			got[r.FundName][r.SeriesID]++
		}
		if len(got) != len(want) {
			t.Fatalf("%s: fixture precondition: %d distinct banners, want %d: %v", fixture, len(got), len(want), got)
		}
		return got
	}

	// CONTROL: the same body under the registrant that owns it.
	ctrl := run("jhit_own_registrant_doc.txt", "0000022370", 15)
	for banner, id := range want {
		ids := ctrl[banner]
		if len(ids) != 1 || ids[id] == 0 {
			t.Fatalf("control jhit_own_registrant_doc.txt: banner %q resolved to %v, want %s only -- the control must hold before the defect below means anything",
				banner, ids, id)
		}
	}

	// DEFECT: identical bytes, filed under CIK 0000743861.
	got := run("jhit2_wrong_registrant_doc.txt", "0000743861", 2)
	for banner, id := range want {
		ids := got[banner]
		if len(ids) != 1 || ids[id] == 0 {
			t.Errorf("banner %q: series %v, want %s -- these are the same bytes the control resolves (md5 99f464de44e9a647b2179998a7ca0906 over the body in both archive copies); the document names its owner as `BRD031_0000022370_2020.txt` / `John Hancock Investment Trust` / file number 811-00560, and the filer's own header declares only S000000634 and S000000635, neither of which heads a section",
				banner, ids, id)
		}
	}
}
