package main

import (
	"path/filepath"
	"testing"
)

func familyDD2LincolnRow(t *testing.T, fixture, cusip, date string) VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0000914036": {
		{SeriesID: "S000002804", Name: "Managed Fund"},
		{SeriesID: "S000002804", Name: "LVIP Delaware Managed Fund"},
		{SeriesID: "S000002802", Name: "LVIP T. Rowe Price Structured Mid-Cap Growth Fund"},
		{SeriesID: "S000015975", Name: "LVIP T. Rowe Price Growth Stock Fund"},
		{SeriesID: "S000025131", Name: "LVIP Delaware Foundation(R) Conservative Allocation Fund"},
		{SeriesID: "S000025132", Name: "LVIP Delaware Foundation(R) Moderate Allocation Fund"},
		{SeriesID: "S000025133", Name: "LVIP Delaware Foundation(R) Aggressive Allocation Fund"},
	}}}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_dd2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || len(sink.buf) != 1 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	r := sink.buf[0]
	if r.CUSIP != cusip || r.MeetingDate != date || r.HowVoted == "" {
		t.Fatalf("identity/vote precondition: CUSIP=%q date=%q vote=%q", r.CUSIP, r.MeetingDate, r.HowVoted)
	}
	return r
}

// 000091/914036/0001193125-09-181138.txt: 25-26, 65-66, 78-79,
// 429, 435, 91213-91216, 91236-91296, 91692 (74 verbatim lines).
// Declared siblings prevent dictionary backfill from masking the full-file defect.
func TestFamilyDD2LincolnManagedHeading(t *testing.T) {
	r := familyDD2LincolnRow(t, "lincoln_managed.txt", "000360206", "20090519")
	if r.SeriesID != "S000002804" {
		t.Errorf("Lincoln Managed Fund: CUSIP=%s fund=%q series=%q want S000002804", r.CUSIP, r.FundName, r.SeriesID)
	}
}

// Same filing: 25-26, 1152732-1152735, 1152753-1152806,
// 1153210 (61 verbatim lines).
func TestFamilyDD2LincolnPetersTRPHeading(t *testing.T) {
	r := familyDD2LincolnRow(t, "lincoln_peters_trp.txt", "004930202", "20080708")
	if r.SeriesID != "S000002802" {
		t.Errorf("Peters - Lincoln VIP TRP Structured Mid-Cap Growth Fund: CUSIP=%s fund=%q series=%q want S000002802", r.CUSIP, r.FundName, r.SeriesID)
	}
}

// Same filing: 25-26, 148182-148185, 148205-148265,
// 148611 (68 verbatim lines).
func TestFamilyDD2LincolnTruncatedAllocationHeading(t *testing.T) {
	r := familyDD2LincolnRow(t, "lincoln_truncated_allocation.txt", "Y4804V104", "20090630")
	if r.SeriesID != "S000025131" {
		t.Errorf("LVIP DEL CONS ALLOCA: CUSIP=%s fund=%q series=%q want S000025131", r.CUSIP, r.FundName, r.SeriesID)
	}
}
