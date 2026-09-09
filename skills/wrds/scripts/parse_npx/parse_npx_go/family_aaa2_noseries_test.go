package main

import (
	"path/filepath"
	"testing"
)

// familyAAA2Dispatch runs the real dispatch on a family AAA no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when the
// fixture needs one.
func familyAAA2Dispatch(t *testing.T, dir, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", dir, dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", dir, fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000185/1852344/0001193125-23-202408.txt: 1-160, 40390-40523, 41171-41194.
// Multi-Select Securities Fund for Puerto Rico Residents declares six series in
// its SGML header, one of them `Large Cap Growth Portfolio I` (S000074347) and
// another `International Portfolio I` (S000074350). Five of the six sections
// print their fund banner on one line, which resolves. The Large Cap Growth
// section prints its banner WRAPPED over two <P> elements:
//
//	<P STYLE="margin-top:0pt; margin-bottom:0pt; font-size:10pt; font-family:Times New Roman"><B>Large Cap Growth </B></P>
//	<P STYLE="margin-top:0pt; margin-bottom:0pt; font-size:10pt; font-family:Times New Roman"><B>Portfolio I </B></P> <P STYLE="font-size:12pt;margin-top:0pt;margin-bottom:0pt">&nbsp;</P>
//	<TABLE CELLSPACING="0" ... >
//	...
//	<TD VALIGN="top">Linde Plc</TD>
//	<TD VALIGN="top">LIN</TD>
//	<TD VALIGN="top">07/25/2022</TD>
//	<TD VALIGN="top">G5494J103</TD>
//	<TD VALIGN="top">1a</TD>
//	<TD VALIGN="top">Elect Director Stephen F. Angel</TD>
//
// The heading reader keeps only the SECOND line, so the banner it resolves is
// the bare tail `Portfolio I` — which is a suffix of every one of the six
// declared names and lands on `International Portfolio I`. All 709 rows of the
// Large Cap Growth section carry fund_name `Portfolio I` and series_id
// S000074350, the wrong fund. The cover page immediately above prints the whole
// name on one line (`<B>Large Cap Growth Portfolio I </B>`) and is overwritten
// by the wrapped tail rather than kept.
func TestFamilyAAA2MSSPuertoRicoWrappedGrowthHeading(t *testing.T) {
	rows := familyAAA2Dispatch(t, "family_aaa2", "mss_pr_wrapped_growth_heading.txt", "", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000074347" {
			t.Errorf("wrapped `Large Cap Growth` / `Portfolio I` banner: fund=%q issuer=%q item=%q series=%q want S000074347", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
