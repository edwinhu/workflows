package main

import "testing"

// A sleeve or account code printed before the fund name: `2DCN Emerging Markets
// Value Fund`, `3347 JHFII Emerging Markets Fund`, `(ZW4X) Total Return Blackrock
// ACWI xUS Index` (John Hancock Funds II, JHVIT, GE Investments: the largest
// unmatched-heading blocks on run65). The code is 2-6 letters or digits with at
// least one digit, or a parenthesised code; the rest resolves under the ordinary
// rules, and an ambiguous rest still stamps nothing.
func TestSeriesLeadingCodeToken(t *testing.T) {
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "Emerging Markets Value Fund"},
		{SeriesID: "S2", Name: "Total Return Blackrock ACWI xUS Index"},
		{SeriesID: "S3", Name: "International Equity Index Trust B"},
	}
	for banner, want := range map[string]string{
		"2DCN Emerging Markets Value Fund":             "S1",
		"(ZW4X) Total Return Blackrock ACWI xUS Index": "S2",
		"ZW4X Total Return Blackrock ACWI xUS Index":   "S2",
		"3347 International Equity Index Trust B":      "S3",
		// A plain word is never a code: `Value Fund` must not lose `Emerging`.
		"Emerging Markets Value Fund":        "S1",
		"Growth Emerging Markets Value Fund": "",
	} {
		if got := resolve(t, decls, "JOHN HANCOCK FUNDS II", banner); got != want {
			t.Errorf("%q -> %q, want %q", banner, got, want)
		}
	}
	decls = []SeriesDecl{
		{SeriesID: "S1", Name: "Growth Fund"},
		{SeriesID: "S2", Name: "growth fund"},
	}
	if got := resolve(t, decls, "SOME TRUST", "2A32 Growth Fund"); got != "" {
		t.Errorf("ambiguous rest after the code stamped %q", got)
	}
}

// A trademark mark spelled as a bare token: `ING Russell TM Small Cap Index
// Portfolio` declared, `ING RUSSELL(TM) SMALL CAP INDEX PORTFOLIO` printed
// (ING Partners 2011, 14k rows). Both fold to the same name.
func TestSeriesBareTrademarkToken(t *testing.T) {
	a := normalizeSeriesName("ING RUSSELL(TM) SMALL CAP INDEX PORTFOLIO")
	b := normalizeSeriesName("ING Russell TM Small Cap Index Portfolio")
	c := normalizeSeriesName("ING Russell Small Cap Index Portfolio")
	if a != b || b != c {
		t.Errorf("fold: %q / %q / %q", a, b, c)
	}
	if normalizeSeriesName("TM Growth Fund") == normalizeSeriesName("Growth Fund") {
		t.Error("a leading TM that could be a brand must not be dropped")
	}
}

// A heading naming a series the SAME registrant declared in another filing but
// not in this one (Xtrackers, SPDR, iShares: 370k rows in run65's top 60). The
// header stays the authority for what it declares; a heading it does not know
// may still be stamped when it equals, EXACTLY, one dictionary name of that CIK.
func TestDictionaryExactFallbackForUndeclaredHeading(t *testing.T) {
	d := &cikSeries{byCIK: map[string][]SeriesDecl{"1503123": {
		{SeriesID: "S000000001", Name: "Xtrackers Russell 1000 Comprehensive Factor ETF"},
		{SeriesID: "S000000002", Name: "Xtrackers MSCI ACWI ex USA ESG Leaders Equity ETF"},
		{SeriesID: "S000000003", Name: "Xtrackers Dup Fund"},
		{SeriesID: "S000000004", Name: "XTRACKERS DUP FUND"},
	}}}
	meta := FilingMeta{CIK: "1503123", SeriesDecls: []SeriesDecl{{SeriesID: "S000000001", Name: "Xtrackers Russell 1000 Comprehensive Factor ETF"}}}
	fb := d.exactFallback(meta)

	r := VoteRow{FundName: "Xtrackers MSCI ACWI ex USA ESG Leaders Equity ETF"}
	fb.apply(&r)
	if r.SeriesID != "S000000002" {
		t.Fatalf("exact dictionary name: got %q want S000000002", r.SeriesID)
	}
	r = VoteRow{FundName: "Xtrackers MSCI ACWI ex USA ESG Leaders Equity"}
	fb.apply(&r)
	if r.SeriesID != "" {
		t.Fatalf("one edit away is not exact: got %q", r.SeriesID)
	}
	r = VoteRow{FundName: "Xtrackers Dup Fund"}
	fb.apply(&r)
	if r.SeriesID != "" {
		t.Fatalf("two dictionary series under one name must refuse: got %q", r.SeriesID)
	}
	r = VoteRow{FundName: "Xtrackers MSCI ACWI ex USA ESG Leaders Equity ETF", SeriesID: "S000000009"}
	fb.apply(&r)
	if r.SeriesID != "S000000009" {
		t.Fatalf("a series already set must stand: got %q", r.SeriesID)
	}
	var none *cikSeries
	if fb := none.exactFallback(meta); fb != nil {
		t.Fatal("no dictionary must yield no fallback")
	}
}
