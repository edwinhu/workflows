package main

import (
	"path/filepath"
	"testing"
)

// 000106/1066980/0000950123-11-081606.txt: 1-10148; 24582-24605;
// 43263-43285; 61502-61537; 203561-203563, verbatim.
// The prefix keeps the labelvalue signature beyond issnpx's match window.
// The resolved 500 Stock banner prevents the chassis' all-blank consolidation
// from hiding the missing attribution of the two bare heading sections.
func TestFamilyBB1VantagepointPeriodHeadingSeries(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict, seriesMap = nil, nil
	sink := &rowSink{}
	meta := processFile("vantagepoint_period_heading.txt", filepath.Join("testdata", "family_bb1", "vantagepoint_period_heading.txt"), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "labelvalue" || meta.CIK != "0001066980" || len(sink.buf) != 22 {
		t.Fatalf("dispatch precondition: status=%s layout=%s CIK=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, meta.CIK, len(sink.buf), meta.ErrorMsg)
	}
	for _, want := range []struct {
		cusip, date, fund, series string
		rows                      int
	}{
		{"00508Y102", "20110107", "VANTAGEPOINT SELECT VALUE FUND", "S000020941", 5},
		{"H0010V101", "20110429", "VANTAGEPOINT INTERNATIONAL FUND", "S000008133", 3},
		{"88579Y101", "20110510", "THE VANTAGEPOINT 500 STOCK INDEX FUND", "S000008107", 14},
	} {
		n, wrong := 0, 0
		var first VoteRow
		for _, r := range sink.buf {
			if r.CUSIP != want.cusip || r.MeetingDate != want.date {
				continue
			}
			n++
			if r.SeriesID != want.series || r.FundName != want.fund {
				if wrong == 0 {
					first = r
				}
				wrong++
			}
		}
		if n != want.rows {
			t.Fatalf("identity precondition: CUSIP=%s date=%s rows=%d, want %d", want.cusip, want.date, n, want.rows)
		}
		if wrong > 0 {
			t.Errorf("%s: %d/%d rows have wrong attribution; first item %s fund=%q series=%q, want fund=%q series=%q", want.cusip, wrong, n, first.ItemSeq, first.FundName, first.SeriesID, want.fund, want.series)
		}
	}
}
