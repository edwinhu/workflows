package main

import "testing"

// The rules below extend issResolveFund for three families the 2026-09-02
// series-fill measurement placed (40.1M ISS rows carried a fund name that
// matched no declared series; 10,568 distinct names). Every rule keeps the
// matcher's discipline: it fires only for a name the header does not declare
// at all, requires exact equality after one described edit, and refuses to
// stamp on any collision. A wrong series_id moves votes between funds.
func resolve(t *testing.T, decls []SeriesDecl, registrant, banner string) string {
	t.Helper()
	ix := newISSSeriesIndex(decls, normalizeSeriesName(registrant))
	_, d := issResolveFund(ix, banner)
	if d == nil {
		return ""
	}
	return d.SeriesID
}

func TestSeriesSubAdviserClause(t *testing.T) {
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "AST GOLDMAN SACHS MULTI ASSET PORTFOLIO"},
		{SeriesID: "S2", Name: "AST GOLDMAN SACHS LARGE-CAP VALUE PORTFOLIO"},
	}
	// Prudential's AST prints the sub-adviser as a labelled clause the header
	// never carries: ~1.5M rows across five filings.
	for _, b := range []string{
		"AST Goldman Sachs Multi Asset Portfolio - Sub-Adviser: Goldman Sachs",
		"AST Goldman Sachs Multi Asset Portfolio- Subadviser: Goldman Sachs Asset Management",
		"AST Goldman Sachs Multi Asset Portfolio - Sub-Adviser:",
	} {
		if got := resolve(t, decls, "ADVANCED SERIES TRUST", b); got != "S1" {
			t.Errorf("%q -> %q, want S1", b, got)
		}
	}
}

func TestSeriesCompactSpacing(t *testing.T) {
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "ProShares Ultra Russell2000"},
		{SeriesID: "S2", Name: "ProShares Short Russell2000"},
	}
	// The banner spaces the index name the header runs together: ~600k rows.
	if got := resolve(t, decls, "PROSHARES TRUST", "ProShares Ultra Russell 2000"); got != "S1" {
		t.Errorf("got %q, want S1", got)
	}
}

func TestSeriesBrandPrefix(t *testing.T) {
	// The declared name carries the registrant's leading tokens and the banner
	// does not (Penn Series, T. Rowe Price Index Trust) ...
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "Penn Series Small Cap Index Fund"},
		{SeriesID: "S2", Name: "Penn Series Index 500 Fund"},
	}
	if got := resolve(t, decls, "PENN SERIES FUNDS INC", "Small Cap Index Fund"); got != "S1" {
		t.Errorf("declared-side brand: got %q, want S1", got)
	}
	// ... or the banner carries them and the declaration does not (USAA).
	decls = []SeriesDecl{
		{SeriesID: "S1", Name: "Extended Market Index Fund"},
		{SeriesID: "S2", Name: "S&P 500 Index Fund"},
	}
	if got := resolve(t, decls, "USAA MUTUAL FUNDS TRUST", "USAA Extended Market Index Fund"); got != "S1" {
		t.Errorf("banner-side brand: got %q, want S1", got)
	}
}

func TestSeriesRulesRefuseToGuess(t *testing.T) {
	// Two declared names that coincide once the brand is removed: ambiguous.
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "Penn Series Growth Fund"},
		{SeriesID: "S2", Name: "Penn Growth Fund"},
	}
	if got := resolve(t, decls, "PENN SERIES FUNDS INC", "Growth Fund"); got != "" {
		t.Errorf("ambiguous after brand strip: got %q, want blank", got)
	}
	// A noun swap is a different registered series and stays blank.
	decls = []SeriesDecl{{SeriesID: "S1", Name: "State Street Global All Cap Equity ex-U.S. Index Fund"}}
	decls = append(decls, SeriesDecl{SeriesID: "S2", Name: "State Street Equity 500 Index Fund"})
	if got := resolve(t, decls, "STATE STREET INSTITUTIONAL INVESTMENT TRUST", "State Street Global All Cap Equity ex-US Index Portfolio"); got != "" {
		t.Errorf("noun swap: got %q, want blank", got)
	}
	// The exact match still wins over every rule.
	decls = []SeriesDecl{
		{SeriesID: "S1", Name: "Growth Fund"},
		{SeriesID: "S2", Name: "Penn Series Growth Fund"},
	}
	if got := resolve(t, decls, "PENN SERIES FUNDS INC", "Growth Fund"); got != "S1" {
		t.Errorf("exact first: got %q, want S1", got)
	}
}
