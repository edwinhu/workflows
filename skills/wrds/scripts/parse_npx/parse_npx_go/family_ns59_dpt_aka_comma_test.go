package main

import (
	"path/filepath"
	"testing"
)

// familyNS59Dispatch runs the real dispatch on a family NS59 fixture and
// asserts the fixture's own preconditions -- status, layout and row count --
// so a failure below is an assertion about the series id and never a broken
// fixture. The fixture declares its series in its OWN SGML header, so no
// dictionary rows are loaded: `cikDict` and `seriesMap` are both cleared.
func familyNS59Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns59", fixture), sink, make([]byte, headBytes))
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

func TestFamilyNS59DPTRealEstateAKACommaMarker(t *testing.T) {
	rows := familyNS59Dispatch(t, "dpt_reit_aka_comma_2014.txt", "issnpx", 11)
	for _, r := range rows {
		if r.SeriesID != "S000003937" {
			t.Errorf("the banner's alias parenthetical prints `(a/k/a, Delaware REIT Fund)` -- a COMMA after the marker -- and `DELAWARE REIT FUND` is declared in this filing's own SGML header: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want S000003937",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
