package main

import "testing"

// SunAmerica Series Trust 2005 (0000950129-05-008755): the pvtext heading is
// `JU77 Alliance Growth Portfolio`, an account code before the dictionary's
// `Alliance Growth Portfolio`. The dictionary fallback reads past the code the
// way the header rules do; a plain first word is never a code.
func TestDictFallbackReadsPastALeadingAccountCode(t *testing.T) {
	d := &cikSeries{byCIK: map[string][]SeriesDecl{
		"0000892538": {{SeriesID: "S000008081", Name: "Alliance Growth Portfolio"}, {SeriesID: "S000008099", Name: "Emerging Markets Portfolio"}},
	}}
	fb := d.exactFallback(FilingMeta{CIK: "0000892538"})
	r := VoteRow{FundName: "JU77 Alliance Growth Portfolio"}
	fb.apply(&r)
	if r.SeriesID != "S000008081" {
		t.Fatalf("coded heading: got %q, want S000008081", r.SeriesID)
	}
	r = VoteRow{FundName: "Growth Emerging Markets Portfolio"}
	fb.apply(&r)
	if r.SeriesID != "" {
		t.Fatalf("plain first word is not a code: got %q", r.SeriesID)
	}
}
