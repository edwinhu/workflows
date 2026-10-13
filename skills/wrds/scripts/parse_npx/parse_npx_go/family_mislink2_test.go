package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// familyMislink2Dispatch runs the real dispatch on a family MISLINK2 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyMislink2Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink2", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink2", fixture), sink, make([]byte, headBytes))
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

// 000035/356476/0000356476-04-000106.txt: verbatim source lines 11-29, 51-56,
// 63639-63652, 73509-73521, 85581-85593 and 97596-97599 (the filing's own
// tail). The WHOLE filing dispatches to `labelvalue`; this excerpt, which
// carries the three ruled banners and none of the filing's columnar <TABLE>
// section, dispatches to `issnpx` (the precondition asserts it). The defect is
// in the chain BOTH layouts share -- labelvalue reaches it through
// lvResolveBanner -> icrResolveFundShared -> issResolveFund and issnpx through
// issResolveFund directly -- so the excerpt reproduces it unchanged; the
// measured collision quoted below is from a real dispatch on the whole filing.
//
// Maxim Series Fund Inc., 2004. Three DISTINCT index sleeves are all stamped
// S000023741, whose only contemporaneous dictionary name at this CIK is `Maxim
// Index 600 Portfolio` -- 3,464 rows of the filing carry a series that is not
// theirs. Source lines 63639, 73509 and 85581 verbatim:
//
//	=============================== MAXIM INDEX 400 ================================
//	============================= MAXIM INDEX EUROPEAN =============================
//	============================= MAXIM INDEX PACIFIC ==============================
//
// beside the sibling at source line 16310 that legitimately owns the id:
//
//	========================== MAXIM INDEX 600 PORTFOLIO ===========================
//
// The registrant declares no <SERIES-ID>, so cikDict.back backfills the
// contemporaneous dictionary into the header and the whole declared-name chain
// runs over it. Measured on this filing's own index, the rung that answers is
// issDistinctivePairDecl (layout_issnpx.go:4684, called at :3235): the adjacent
// ordered pair `maxim index` occurs in exactly one declared name, so the rung
// stamps it and never reads the token the heading prints INSTEAD of `600`.
//
//	issDistinctivePairDecl("maxim index 400")      => S000023741 "Maxim Index 600 Portfolio"
//	issDistinctivePairDecl("maxim index european") => S000023741 "Maxim Index 600 Portfolio"
//	issDistinctivePairDecl("maxim index pacific")  => S000023741 "Maxim Index 600 Portfolio"
//
// Every other rung of the chain refuses these three headings, and the
// dictionary path (htmlDictionaryFund / dictFallback.apply) returns "" for all
// three: the pair rung alone produces the collision.
//
// None of the three names a series of this registrant in 2004 -- the 400 sleeve
// the dictionary does carry is `Maxim S&P MidCap 400 Index Portfolio`
// (S000030872), first declared in 2011, and there is no European and no Pacific
// index sleeve at any vintage -- so the correct answer for all three is no
// series at all.
//
// Fix in layout_issnpx.go, issDistinctivePairDecl (:4684): a rung that resolves
// on a SUBSET of the heading's tokens must refuse when the tokens it dropped
// contradict the declared name. Where the heading and the declared name differ
// by a NUMBER (400 vs 600) or by a REGION word (European, Pacific), the
// remainder is not evidence of the same fund; only an exact or dictionary-exact
// answer on the remainder may stand, and it must be refused when the remainder
// collides with a sibling sleeve.
func TestFamilyMislink2MaximIndexSleeveNumberRegionCollision(t *testing.T) {
	rows := familyMislink2Dispatch(t, "maxim_index_sleeve_number_region_collision.txt", "maxim_dict.tsv", "issnpx", 4)
	for _, r := range rows {
		if !strings.HasPrefix(r.FundName, "MAXIM INDEX") {
			continue
		}
		if r.SeriesID != "" {
			t.Errorf("a number/region-distinct index sleeve took the Index 600 series: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want \"\"", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
