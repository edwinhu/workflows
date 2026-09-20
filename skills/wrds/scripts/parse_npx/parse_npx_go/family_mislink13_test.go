package main

import (
	"path/filepath"
	"testing"
)

// familyMislink13Dispatch runs the real dispatch on the family MISLINK13
// fixture with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyMislink13Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink13", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink13", fixture), sink, make([]byte, headBytes))
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

// mislink13Decls are CIK 880583's twenty dictionary rows verbatim, every one
// vintage 20060428 and every one declared by the same later filing
// (000088/880583/0001193125-06-141168.txt). S000011157 is spelled
// `Mondrian International Stock Portfolio` and appears ONCE in the whole
// 41,139-row cik_series.tsv -- there is no second row, at this CIK or any
// other, recording an earlier `Lazard` spelling for it.
func mislink13Decls() []SeriesDecl {
	return []SeriesDecl{
		{SeriesID: "S000011133", Name: "Convertible Securities Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011134", Name: "Pioneer Fund Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011137", Name: "Pioneer Mid Cap Value Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011138", Name: "Style Focus Series: Small Cap Growth Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011139", Name: "Style Focus Series: Small Cap Value Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011144", Name: "Disciplined Mid Cap Stock Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011146", Name: "Strategic Equity Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011147", Name: "Van Kampen Enterprise Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011148", Name: "Pioneer Strategic Income Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011150", Name: "Salomon Brothers Strategic Total Return Bond Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011151", Name: "MFS Total Return Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011152", Name: "AIM Capital Appreciation Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011153", Name: "Federated Stock Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011154", Name: "Equity Income Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011155", Name: "Federated High Yield Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011156", Name: "Large Cap Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011157", Name: "Mondrian International Stock Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011158", Name: "MFS Mid Cap Growth Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011159", Name: "MFS Value Portfolio", DeclDate: "20060428"},
		{SeriesID: "S000011160", Name: "Mercury Large Cap Core Portfolio", DeclDate: "20060428"},
	}
}

// 000088/880583/0000930413-04-004219.txt: verbatim source lines 11-29 (the SEC
// document opener through the registrant's FISCAL YEAR END), 51-56 (the header
// closer through `<TEXT>`), 106-126 (the `<PAGE>`, `ITEM 1. PROXY VOTING
// RECORD` and the `FORM N-Px REPORT` banner with its ICA number, reporting
// period and registrant line), 20086-20124 (the LAZARD INTERNATIONAL STOCK
// two-line ruled banner and the whole ACOM CO. LTD. block under it) and the
// filing's own last five lines. Every byte is verbatim. Dispatches to `issnpx`
// (the precondition asserts it).
//
// Travelers Series Trust, period 20040630, `issnpx`. This is a WRONG series,
// not a blank one. Source lines 20089-20090 verbatim:
//
//	=========== THE TRAVELERS SERIES TRUST - LAZARD INTERNATIONAL STOCK ============
//	===========                        PORTFOLIO                        ============
//
// The current tree stamps S000011157 on all 1,149 rows of that section. The
// dictionary declares S000011157 as `Mondrian International Stock Portfolio`,
// and `grep -in mondrian` over the whole 38,673-line filing returns NOTHING --
// the word the id is declared under is printed nowhere in the bytes. `LAZARD`
// is printed exactly once, on the banner line itself.
//
// THE RENAME IS UNDOCUMENTED. Measured on
// /scratch/nyu/eddyhu/npx-reconcile-corpus:
//
//	grep 'S000011157' cik_series.tsv  -> ONE line, `Mondrian International
//	                                     Stock Portfolio`, vintage 20060428
//	grep -c '^0000880583' cik_series.tsv -> 20, one row per series id, no
//	                                     second spelling for any of them
//	grep 'S000011157' series_map_applied.tsv -> nothing
//	grep '880583'      series_map_applied.tsv -> ONE row, and it is the
//	                                     MERRILL LYNCH LARGE CAP CORE heading
//	                                     -> S000011160, not this one
//
// So neither the dictionary nor the overlay records `Lazard International
// Stock` as an earlier name of S000011157. A documented alias would make the
// stamp honest; there is none, and a wrong series_id is worse than a blank one.
//
// PROBED, not judged by eye, against this filing's own index (the twenty decls
// above, registrant key `travelers series trust`):
//
//	icrResolveFundShared(ix, "THE TRAVELERS SERIES TRUST - LAZARD INTERNATIONAL STOCK PORTFOLIO") -> "S000011157"
//	icrResolveFundShared(ix, "THE TRAVELERS SERIES TRUST - QQQ INTERNATIONAL STOCK PORTFOLIO")    -> "S000011157"
//	icrResolveFundShared(ix, "LAZARD INTERNATIONAL STOCK PORTFOLIO")                              -> "S000011157"
//	icrResolveFundShared(ix, "QQQ INTERNATIONAL STOCK PORTFOLIO")                                 -> "S000011157"
//	icrResolveFundShared(ix, "INTERNATIONAL STOCK")                                               -> "S000011157"
//	icrResolveFundShared(ix, "THE TRAVELERS SERIES TRUST - QQQ ZZZ PORTFOLIO")                    -> ""
//
// An invented lead word answers the same id, so the rung reads only
// `International Stock` and no part of `LAZARD`. The terminal rung is pinned:
// `ix.lessLeadToken["international stock portfolio"]` is S000011157 -- the
// DECLARED name with its own lead token `Mondrian` dropped -- consulted at
// layout_issnpx.go:3375. Batch 128's registrant-prefix guard does not reach it:
// the bare, unprefixed `QQQ INTERNATIONAL STOCK PORTFOLIO` answers too, and
// `icrResolveFundVintage`, `icrResolveDeclaredSuffix`, `icrResolveQualified`
// and `issSubstitutedBrandDecl` all return "" when called directly on the
// prefixed heading, so the peel of the heading's own lead token happens
// upstream of them inside `issResolveFundUncached`.
//
// Fix location: `layout_issnpx.go`, `issResolveFundUncached` (:2487) -- the
// lead-token rung at :3375 and its `lessLeadTokenAnyType` twin at :3386. One
// lead token may come off the DECLARED side or off the HEADING side, never
// both: when the heading also carries a lead word of its own that the
// declaration does not spell, the distinctive words no longer overlap and the
// heading must resolve to nothing. That single condition kills the QQQ probe by
// construction and leaves `MONDRIAN INTERNATIONAL STOCK PORTFOLIO` ->
// S000011157 and `THE TRAVELERS SERIES TRUST - FEDERATED STOCK PORTFOLIO` ->
// S000011153 untouched.
//
// Rows affected: 1,149 on this path, currently WRONG, correct outcome blank.
func TestFamilyMislink13TravelersLazardNotMondrian(t *testing.T) {
	rows := familyMislink13Dispatch(t, "travelers_lazard_banner.txt", "travelers_dict.tsv", "issnpx", 15)
	for _, r := range rows {
		if r.SeriesID != "" {
			t.Errorf("the banner names `LAZARD INTERNATIONAL STOCK PORTFOLIO`; S000011157 is declared ONLY as `Mondrian International Stock Portfolio` and neither cik_series.tsv nor series_map_applied.tsv records `Lazard` as an earlier name of it, so with no documented alias the honest outcome is blank: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want \"\"",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
	// Resolver level: the rung reads nothing of the heading's lead word, so an
	// invented one answers the same id. No fixture can carry this heading --
	// the filing does not print it -- so it is asserted directly.
	ix := newISSSeriesIndex(mislink13Decls(), normalizeSeriesName("TRAVELERS SERIES TRUST"))
	for _, probe := range []string{
		"THE TRAVELERS SERIES TRUST - QQQ INTERNATIONAL STOCK PORTFOLIO",
		"QQQ INTERNATIONAL STOCK PORTFOLIO",
	} {
		if got := icrResolveFundShared(ix, probe); got != "" {
			t.Errorf("an invented lead word reaches the declaration, so the rung reads only `International Stock`: icrResolveFundShared(%q) = %q, want \"\"", probe, got)
		}
	}
	// Contrast, and the guard against over-fixing: the declared spelling and
	// the sibling section must keep resolving.
	if got := icrResolveFundShared(ix, "MONDRIAN INTERNATIONAL STOCK PORTFOLIO"); got != "S000011157" {
		t.Errorf("the declared spelling must still resolve: got %q, want S000011157", got)
	}
	if got := icrResolveFundShared(ix, "THE TRAVELERS SERIES TRUST - FEDERATED STOCK PORTFOLIO"); got != "S000011153" {
		t.Errorf("the sibling section must still resolve: got %q, want S000011153", got)
	}
}
