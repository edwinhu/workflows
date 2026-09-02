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

func TestSeriesTrailingParenthetical(t *testing.T) {
	// A sleeve or a former name in parentheses, on the banner side ...
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "AST ACADEMIC STRATEGIES ASSET ALLOCATION PORTFOLIO"},
		{SeriesID: "S2", Name: "AST Core Fixed Income Portfolio"},
	}
	for _, b := range []string{
		"AST Academic Strategies Asset Allocation Portfolio (Core Plus) - Subadviser: PGIM Fixed Income",
		"AST Academic Strategies Asset Allocation Portfolio  (ETF & Futures Overlay) - Subadviser: QMA LLC",
		"AST Academic Strategies Asset Allocation Portfolio (International Core)",
	} {
		if got := resolve(t, decls, "ADVANCED SERIES TRUST", b); got != "S1" {
			t.Errorf("%q -> %q, want S1", b, got)
		}
	}
	// ... or on the declared side.
	decls = []SeriesDecl{
		{SeriesID: "S1", Name: "Victory 500 Index Fund (Formerly USAA 500 Index Fund)"},
		{SeriesID: "S2", Name: "Victory Nasdaq-100 Index Fund (Formerly USAA Nasdaq-100 Index Fund)"},
	}
	if got := resolve(t, decls, "VICTORY PORTFOLIOS III", "Victory 500 Index Fund"); got != "S1" {
		t.Errorf("declared-side parenthetical: got %q, want S1", got)
	}
	// Two series that differ only inside the parentheses stay apart.
	decls = []SeriesDecl{
		{SeriesID: "S1", Name: "Growth Fund (Institutional)"},
		{SeriesID: "S2", Name: "Growth Fund (Retail)"},
	}
	if got := resolve(t, decls, "SOME TRUST", "Growth Fund"); got != "" {
		t.Errorf("parenthetical is the whole difference: got %q, want blank", got)
	}
}

func TestSeriesRegistrantAcronymBrand(t *testing.T) {
	// SEI Institutional Investments Trust declares "SIIT Dynamic Asset
	// Allocation Fund" and prints "Dynamic Asset Allocation Fund"; the College
	// Retirement Equities Fund declares "Stock Account" and prints "CREF STOCK
	// ACCOUNT". The brand is the registrant's own initials.
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "SIIT Dynamic Asset Allocation Fund"},
		{SeriesID: "S2", Name: "SIIT S&P 500 Index Fund"},
	}
	if got := resolve(t, decls, "SEI INSTITUTIONAL INVESTMENTS TRUST", "Dynamic Asset Allocation Fund"); got != "S1" {
		t.Errorf("declared-side acronym: got %q, want S1", got)
	}
	decls = []SeriesDecl{
		{SeriesID: "S1", Name: "Stock Account"},
		{SeriesID: "S2", Name: "Bond Market Account"},
	}
	if got := resolve(t, decls, "COLLEGE RETIREMENT EQUITIES FUND", "CREF STOCK ACCOUNT"); got != "S1" {
		t.Errorf("banner-side acronym: got %q, want S1", got)
	}
	// A missing last word is supplied only by the common-suffix rule, which
	// applies here because every declared name ends in "Account"; see
	// TestSeriesCommonSuffixWord for the case where it must not.
	if got := resolve(t, decls, "COLLEGE RETIREMENT EQUITIES FUND", "CREF Bond Market"); got != "S2" {
		t.Errorf("missing word under a common suffix: got %q, want S2", got)
	}
}

func TestSeriesDashSleeve(t *testing.T) {
	// A sleeve or sub-adviser after a dash, unlabelled; the head is declared.
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "State Street Total Return V.I.S. Fund"},
		{SeriesID: "S2", Name: "State Street U.S. Equity V.I.S. Fund"},
	}
	for _, b := range []string{
		"State Street Total Return V.I.S. Fund - ACWI xUS Index",
		"State Street Total Return V.I.S. Fund - Small Cap Equity",
	} {
		if got := resolve(t, decls, "STATE STREET VARIABLE INSURANCE SERIES FUNDS INC", b); got != "S1" {
			t.Errorf("%q -> %q, want S1", b, got)
		}
	}
	decls = []SeriesDecl{
		{SeriesID: "S1", Name: "International Equity Fund"},
		{SeriesID: "S2", Name: "Small Cap Fund"},
	}
	if got := resolve(t, decls, "SOME TRUST", "International Equity Fund - AQR Capital Management, LLC"); got != "S1" {
		t.Errorf("unlabelled sub-adviser: got %q, want S1", got)
	}
	// The tail is declared and the head is not: `Variable Trust - Amerigo Fund`.
	decls = []SeriesDecl{
		{SeriesID: "S1", Name: "Amerigo Fund"},
		{SeriesID: "S2", Name: "Banking Fund"},
	}
	if got := resolve(t, decls, "RYDEX VARIABLE TRUST", "Variable Trust - Amerigo Fund"); got != "S1" {
		t.Errorf("dash tail: got %q, want S1", got)
	}
	// Neither side declared: blank.
	if got := resolve(t, decls, "RYDEX VARIABLE TRUST", "Variable Trust - Growth Fund"); got != "" {
		t.Errorf("neither side: got %q, want blank", got)
	}
}

func TestSeriesTrailingTokensAcronym(t *testing.T) {
	// Rydex Variable Trust prints `VT BANKING FUND` for a declared `Banking
	// Fund`: the initials of the registrant's trailing tokens.
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "Banking Fund"},
		{SeriesID: "S2", Name: "Russell 2000(R) 1.5x Strategy Fund"},
	}
	if got := resolve(t, decls, "RYDEX VARIABLE TRUST", "VT BANKING FUND"); got != "S1" {
		t.Errorf("got %q, want S1", got)
	}
	if got := resolve(t, decls, "RYDEX VARIABLE TRUST", "VT RUSSELL 2000 1.5X STRATEGY FUND"); got != "S2" {
		t.Errorf("with a folded mark: got %q, want S2", got)
	}
}

func TestSeriesParenthesisedInternalCode(t *testing.T) {
	// The internal fund code one registrant prints before the name, here in
	// parentheses: `(ZW4X) GEI Total Return Blackrock ACWI xUS Index`.
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "GEI Total Return Blackrock ACWI xUS Index"},
		{SeriesID: "S2", Name: "GEI Small Cap Equity"},
	}
	if got := resolve(t, decls, "SOME FUNDS INC", "(ZW4X) GEI Total Return Blackrock ACWI xUS Index"); got != "S1" {
		t.Errorf("got %q, want S1", got)
	}
}

func TestSeriesCodeThenBrand(t *testing.T) {
	// John Hancock Variable Insurance Trust heads each fund with an internal
	// code, its own initials and the declared name: `6741 JHVIT Total Bond
	// Market Trust`. The code comes off first, then the brand.
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "Total Bond Market Trust"},
		{SeriesID: "S2", Name: "American Growth Trust"},
	}
	if got := resolve(t, decls, "JOHN HANCOCK VARIABLE INSURANCE TRUST", "6741 JHVIT Total Bond Market Trust"); got != "S1" {
		t.Errorf("got %q, want S1", got)
	}
}

func TestBroadridgeHeadingUsesSharedRules(t *testing.T) {
	decls := []SeriesDecl{
		{SeriesID: "S000008214", Name: "Total Bond Market Trust"},
		{SeriesID: "S000008215", Name: "American Growth Trust"},
	}
	ix := newISSSeriesIndex(decls, normalizeSeriesName("JOHN HANCOCK VARIABLE INSURANCE TRUST"))
	if got := brResolveHeading(ix, "6741 JHVIT Total Bond Market Trust"); got != "S000008214" {
		t.Errorf("got %q, want S000008214", got)
	}
	if got := brResolveHeading(ix, "Total Bond Market Trust"); got != "S000008214" {
		t.Errorf("exact: got %q, want S000008214", got)
	}
	if got := brResolveHeading(ix, "6741 JHVIT Total Bond Market Fund"); got != "" {
		t.Errorf("noun swap: got %q, want blank", got)
	}
}

func TestHTMLBareFundLine(t *testing.T) {
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "AST AB GLOBAL BOND PORTFOLIO"},
		{SeriesID: "S2", Name: "AST ACADEMIC STRATEGIES ASSET ALLOCATION PORTFOLIO"},
	}
	ix := newISSSeriesIndex(decls, normalizeSeriesName("ADVANCED SERIES TRUST"))
	pre := "\nAST AB Global Bond Portfolio- Sub-Adviser: AllianceBernstein\n\nThere is no proxy voting activity for the fund.\n\nAST Academic Strategies Asset Allocation Portfolio - Sub-Adviser: Alpha Simplex\n"
	if _, id, ok := htmlBareFundLine(ix, pre); !ok || id != "S2" {
		t.Errorf("got %q,%v, want S2 (the nearest name above the table)", id, ok)
	}
	if _, _, ok := htmlBareFundLine(ix, "\nThere is no proxy voting activity for the fund.\n"); ok {
		t.Error("a paragraph naming no fund must not set one")
	}
}

func TestSeriesAcronymKeepsRomanNumerals(t *testing.T) {
	// John Hancock Funds II heads each fund `3341 JHFII Multi-Asset Absolute
	// Return Fund`: the registrant's initials with the numeral spelled whole.
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "Multi-Asset Absolute Return Fund"},
		{SeriesID: "S2", Name: "Core Bond Fund"},
	}
	ix := newISSSeriesIndex(decls, normalizeSeriesName("John Hancock Funds II"))
	if got := brResolveHeading(ix, "3341 JHFII Multi-Asset Absolute Return Fund"); got != "S1" {
		t.Errorf("got %q, want S1", got)
	}
}

func TestSeriesCommonSuffixWord(t *testing.T) {
	// The College Retirement Equities Fund declares every series as
	// `<name> Account` and prints the banners without the word: `CREF Equity
	// Index` for `Equity Index Account`. That every declared name ends in the
	// same word is a fact of THIS filing's header, so the word may be supplied
	// -- and only when all of them do.
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "Equity Index Account"},
		{SeriesID: "S2", Name: "Bond Market Account"},
		{SeriesID: "S3", Name: "Stock Account"},
	}
	for b, want := range map[string]string{
		"CREF Equity Index":     "S1",
		"CREF Bond Market":      "S2",
		"CREF Stock":            "S3",
		"CREF Bond Market Fund": "", // a different word is not a missing one
		"CREF Global Equities":  "", // not declared at all
	} {
		if got := resolve(t, decls, "COLLEGE RETIREMENT EQUITIES FUND", b); got != want {
			t.Errorf("%q -> %q, want %q", b, got, want)
		}
	}
	// When the declared names do NOT all share a last word, nothing is supplied.
	decls = []SeriesDecl{
		{SeriesID: "S1", Name: "Equity Index Account"},
		{SeriesID: "S2", Name: "Bond Market Fund"},
	}
	if got := resolve(t, decls, "COLLEGE RETIREMENT EQUITIES FUND", "CREF Equity Index"); got != "" {
		t.Errorf("mixed suffixes: got %q, want blank", got)
	}
}

func TestICRResolveFundShared(t *testing.T) {
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "Equity Index Account"},
		{SeriesID: "S2", Name: "Stock Account"},
	}
	ix := newISSSeriesIndex(decls, normalizeSeriesName("COLLEGE RETIREMENT EQUITIES FUND"))
	if got := icrResolveFundShared(ix, "CREF Equity Index"); got != "S1" {
		t.Errorf("got %q, want S1", got)
	}
	if got := icrResolveFundShared(ix, "CREF Equity Index Account"); got != "S1" {
		t.Errorf("icr's own suffix reading first: got %q, want S1", got)
	}
}

func TestSeriesLeadingTokensInitials(t *testing.T) {
	// Variable Insurance Products Fund II prints `VIP CONTRAFUND PORTFOLIO`
	// for a declared `Contrafund Portfolio`: the initials of the registrant's
	// LEADING tokens.
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "Contrafund Portfolio"},
		{SeriesID: "S2", Name: "Index 500 Portfolio"},
	}
	ix := newISSSeriesIndex(decls, normalizeSeriesName("VARIABLE INSURANCE PRODUCTS FUND II"))
	if got := icrResolveFundShared(ix, "VIP CONTRAFUND PORTFOLIO"); got != "S1" {
		t.Errorf("got %q, want S1", got)
	}
}

func TestSeriesDominantSuffixWord(t *testing.T) {
	// Advanced Series Trust 2012 declares 59 of 68 series as `... Portfolio`
	// and the rest as target-date names; the shared word is still the
	// filing's own convention, and the exact reading always comes first.
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "AST Parametric Emerging Markets Equity Portfolio"},
		{SeriesID: "S2", Name: "AST Small-Cap Growth Portfolio"},
		{SeriesID: "S3", Name: "AST Bond Portfolio 2021"},
	}
	if got := resolve(t, decls, "ADVANCED SERIES TRUST", "AST Parametric Emerging Markets Equity - Sub-Adviser: Parametric Portfolio Associates"); got != "S1" {
		t.Errorf("got %q, want S1", got)
	}
	// Below the threshold nothing is supplied.
	decls = []SeriesDecl{
		{SeriesID: "S1", Name: "Alpha Portfolio"},
		{SeriesID: "S2", Name: "Beta Fund"},
		{SeriesID: "S3", Name: "Gamma Trust"},
	}
	if got := resolve(t, decls, "SOME TRUST", "Alpha"); got != "" {
		t.Errorf("no dominant suffix: got %q, want blank", got)
	}
}

func TestSeriesBrandSpelledAsSeveralTokens(t *testing.T) {
	// John Hancock Funds II also prints its initials with a space before the
	// numeral: `2CHK JHF II New Opportunities Fund`.
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "New Opportunities Fund"},
		{SeriesID: "S2", Name: "Core Bond Fund"},
	}
	ix := newISSSeriesIndex(decls, normalizeSeriesName("John Hancock Funds II"))
	if got := brResolveHeading(ix, "2CHK JHF II New Opportunities Fund"); got != "S1" {
		t.Errorf("got %q, want S1", got)
	}
}

func TestNormalizeSeriesNameDecodesEntities(t *testing.T) {
	// The SGML header can carry an ampersand encoded once or twice:
	// `S&amp;amp;P 500 Index Master Portfolio` (Master Investment Portfolio,
	// 60k rows unmatched on 2026-09-02).
	if got, want := normalizeSeriesName("S&amp;amp;P 500 Index Master Portfolio"), normalizeSeriesName("S&P 500 Index Master Portfolio"); got != want {
		t.Errorf("got %q, want %q", got, want)
	}
	if got, want := normalizeSeriesName("Growth &amp; Income Fund"), normalizeSeriesName("Growth & Income Fund"); got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestSeriesRegistrantTypeWordOmitted(t *testing.T) {
	// John Hancock Variable Insurance Trust 2012 heads each fund without the
	// registrant's own type word, wherever it sits in the declared name:
	// `6721 500 Index B` for `500 Index Trust B`, `6724 Small Cap Growth` for
	// `Small Cap Growth Trust`.
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "500 Index Trust B"},
		{SeriesID: "S2", Name: "500 Index Trust"},
		{SeriesID: "S3", Name: "Small Cap Growth Trust"},
		{SeriesID: "S4", Name: "Money Market Trust B"},
	}
	ix := newISSSeriesIndex(decls, normalizeSeriesName("JOHN HANCOCK VARIABLE INSURANCE TRUST"))
	for h, want := range map[string]string{
		"6721 500 Index B":      "S1",
		"6724 Small Cap Growth": "S3",
		"6721 500 Index":        "S2",
		"6733 Money Market":     "", // no declared name is Money Market minus Trust
	} {
		if got := brResolveHeading(ix, h); got != want {
			t.Errorf("%q -> %q, want %q", h, got, want)
		}
	}
}

func TestHTMLBareFundLineInstitutionAccount(t *testing.T) {
	// Ivy Funds VIP's later sections name the fund only in the export field
	// `Institution Account(s): 90 Ivy Funds VIP Asset Strategy` -- an account
	// code before the name; the line under the banner is the period.
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "Ivy Funds VIP Asset Strategy"},
		{SeriesID: "S2", Name: "Ivy Funds VIP Growth"},
	}
	ix := newISSSeriesIndex(decls, normalizeSeriesName("Ivy Funds Variable Insurance Portfolios"))
	pre := "Vote Summary Report\nReporting Period: 07/01/2014 to 06/30/2015\nLocation(s): All Locations\nInstitution Account(s): 90 Ivy Funds VIP Asset Strategy\n"
	name, id, ok := htmlBareFundLine(ix, pre)
	if !ok || id != "S1" {
		t.Errorf("got %q,%q,%v, want S1", name, id, ok)
	}
	if name != "90 Ivy Funds VIP Asset Strategy" {
		t.Errorf("fund name recorded as %q, want the field's value as printed", name)
	}
}
