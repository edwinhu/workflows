package main

import (
	"path/filepath"
	"testing"
)

// 000084/842512/0001111830-08-000971.txt: 1-179, 10678-10745, 13170-13237,
// 15686-15745, 21034-21036, with a verbatim `</TABLE>` closing each of the three
// cut sections. Williamsburg Investment Trust, period 20080630, broadridge
// layout. A full-file dispatch on this binary emits 5732 rows, 904 of them with
// no series:
//
//	998 S000001557|GOVERNMENT STREET EQUITY FUND
//	937 S000001562|THE GOVERNMENT STREET MID-CAP FUND
//	899 S000001563|JAMESTOWN BALANCED FUND PROXY VOTING RECORD 7/01/07-6/30/08
//	904 ||JAMESTOWN EQUITY FUND PROXY VOTING RECORD 7/01/07 - 6/30/08
//	721 S000013560|JAMESTOWN SELECT FUND PROXY VOTING RECORD 7/01/07 - 6/30/08
//	644 S000001558|INVESTMENT COMPANY REPORT - FBP BALANCED FUND
//	629 S000001567|INVESTMENT COMPANY REPORT - FBP VALUE FUND
//
// The 904 are the whole no-series count this CIK carries. All three Jamestown
// sections are banners bracketed between two bare rules of '=', read by
// brEqualsRuleHeading, and all three append the document title AND the reporting
// period to the declared name. Two resolve and the EQUITY one does not, which is
// not a grammar gap: the SGML header of this very filing declares
// `Jamestown Equity Fund` as S000001564 (header lines 59-172, eleven series).
//
// Neither tail-cut rung reaches any of the three. issCutProxyVotingSuffix wants
// the title TERMINAL, and the period follows it; issCutReportingPeriodTail keys
// on `for the period` / `reporting period`, which none of them prints. What
// answers all three is issSleeveStemDecl (layout_issnpx.go:5134): the heading's
// stem through its INTERNAL type word -- `jamestown <x> fund` -- must appear, in
// order, inside exactly one declared name, and everything after the type word is
// treated as a sleeve qualifier. Probed directly on this filing's own index,
// that rung is the only one of twelve that answers, and it answers only two:
//
//	key="jamestown balanced fund proxy voting record 7 01 07" -> S000001563
//	key="jamestown equity fund proxy voting record 7 01 07"   -> (nothing)
//	key="jamestown select fund proxy voting record 7 01 07"   -> S000013560
//
// The scan is a SUBSEQUENCE test, so a declared name that INSERTS a word into
// the stem answers it as readily as one that spells the stem exactly. This
// registrant declares both `Jamestown Equity Fund` (S000001564, exact, nothing
// skipped) and `Jamestown International Equity Fund` (S000001566, reached by
// passing over `international`), so two series answer one stem and the rung
// returns nil -- discarding the exact hit as ambiguous. The sibling guard above
// it does not fire: it requires the skipped word to sit at stem offset 2 or
// later (`skipAt >= 2`), and `international` sits at offset 1.
//
// `Balanced` and `Select` have no such sibling -- no declared name of this CIK
// inserts a word into `jamestown balanced fund` or `jamestown select fund` --
// which is why those two sections resolve. They are this fixture's guards: a
// regression in the sleeve-stem scan itself is told apart from the exact-beats-
// inserted ranking this test asks for.
//
// The cut emits 26 rows and carries the full-file shape:
//
//	9 S000001563|JAMESTOWN BALANCED FUND PROXY VOTING RECORD 7/01/07-6/30/08
//	9 ||JAMESTOWN EQUITY FUND PROXY VOTING RECORD 7/01/07 - 6/30/08
//	8 S000013560|JAMESTOWN SELECT FUND PROXY VOTING RECORD 7/01/07 - 6/30/08
func TestNS842512JamestownEquitySleeveStemCollision(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns842512", "williamsburg_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	const fixture = "jamestown_equity_sleeve_stem.txt"
	ch := make(chan *ParseResult, 64)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns842512", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != "broadridge" || len(rows) != 26 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), 26, meta.ErrorMsg)
	}

	wantCount := map[string]int{
		"S000001563": 9, // Jamestown Balanced Fund, source lines 10681-10745
		"S000001564": 9, // Jamestown Equity Fund, source lines 13173-13237
		"S000013560": 8, // Jamestown Select Fund, source lines 15689-15745
	}
	got := map[string]int{}
	for _, r := range rows {
		got[r.SeriesID]++
	}
	if n := got[""]; n != 0 {
		t.Errorf("%d of %d rows carry no series: the EQUITY banner's stem `jamestown equity fund` is a subsequence of the sibling declared `Jamestown International Equity Fund` (S000001566) as well as of the exact `Jamestown Equity Fund` (S000001564), so issSleeveStemDecl refused both", n, len(rows))
	}
	for _, sid := range []string{"S000001563", "S000013560"} {
		if got[sid] != wantCount[sid] {
			t.Fatalf("fixture guard: %d rows carry %s, want %d -- the sleeve-stem scan regressed, not the exact-beats-inserted ranking", got[sid], sid, wantCount[sid])
		}
	}
	if got["S000001564"] != wantCount["S000001564"] {
		t.Errorf("%d rows carry S000001564 (Jamestown Equity Fund), want %d", got["S000001564"], wantCount["S000001564"])
	}
}
