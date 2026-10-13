package main

import (
	"path/filepath"
	"testing"
)

// familyNS23bDispatch runs the real dispatch on a family NS23b fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS23bDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns23b", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns23b", fixture), sink, make([]byte, headBytes))
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

// 000093/934563/0001193125-15-299145.txt: verbatim source lines 1-20 (the SEC
// header through the fiscal year end), 51-52 (the series-data openers), the
// seven `<SERIES>` blocks the defect needs trimmed to their id/name lines and
// closers (68-71, 82-86, 97-101, 112-116, 127, 173-176, 187-191, 202-206),
// 352-361 (the header closers and the document opener through `<TEXT>`),
// 103545-103572 (the `Hirtle Callaghan Institutional Growth Equity Portfolio
// #12V1` heading and the Abbott Laboratories block under it) and the filing's
// own last three lines. Every byte is verbatim. Dispatches to `icr` (the
// precondition asserts it).
//
// THE FIXTURE'S LAYOUT IS `icr` WHILE THE FILING'S IS `labelvalue`, and the
// difference is a size threshold, not a grammar one. The filing's first
// `#  Proposal ... Vote Cast  Sponsor` line is at source line 38802, roughly
// 3 MB in, past `signatureHeadBytes` (128 KB), so `matchISSNPX` never sees it
// and `labelvalue` -- which opts into a 16 MB window -- wins the 46 MB filing.
// Measured on the real bytes: `labelvalue` reads 4,400 rows and `icr` 8,347,
// and the rows under the heading below are among the icr ones, reached in the
// filing through `icrSupplement` (text_parser.go:507). No 120-line excerpt can
// push a header line past 128 KB, so this fixture lets `icr` claim the block
// directly. The grammar that reads the rows, the index they are resolved
// against and the rung that breaks are identical either way.
//
// HC Capital Trust, CIK 0000934563, period 20150630. This is a
// REGRESSION introduced by batch 116 (391c60e8). On the residue round with the
// batch-116 binary this CIK lost series on 14,614 rows across five filings that
// resolved on the previous binary; in this filing the heading below carries
// 6,040 of them. Source line 103552, verbatim:
//
//	Fund Name : Hirtle Callaghan Institutional Growth Equity Portfolio #12V1
//
// against source lines 190-191, verbatim:
//
//	<SERIES-ID>S000021773
//	<SERIES-NAME>The Institutional Growth Equity Portfolio
//
// The heading names a series the filing's OWN HEADER declares, with the vendor
// account suffix `#12V1` behind it, so the match is not a guess.
//
// PROBED, not judged by eye, on the seven declarations this fixture carries.
// Against the header declarations alone -- the index batch 116 replaced --
// the chain answers:
//
//	icrResolveFundShared(headerIx, "Hirtle Callaghan Institutional Growth Equity Portfolio #12V1") -> "S000021773"
//	issDistinctivePairDecl(headerIx, "hirtle callaghan institutional growth equity portfolio 12v1")
//	    -> S000021773 (the pair `institutional growth` sits in exactly one declared name)
//
// Against `issFilingIndex`, i.e. with batch 116's alias fold, the SAME chain
// refuses:
//
//	icrResolveFundShared(foldIx, ...) -> ""
//	issDistinctivePairDecl(foldIx, ...) -> nil
//
// The broken hop is `issDistinctivePairDecl`'s closing guard
// `issFutureVintage(ix, hit)` (layout_issnpx.go:5157, the helper at :4518), NOT
// a collision and NOT `dictContemporaneous`: the pair scan is byte-identical
// either way (`institutional growth` -> 1 id, `growth equity` -> 2 ids,
// `equity portfolio` skipped as a type word). What changed is the DATES in
// `ix.decls`. A header declaration carries no `DeclDate`, so before the fold no
// decl was dated and `issFutureVintage` returned false for every series. The
// fold adds this CIK's dictionary rows for header-declared ids, each carrying
// its own `DeclDate`:
//
//	S000009380 "The Small Capitalization Equity Portfolio"      20060630
//	S000022549 "The Institutional Small Capitalization Equity Portfolio" 20080630
//	S000021773 "The Institutional U.S. Equity Portfolio"        20200630
//	S000009379 "The U.S. Equity Portfolio"                      20240630
//
// so `issFutureVintage` now computes, for S000021773, `first=20200630`
// (its only DATED row) against `earliest=20060630` and `ix.period=20150630`,
// and `first > period && first > earliest` holds. The series reads as one that
// did not exist yet in 2015 -- when the filing's own header declares it -- and
// the pair rung's answer is thrown away. The guard only bites when the dated
// rows disagree, which is why the fold is harmless for a CIK whose folded rows
// all share one vintage.
//
// Fix location: `layout_issnpx.go`, `issFutureVintage` -- a series the header
// declares is contemporaneous evidence by construction, so an undated (header)
// decl for the same id must veto the future-vintage verdict. The narrower
// alternative is `issDeclAliases` in the same file: fold the alias name without
// its `DeclDate`, since the header has already dated the series at `period`.
// Either way no production code is changed here.
func TestFamilyNS23bHCInstitutionalGrowthAccountSuffix(t *testing.T) {
	rows := familyNS23bDispatch(t, "hc_institutional_growth_12v1.txt", "hc_dict.tsv", "icr", 7)
	for _, r := range rows {
		if r.SeriesID != "S000021773" {
			t.Errorf("the header declares this series and the heading names it with the vendor account suffix, but the alias fold dates the series into the future and the pair rung's answer is discarded: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want S000021773",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
