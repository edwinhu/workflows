package main

import (
	"path/filepath"
	"testing"
)

// familyLL2Dispatch runs the real dispatch on a family LL.2 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyLL2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ll2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ll2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000070/703499/0001193125-10-184585.txt: header 25-26, 57-98 and body
// 44062-44200. The section heading is one <TD> holding TWO <P> paragraphs --
// `<P ...>Wright&nbsp;Major</FONT></P> <P ...>Blue Chip\nEquities&nbsp;Fund</P>`
// -- so normalization yields two lines and htmlBareFundLine reads only the
// second. "Blue Chip Equities Fund" is a suffix of all THREE declared series, so
// the tolerant lookup refuses it on collision and the section is left
// unattributed. 942 rows of the filing's Wright Major section carry no series
// (measured on the full file, 2026-09-08: 2,979 rows, 2,201 with no series, of
// which 1,259 are the headingless first section and 942 this one).
//
// In the cut the unattributed rows are stamped with the consolidated three-id
// list, because consolidatedSeries widens a filing in which NO row is labelled;
// in the whole filing the Selected section is labelled, so the same rows carry
// an empty series_id. Either way the heading was never read.
func TestFamilyLL2WrightSplitHeadingCell(t *testing.T) {
	rows := familyLL2Dispatch(t, "wright_split_heading_cell.txt", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000009483" {
			t.Errorf("Wright Major Blue Chip Equities Fund: fund=%q series=%q want S000009483", r.FundName, r.SeriesID)
		}
	}
}

// 000149/1498498/0001193125-12-377283.txt: header 15-16, 142-190 and body
// 147414-148600. The Small-Cap Equity Fund section resolves; the "Vote Summary
// Report" block that follows it opens with the report's own parameter lines --
// `Vote Summary Report`, `Report was run from: 7/1/11 to 6/30/12`,
// `Location(s): All locations` -- and the second of those is taken for a fund
// heading, so it overwrites the section fund and every row of the block carries
// it as fund_name with no series. 2,199 of the filing's 2,255 rows.
func TestFamilyLL2AshmoreVoteSummaryBanner(t *testing.T) {
	rows := familyLL2Dispatch(t, "ashmore_vote_summary_banner.txt", "htmltable", 15)
	for _, r := range rows {
		if r.SeriesID != "S000033753" {
			t.Errorf("Ashmore Emerging Markets Small-Cap Equity Fund: fund=%q series=%q want S000033753", r.FundName, r.SeriesID)
		}
	}
}

// 000135/1355064/0001580642-19-003959.txt: header 15-16, 45-436 and body
// 6100-6240. The banner row is the registrant/label/value shape
// htmlLabelledCells already drops the registrant cell for --
// `Registrant:  Mutual Fund Series Trust` | `Fund Name - ` | `Eventide Gilead
// Fund` -- but this vintage prints a FOURTH cell after the value, `Item 1`. Four
// non-empty cells fall through the len(vals) != 2 bail and no heading is read.
// Every banner in the filing carrying that cell fails and every banner without
// it resolves: 1,359 of 3,340 rows carry no series.
func TestFamilyLL2CatalystItem1BannerCell(t *testing.T) {
	rows := familyLL2Dispatch(t, "catalyst_item1_banner_cell.txt", "htmltable", 8)
	for _, r := range rows {
		if r.SeriesID != "S000022598" {
			t.Errorf("Eventide Gilead Fund: fund=%q series=%q want S000022598", r.FundName, r.SeriesID)
		}
	}
}
