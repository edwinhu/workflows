package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 000079/790558/0000950135-07-005429.txt (HARTFORD HLS SERIES FUND II INC,
// CIK 790558, period 20070630, layout broadridge, 6,903 rows, 3,085 of them
// with no series): verbatim source lines 11140-11462, one contiguous cut, no
// seams and nothing added.
//
// WHERE THE BLANKS COME FROM. The layout that claims this filing is
// broadridge, and the icr blocks it steps over are read by icrSupplement
// (text_parser.go:508), which runs parseICR over the whole body. Measured on
// HEAD with no dictionary and no overlay loaded, the run over the real filing
// reads:
//
//	943  S000004106 is never emitted   Hartford Growth Opportunities HLS Fund
//	...
//	1741  series=""  fund="Mgmt Rec - Company Management Recommended Vote  Page 3"
//	1265  series=""  fund="11  Ratification of Auditor  Mgmt  For  Against  Against"
//	  79  series=""  fund="respect to which the registrant exercised its voting rights."
//
// 1741+1265+79 = 3,085, which is the whole of this filing's contribution to
// LOST_BASE. The fund names are page-footer and table-row fragments: parseICR
// has no fund at all across this span and is naming it from whatever text last
// looked like a heading.
//
// THE MARKER THE GRAMMAR DOES NOT KNOW. This filing prints its fund heading
// under an `ITEM 1: PROXY VOTING RECORD` line -- source lines 11423/11425,
// 15222/15224, 22675/22677, three sections, one fund named under each. Every
// marker parseICR recognises (layout_icr.go:520-609) is a LABEL, a rule of
// underscores, an `Investment Company Report` line, a `=====` banner or a
// reporting-period line. `ITEM 1: PROXY VOTING RECORD` is none of them, so
// line 11425 is read as ordinary text and curSeries stays where the broadridge
// section above left it -- which is nowhere.
//
// WHICH IS WHY THIS IS RECOVERABLE, AND WHY THE SERIES IS NOT IN DOUBT. The
// heading line is
//
//	Hartford LargeCap Growth HLS Fund
//
// and the filing's OWN SGML header declares `<SERIES-ID>S000004106` /
// `<SERIES-NAME>HARTFORD LARGECAP GROWTH HLS FUND` (source lines 133-134).
// icrResolveFundShared answers S000004106 for that string today, on HEAD, with
// no dictionary and no overlay: the resolver is not the failure, the marker is.
// The same fund opened this chapter forty lines earlier under its broadridge
// banner (`HARTFORD LARGECAP GROWTH HLS FUND`, source line 11145), so the ICR
// block at 11423 is a sub-adviser tranche of an already-declared fund and not a
// new one -- `This portion sub-advised by Hartford Investment Management
// Company` (source line 11427) names a manager, not a registrant series.
//
// ONE FUND, NOT TWO. The cut stops at source line 11462, the end of the ABBOTT
// LABORATORIES INC meeting. The next `ITEM 1: PROXY VOTING RECORD` is 3,760
// lines later at 15222, so nothing in these bytes can belong to any fund but
// S000004106 and the assertion below is not a guess at which of several
// headings governs.
//
// The 16 rows are the whole of what parseICR may read out of these bytes: the
// broadridge VOTE SUMMARY REPORT table the cut opens with is not its grammar,
// and the only meeting it reaches is Abbott's.
func TestFamilyNS790558SubadviserContinuation(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	// Verbatim from the filing's own SGML header, source lines 63-188. No
	// dictionary and no overlay is loaded: the blank series is not a resolution
	// failure and nothing here depends on one.
	meta := FilingMeta{
		CIK:            "0000790558",
		CompanyName:    "HARTFORD HLS SERIES FUND II INC",
		PeriodOfReport: "20070630",
		SeriesDecls: []SeriesDecl{
			{SeriesID: "S000004101", Name: "HARTFORD BLUE CHIP STOCK HLS FUND"},
			{SeriesID: "S000004102", Name: "HARTFORD VALUE OPPORTUNITIES HLS FUND"},
			{SeriesID: "S000004103", Name: "HARTFORD CAPITAL OPPORTUNITIES HLS FUND"},
			{SeriesID: "S000004104", Name: "HARTFORD GROWTH OPPORTUNITIES HLS FUND"},
			{SeriesID: "S000004105", Name: "HARTFORD INTERNATIONAL STOCK HLS FUND"},
			{SeriesID: "S000004106", Name: "HARTFORD LARGECAP GROWTH HLS FUND"},
			{SeriesID: "S000004107", Name: "HARTFORD MIDCAP GROWTH HLS FUND"},
			{SeriesID: "S000004108", Name: "HARTFORD SMALLCAP GROWTH HLS FUND"},
			{SeriesID: "S000004109", Name: "HARTFORD SMALLCAP VALUE HLS FUND"},
			{SeriesID: "S000004110", Name: "HARTFORD U.S. GOVERNMENT SECURITIES HLS FUND"},
		},
	}

	dir := filepath.Join("testdata", "family_ns790558_subadviser_continuation")
	b, err := os.ReadFile(filepath.Join(dir, "hls2007_largecap_growth_subadviser_continuation.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows, err := parseICR(string(stripHTML(b)), meta)
	if err != nil {
		t.Fatal(err)
	}

	if len(rows) != 16 {
		t.Fatalf("fixture guard: parseICR read %d rows out of these bytes, want 16 -- the ABBOTT LABORATORIES INC meeting at source lines 11429-11462 is the only one it can reach; the cut is broken, not the grammar", len(rows))
	}
	for _, r := range rows {
		// The control: if the meeting itself stops reading, the cut is broken.
		if r.IssuerName != "ABBOTT LABORATORIES INC" || r.CUSIP != "002824100" || r.MeetingDate != "20070427" {
			t.Fatalf("fixture guard: the Abbott block stopped reading: item=%q issuer=%q cusip=%q date=%q", r.ItemSeq, r.IssuerName, r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000004106" {
			t.Errorf("item %q: series=%q fund=%q, want series S000004106 -- the `ITEM 1: PROXY VOTING RECORD` marker at source line 11423 names `Hartford LargeCap Growth HLS Fund` on line 11425, an exact match to the header's own <SERIES-NAME> for S000004106, and line 11427 names a sub-adviser of that same fund rather than a new one",
				r.ItemSeq, r.SeriesID, r.FundName)
		}
	}
}
