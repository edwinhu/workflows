package main

import "testing"

// A Vanguard filing covering several funds prints each fund's name on a FUND:
// line, and until now the layout carried that name on the row without ever
// resolving it against the header's declared series -- so a multi-series
// Vanguard filing stamped no series_id at all (299,227 rows on run64, the only
// text layout whose count did not move when the CIK dictionary landed). The
// heading resolves under the same rules every other layout uses: exact or one
// described edit, refused on ambiguity, and nothing when the header does not
// declare it.
func TestVanguardFundLineResolvesToDeclaredSeries(t *testing.T) {
	body := edgarEnvelope("0000052848", "0000932471-05-001498",
		vanguardBlockWithVote("For", "For"))

	meta := FilingMeta{FilePath: "x", SeriesDecls: []SeriesDecl{
		{SeriesID: "S000002580", Name: "VANGUARD GROWTH EQUITY FUND"},
		{SeriesID: "S000002581", Name: "VANGUARD EXPLORER FUND"},
	}}
	res := parseText([]byte(body), meta)
	if res.Meta.Layout != "vanguard" || len(res.Rows) != 1 {
		t.Fatalf("layout %q rows %d, want vanguard/1", res.Meta.Layout, len(res.Rows))
	}
	if got := res.Rows[0]; got.FundName != "VANGUARD EXPLORER FUND" || got.SeriesID != "S000002581" {
		t.Fatalf("fund %q series %q, want VANGUARD EXPLORER FUND / S000002581", got.FundName, got.SeriesID)
	}

	// Undeclared: the name stays, the series stays blank.
	res = parseText([]byte(body), FilingMeta{FilePath: "x", SeriesDecls: []SeriesDecl{
		{SeriesID: "S000002580", Name: "VANGUARD GROWTH EQUITY FUND"},
	}})
	if got := res.Rows[0]; got.SeriesID != "" || got.FundName != "VANGUARD EXPLORER FUND" {
		t.Fatalf("undeclared heading: fund %q series %q, want the name and no series", got.FundName, got.SeriesID)
	}

	// Ambiguous: two series answer to the same name; refuse rather than pick.
	res = parseText([]byte(body), FilingMeta{FilePath: "x", SeriesDecls: []SeriesDecl{
		{SeriesID: "S000000001", Name: "VANGUARD EXPLORER FUND"},
		{SeriesID: "S000000002", Name: "Vanguard Explorer Fund"},
	}})
	if got := res.Rows[0]; got.SeriesID != "" {
		t.Fatalf("ambiguous heading stamped %q, want nothing", got.SeriesID)
	}
}
