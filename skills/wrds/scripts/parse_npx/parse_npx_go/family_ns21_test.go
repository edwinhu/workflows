package main

import (
	"path/filepath"
	"testing"
)

// familyNS21Dispatch runs the real dispatch on a family NS21 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS21Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns21", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns21", fixture), sink, make([]byte, headBytes))
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

// 000090/909221/0001438934-15-000388.txt: verbatim source lines 1-19 (the SEC
// header through the CIK), 49-50 (the series-data openers), 160-194 (the
// `S000047318` and `S000047319` `<SERIES>` blocks, the header closers and the
// document opener through `<TEXT>`), 225-228 (the `<PAGE>` and the
// `<TABLE>`/`<S>` opener), 4067-4068 (the `Global Allocation` banner and its
// rule -- the contrast), 21817-21833 and 21849-21877 (the tail of that
// section's YAMATO block, then the `Income Builder` banner, the two prose
// lines beneath it and the ADMIRAL GROUP meeting block) and the filing's own
// last three lines. Every byte is verbatim. Dispatches to `broadridge` (the
// precondition asserts it).
//
// JPMorgan Insurance Trust, period 20150630, `broadridge`. Measured on the
// current tree with the full 41,139-row dictionary:
//
//	=== 000090/909221/0001438934-15-000388.txt layout=broadridge status=ok rows=16996 blank=2509
//	    2509 blank "have any securities that were subject to a vote during the reporting period."
//
// All 2,509 blank rows of the filing carry that sentence as their fund name.
// The registrant prints ELEVEN portfolio banners, each on its own line above a
// rule. Ten are followed directly by the rule; the eleventh, source line 21856,
// is followed by two lines of prose before it:
//
//	JPMorgan Insurance Trust Income Builder Portfolio
//	The fund held no voting securities during the reporting period and did not vote any securities or
//	have any securities that were subject to a vote during the reporting period.
//	--------------------------------------------------------------------------------------------------------------------------
//	 ADMIRAL GROUP PLC, CARDIFF                                                                  Agenda Number:  705932588
//
// (Contrast source lines 238-241, where the same prose is INDENTED by one space
// and the rule comes first, and the layout reads the banner correctly.) The
// layout takes the last unindented line above the rule as the banner, so the
// sentence's second line becomes the fund name and the section's 2,509 rows are
// blank.
//
// PROBED, not judged by eye. Handed the heading the bytes actually print, the
// existing chain answers it with no new rung:
//
//	icrResolveFundShared("JPMorgan Insurance Trust Income Builder Portfolio") -> "S000047319"
//	icrResolveFundShared("have any securities that were subject to a vote during the reporting period.") -> ""
//
// Measured on the fixture, the contrast section keeps its own series and only
// the Income Builder section is blank:
//
//	fund="JPMorgan Insurance Trust Global Allocation Portfolio" cusip="J96612114" series="S000047318"
//	fund="have any securities that were subject to a vote during the reporting period." cusip="G0110T106" series=""
//
// The filing's own SGML header declares it, source lines 175-176 verbatim:
//
//	<SERIES-ID>S000047319
//	<SERIES-NAME>JPMorgan Insurance Trust Income Builder Portfolio*
//
// and `cik_series.tsv` carries the clean spelling a year later:
//
//	0000909221	S000047319	JPMorgan Insurance Trust Income Builder Portfolio	20160630
//
// Fix location: `layout_broadridge.go`, the fund-banner reader -- a banner line
// followed by unindented continuation prose before the rule must keep the
// banner, not the last prose line.
func TestFamilyNS21JPMorganIncomeBuilderBannerLostToProse(t *testing.T) {
	rows := familyNS21Dispatch(t, "jpmit_income_builder.txt", "jpmit_dict.tsv", "broadridge", 5)
	for _, r := range rows {
		if r.CUSIP != "G0110T106" {
			continue
		}
		if r.SeriesID != "S000047319" {
			t.Errorf("the banner was lost to the prose beneath it: fund=%q issuer=%q cusip=%q item=%q desc=%q series=%q want S000047319",
				r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
