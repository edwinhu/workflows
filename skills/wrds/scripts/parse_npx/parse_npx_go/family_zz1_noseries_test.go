package main

import (
	"path/filepath"
	"testing"
)

// familyZZDispatch runs the real dispatch on a family ZZ no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when the
// fixture needs one.
func familyZZDispatch(t *testing.T, dir, fixture, dict, layout string, count int) []VoteRow {
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

// 000108/1088323/0001162044-25-000783.txt: 14-16, 40-45, 61-65, 71-82, 108,
// 133-142, 150-184 and the file's last five lines. Forester Funds Inc's 2025
// N-PX declares TWO series in its SGML header (S000004887 Forester Value Fund,
// S000011996 Forester Discovery Fund), so the chassis's single-series stamp
// never fires. primary_doc.xml then says the report covers exactly one of them:
//
//	<seriesPage>
//	  <seriesCount>1</seriesCount>
//	  <seriesDetails>
//	    <seriesReports>
//	      <idOfSeries>S000004887</idOfSeries>
//
// parsePrimaryDoc registers that id (xml_parser.go:652), but no proxyTable in
// proxytable.xml carries <voteSeries>, and emitRows only fans a series-less
// record out over the registry when `len(classes) >= 2` (xml_parser.go:533).
// With a registry of exactly one series the branch is skipped and the id the
// filing states on its own cover page is dropped. All 564 rows of the filing
// leave series_id blank.
func TestFamilyZZ1ForesterSeriesPageSingleSeries(t *testing.T) {
	rows := familyZZDispatch(t, "family_zz1", "forester_seriespage_single.txt", "", "", 1)
	for _, r := range rows {
		if r.SeriesID != "S000004887" {
			t.Errorf("proxyTable with no voteSeries: issuer=%q series=%q want the seriesPage's sole declared series S000004887", r.IssuerName, r.SeriesID)
		}
	}
}
