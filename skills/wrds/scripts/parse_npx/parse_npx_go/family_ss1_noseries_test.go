package main

import (
	"path/filepath"
	"testing"
)

// familySS1Dispatch runs the real dispatch on a family SS.1 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familySS1Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ss1", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ss1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000077/778202/0000935069-04-001339.txt: 13778-13806. This 2004 filing prints
// its funds under the historical ARMADA brand; the dictionary carries them under
// the later ALLEGIANT and PNC brands, and the brand swap resolves only when the
// heading also carries the trailing type word. Six of eight residue headings drop
// it -- `ARMADA LARGE CAP VALUE` for the dictionary's `ALLEGIANT LARGE CAP VALUE
// FUND` -- and `ARMADA LARGE CAP VALUE FUND` resolves to S000001188 while the
// printed heading resolves to nothing. 5,588 rows across the six headings.
func TestFamilySS1ArmadaHeadingDropsFund(t *testing.T) {
	rows := familySS1Dispatch(t, "armada_heading_drops_fund.txt", "issnpx", 17)
	for _, r := range rows {
		if r.SeriesID != "S000001188" {
			t.Errorf("ARMADA LARGE CAP VALUE: fund=%q series=%q want S000001188", r.FundName, r.SeriesID)
		}
	}
}

// 000102/1025870/0000894189-04-001792.txt: 1266-1290. This registrant's headings
// are the marketing names: the capitalization token is printed unspaced and the
// strategy word stands where the declared name carries its type word. `BRAZOS
// MIDCAP GROWTH` is the dictionary's `Brazos Mid Cap Portfolio` (S000005275) --
// its siblings `BRAZOS SMALL CAP` and `BRAZOS MICRO CAP` resolve because they
// print neither edit, and `BRAZOS MID CAP` resolves while `BRAZOS MIDCAP GROWTH`
// does not. 462 rows.
func TestFamilySS1BrazosMidcapCompactHeading(t *testing.T) {
	rows := familySS1Dispatch(t, "brazos_midcap_compact_heading.txt", "issnpx", 8)
	for _, r := range rows {
		if r.SeriesID != "S000005275" {
			t.Errorf("BRAZOS MIDCAP GROWTH: fund=%q series=%q want S000005275", r.FundName, r.SeriesID)
		}
	}
}
