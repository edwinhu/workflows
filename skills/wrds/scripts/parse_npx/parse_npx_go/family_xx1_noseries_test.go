package main

import (
	"path/filepath"
	"testing"
)

// familyXX1Dispatch runs the real dispatch on a family XX.1 fixture with the
// registrant's own series dictionary loaded.
func familyXX1Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_xx1", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_xx1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000112/1122649/0001122649-04-000005.txt: 15-26, 112-131. Hillman Capital
// Management Investment Trust's 2004 N-PX declares no series in its header and
// is backed by the dictionary. The filing DOES print a per-fund heading for
// each of its two sections -- `THE HILLMAN TOTAL RETURN FUND` (lines 120-121)
// and `THE HILLMAN AGGRESSIVE EQUITY FUND` (lines 695-696)
// -- but each heading is immediately underlined by a dashed rule rather than
// followed by a blank line:
//
//	THE HILLMAN TOTAL RETURN FUND
//	- -----------------------------
//
// parsePVText's bare-heading branch (layout_pvtext.go:143) requires the line
// AFTER the candidate to be blank, so the rule disqualifies the heading and the
// series index is never consulted for it. All 729 rows of the filing carry a
// blank fund name and a blank series.
//
// The dictionary rows are the registrant's own EDGAR series declarations:
// S000010500/S000010501 with the names cik_series.tsv carries for CIK 1122649,
// plus `The Hillman Total Return Fund` for S000010500, which is that fund's
// name as declared in the registrant's own header in
// 000112/1122649/0001122649-06-000010.txt (lines 82-84) -- the name the 2004
// filing prints, and the same id the later `Advantage Equity` name carries.
func TestFamilyXX1HillmanRuleUnderHeading(t *testing.T) {
	rows := familyXX1Dispatch(t, "hillman_rule_under_heading.txt", "hillman_dict.tsv", "pvtext", 5)
	for _, r := range rows {
		if r.SeriesID != "S000010500" {
			t.Errorf("THE HILLMAN TOTAL RETURN FUND: fund=%q issuer=%q item=%q series=%q want S000010500", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
