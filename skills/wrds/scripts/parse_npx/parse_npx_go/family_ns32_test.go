package main

import (
	"path/filepath"
	"testing"
)

// familyNS32Dispatch runs the real dispatch on a family NS32 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS32Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns32", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns32", fixture), sink, make([]byte, headBytes))
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

// 000106/1065698/0001065698-04-000036.txt: verbatim source lines 11-38 (the SEC
// document opener through the registrant's conformed name, CIK and state),
// 49-61 (`</SEC-HEADER>` through `<BODY>`), 63-77 (the cover through `(Exact
// name of registrant as specified in charter)`), 93-100 (the fiscal-year and
// reporting-period lines, `Item 1. Proxy Voting Record` and `Listed below is
// the Proxy Voting Record for each series of Sun Capital Advisers Trust`),
// 3411-3414 (the `1.D.` heading), 4900-4923 (the `1.E.` heading and the whole
// ADVANCED FIBRE COMMUNICATIONS block under it) and the filing's own last six
// lines. Every byte is verbatim. Dispatches to `issnpx` (the precondition
// asserts it).
//
// Sun Capital Advisers Trust, period 20040630, `issnpx`. The filing numbers its
// eighteen fund sections `1.A.` through `1.R.` and prints each label and fund
// name on one bare paragraph line. Source lines 3412 and 4904, verbatim:
//
//	<P></A>1.D.  Sun Capital Real Estate Fund</P>
//	<P>1.E.  SC Alger Growth Fund</P>
//
// A bare paragraph becomes a section boundary only when it RESOLVES
// (`parseISSNPX`, layout_issnpx.go:538-553 -- "A bare paragraph is a boundary
// only on an exact, unique name"). `Sun Capital Real Estate Fund` is declared
// at this CIK, so `1.D.` is a boundary. `SC Alger Growth Fund` is declared
// NOWHERE -- not at this CIK, not at any CIK, at any vintage -- so `1.E.` is
// not read as a boundary at all, and the rows printed under it inherit the
// PRECEDING section's fund and id.
//
// PROBED, not judged by eye, against this filing's own index (40
// dictionary-backfilled decls; the 2004 filing declares no `<SERIES>` blocks,
// `grep -c SERIES-ID` -> 0):
//
//	icrResolveFundShared(ix, "SC Alger Growth Fund")               -> ""
//	icrResolveFundShared(ix, "SC Alger Income & Growth Fund")      -> ""
//	icrResolveFundShared(ix, "SC Alger Small Capitalization Fund") -> ""
//	icrResolveFundShared(ix, "1.E.  SC Alger Growth Fund")         -> ""
//	icrResolveFundShared(ix, "Alger Growth Fund")                  -> ""
//	icrResolveFundShared(ix, "Sun Capital Real Estate Fund")       -> "S000008069"
//	icrResolveFundShared(ix, "SC Davis Venture Value Fund")        -> "S000008070"
//	icrResolveFundShared(ix, "SC XYZZY Fund")                      -> ""
//
// so the correct series for these rows is BLANK, and the id they carry is
// wrong. Measured on the current tree with the full 41,139-row dictionary, the
// whole filing emits 2,001 rows, every one of them stamped S000008069 `Sun
// Capital Real Estate Fund`, while the bytes place all 2,001 under `1.E.` /
// `1.F.` / `1.G.` (SC Alger Growth, SC Alger Income & Growth, SC Alger Small
// Capitalization -- the three ISS-text sections; the HTML-table sections
// 1.A-1.D and 1.H-1.R contribute no rows). The Real Estate section's own table
// is empty.
//
// Fix location: `layout_issnpx.go`, `parseISSNPX`, the bare-paragraph boundary
// at :538-553. An ordinal section label (`1.E.`, `1.F.`) in the same
// `<n>.<letter>.` series as a label already accepted as a boundary is byte
// evidence that the line is a heading, independent of whether the name behind
// it resolves. Such a line must open a section -- set `fund` to the printed
// name and CLEAR `fundSeries` -- so that an undeclared sibling's rows come out
// blank instead of inheriting the last declared sibling's id. No guess is
// involved: the correction is a refusal, not an attribution.
func TestFamilyNS32SunCapitalOrdinalHeading(t *testing.T) {
	rows := familyNS32Dispatch(t, "sun_capital_ordinal_heading.txt", "sun_capital_dict.tsv", "issnpx", 4)
	for _, r := range rows {
		if r.SeriesID != "" {
			t.Errorf("rows under `1.E.  SC Alger Growth Fund` carry the PRECEDING section's id: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want \"\"",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
