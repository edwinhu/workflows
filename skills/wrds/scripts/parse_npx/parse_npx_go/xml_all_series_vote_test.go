package main

import (
	"strings"
	"testing"
)

// The 2024 XML form omits <voteSeries> when a vote applies to every series the
// report covers; only a vote cast differently for one series names it. Natixis
// Funds Trust IV 2024 (0001438934-24-000582): 12 series in the report, 7,127
// of 59,609 proxy tables carry a voteSeries, the rest carried nothing and
// 435,489 such rows across 90 multi-series XML filings had no series on run71.
// A vote with no series in a multi-series report is every series, stamped
// MultiValueSep-joined as the text layouts' consolidated filings are; a vote
// naming its series keeps it; a single-series report is the chassis's business.
func TestXMLVoteWithoutSeriesInMultiSeriesReportStampsAll(t *testing.T) {
	primary := strings.Replace(npxPrimaryDoc,
		"<seriesClass>\n<seriesId>S000002841</seriesId>\n<classId>C000007786</classId>\n</seriesClass>",
		"<seriesClass>\n<seriesId>S000002841</seriesId>\n<classId>C000007786</classId>\n</seriesClass>\n"+
			"<seriesClass>\n<seriesId>S000002842</seriesId>\n<classId>C000007790</classId>\n</seriesClass>", 1)
	if primary == npxPrimaryDoc {
		t.Fatal("fixture did not gain a second series")
	}
	// one proxyTable naming its series, one without
	bare := strings.ReplaceAll(npxVoteDoc, "<voteSeries>S000002841</voteSeries>\n", "")
	if bare == npxVoteDoc {
		t.Fatal("fixture still names the series")
	}
	rows, _ := collectXML(t, npxSGMLHead+primary+npxVoteDoc)
	for _, r := range rows {
		if r.SeriesID != "S000002841" {
			t.Errorf("named series: series_id %q, want S000002841", r.SeriesID)
		}
	}
	rows, _ = collectXML(t, npxSGMLHead+primary+bare)
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r.SeriesID != "S000002841"+MultiValueSep+"S000002842" {
			t.Errorf("unnamed series: series_id %q, want both series", r.SeriesID)
		}
	}
	// a single-series report leaves the row for the chassis
	rows, _ = collectXML(t, npxSGMLHead+npxPrimaryDoc+bare)
	for _, r := range rows {
		if r.SeriesID != "" {
			t.Errorf("single-series report: series_id %q, want blank", r.SeriesID)
		}
	}
}
