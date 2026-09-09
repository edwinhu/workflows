package main

import (
	"path/filepath"
	"testing"
)

// familyLLL1Dispatch runs the real dispatch on a family LLL1 no-series fixture.
func familyLLL1Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_lll1", fixture), sink, make([]byte, headBytes))
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

// 000103/1031661/0001438934-12-000364.txt: 11-50, 66-80, 111-124, 2730-2758,
// 9261-9264. Third Avenue Trust declares FIVE series in the SGML header of this
// 2012 broadridge filing, verbatim:
//
//	<SERIES-ID>S000001466
//	<SERIES-NAME>THIRD AVENUE REAL ESTATE VALUE FUND
//
// A full-file dispatch emits 1698 rows of which 862 -- the majority -- carry a
// blank series_id. The filing DOES print a fund heading over every section, at
// column 0 immediately above the dashed rule that opens a meeting block, in the
// ordinary broadridge state position. Five headings, verbatim:
//
//	Third Ave Focused Credit Fund      (line 154, stamped S000026399)
//	Third Ave International Value      (line 303, stamped S000001467)
//	Third Ave Real Estate              (line 2730, BLANK -- 484 rows)
//	Third Ave Small Cap                (line 4873, BLANK -- 378 rows)
//	Third Ave Value Fund               (line 7423, stamped S000001464)
//
// and the rows beneath the Real Estate heading are ordinary broadridge blocks,
// verbatim:
//
//	--------------------------------------------------------------------------------------------------------------------------
//	 BELLWAY PLC                                                                                 Agenda Number:  703473380
//	--------------------------------------------------------------------------------------------------------------------------
//	        Security:  G09744155
//
// So the heading is present and read; it does not RESOLVE. Every heading in the
// file abbreviates `Avenue` to `Ave`, and the three that resolve do so because
// what remains after that is the declared name modulo a single trailing type
// word. `Third Ave Real Estate` is the declared `THIRD AVENUE REAL ESTATE VALUE
// FUND` minus the TWO trailing tokens `VALUE FUND`, which no existing tolerance
// covers, so the whole section stays blank.
//
// Fix in layout_broadridge.go, in the heading-to-series resolver that feeds the
// section state (the same path the `Third Ave Value Fund` heading resolves
// through): allow a heading that is an exact leading-token prefix of exactly one
// declared series name, with the remaining tokens all being type words (`VALUE`,
// `FUND`), and refuse when two declared names answer.
func TestFamilyLLL1ThirdAvenueRealEstateHeadingDropsValueFund(t *testing.T) {
	rows := familyLLL1Dispatch(t, "third_ave_real_estate_heading.txt", "broadridge", 5)
	for _, r := range rows {
		if r.SeriesID != "S000001466" {
			t.Errorf("`Third Ave Real Estate` never resolved to the declared THIRD AVENUE REAL ESTATE VALUE FUND: fund=%q issuer=%q desc=%.40q series=%q want S000001466", r.FundName, r.IssuerName, r.VoteDescription, r.SeriesID)
		}
	}
}

// Same filing, the second blank section: 11-50, 51-65, 111-124, 4873-4898,
// 9261-9264. The heading is printed verbatim:
//
//	Third Ave Small Cap
//
// against the declared name it must reach, verbatim:
//
//	<SERIES-ID>S000001465
//	<SERIES-NAME>THIRD AVENUE SMALL-CAP VALUE FUND
//
// This is the Real Estate shape plus one more difference: besides the dropped
// trailing `VALUE FUND`, the heading spells `Small Cap` as two unhyphenated
// tokens where the declared name has the single hyphenated token `SMALL-CAP`.
// A prefix rule that compares tokens without folding `-` to a space still leaves
// these 378 rows blank, so the two are separate tests on purpose.
//
// Fix in layout_broadridge.go, in the same heading-to-series resolver: normalise
// `-` to a token separator on both sides before the prefix comparison.
func TestFamilyLLL1ThirdAvenueSmallCapHeadingHyphenAndValueFund(t *testing.T) {
	rows := familyLLL1Dispatch(t, "third_ave_small_cap_heading.txt", "broadridge", 3)
	for _, r := range rows {
		if r.SeriesID != "S000001465" {
			t.Errorf("`Third Ave Small Cap` never resolved to the declared THIRD AVENUE SMALL-CAP VALUE FUND: fund=%q issuer=%q desc=%.40q series=%q want S000001465", r.FundName, r.IssuerName, r.VoteDescription, r.SeriesID)
		}
	}
}
