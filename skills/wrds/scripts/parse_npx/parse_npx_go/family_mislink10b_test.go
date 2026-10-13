package main

import (
	"path/filepath"
	"testing"
)

// familyMislink10bDispatch runs the real dispatch on a family MISLINK10b fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyMislink10bDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict = nil
	if dict != "" {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink10b", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink10b", fixture), sink, make([]byte, headBytes))
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

// 000133/1331971/0001438934-17-000312.txt (John Hancock Funds II, period
// 20170630, `broadridge`). The section headed
// `2DCY John Hancock Funds II Small Cap Growth Fund` carries 829 rows and no
// series.
//
// Fixture `jhf2_small_cap_growth.txt`: 81 lines. Verbatim source lines 1-19 (the
// SGML header through the registrant's fiscal year end), the four `<SERIES>`
// blocks of the header that spell a Small Cap / Small Company sleeve
// (S000003363, S000003364, S000009817, S000009819), trimmed to their `<SERIES>`
// / `<OWNER-CIK>` / `<SERIES-ID>` / `<SERIES-NAME>` / `</SERIES>` lines per the
// NS24 precedent, then the header closer and the document opener through
// `<TEXT>`, then source lines 65042-65073 (the heading and the 2U INC. block
// under it) and the filing's own last three lines. Every byte is verbatim.
// Dispatches to `broadridge` (the precondition asserts it).
//
// The fixture is trimmed to four of the header's 102 declarations because the
// refusal was measured to depend only on the colliding pair and its two
// stem-sharing siblings: the untrimmed 571-line fixture (the full 102 blocks)
// and this one both return blank, and both return S000009817 when the one
// dictionary row named below is deleted.
//
// THE SHAPE. Source line 65042, verbatim:
//
//	2DCY John Hancock Funds II Small Cap Growth Fund
//
// and the header's own declaration, source lines 886-887, verbatim:
//
//	<SERIES-ID>S000009817
//	<SERIES-NAME>Small Cap Growth Fund
//
// So after the broadridge account code `2DCY` and the registrant prefix
// `John Hancock Funds II` are cut, the remainder is `Small Cap Growth Fund`,
// which this filing's OWN header declares, exactly and for one id.
//
// WHY IT IS REFUSED. `cik_series.tsv` at CIK 0001331971 carries the same name
// for a DIFFERENT id at a later vintage -- the 2018 rename of the sleeve this
// filing declares as `Small Company Growth Fund`:
//
//	0001331971	S000003363	Small Company Growth Fund	20060630
//	0001331971	S000003363	Small Cap Growth Fund	20180630
//	0001331971	S000009817	Small Cap Growth Fund	20080630
//
// `issDeclAliases` admits that row (S000003363 IS header-declared, under its
// other name) and appends it to the filing's declarations. `dictContemporaneous`
// cannot break the resulting collision: its tiebreak fires only when EVERY
// colliding entry carries a declaration date, and the header-sourced
// S000009817 entry is undated. Measured on the current tree, with the
// fixture's own four declarations and the fixture's dictionary:
//
//	decl id=S000009817 name="Small Cap Growth Fund" declDate=""
//	decl id=S000003363 name="Small Cap Growth Fund" declDate="20180630"
//	lookup("Small Cap Growth Fund") d=<nil> declared=true
//
// `d==nil, declared==true` is `lookupSeriesEntry`'s deliberate refusal to guess,
// and it is never retried under a tolerance, so the registrant-prefix strip and
// every rung below it are skipped and the section is blank.
//
// NOT A BATCH-121 REGRESSION. Measured by restoring `layout_issnpx.go` from
// 94e2832e (the commit before the MISLINK10 batch, 244 diff lines from the
// current file) into a copy of the package and re-running this same fixture and
// dictionary: the section is blank there too. The batch-121 glued-`JHFII`
// branch, `issNearMissDecl`'s sibling guard and `issSleeveStemDecl`'s ordinal
// guard are all downstream of the exact lookup and never reached. What changed
// between the rounds is the dictionary input, not the binary.
//
// Nothing is guessed by fixing it: the id asserted is the one the filing's own
// header prints for the name the heading spells, and the 2018 alias postdates
// the 20170630 period of report, so it cannot be this section's fund.
//
// Fix location: `layout_issnpx.go`, `issDeclAliases` -- a dictionary alias whose
// declaration date postdates the filing's period of report may not be folded in
// when the normalised name it carries is one the filing's OWN header already
// declares for a different series. This is the principle `issFutureVintage`
// already states for an exact hit ("an undated decl is one the filing's own
// header printed ... that declaration vetoes any later vintage"), applied one
// step earlier, before the collision reaches `seriesByName`. Equivalently in
// `cik_series.go`, `dictContemporaneous`, whose undated-entry bail is what lets
// the pair survive.
func TestFamilyMislink10bJHF2SmallCapGrowth(t *testing.T) {
	rows := familyMislink10bDispatch(t, "jhf2_small_cap_growth.txt", "jhf2_dict.tsv", "broadridge", 7)
	for _, r := range rows {
		if r.SeriesID != "S000009817" {
			t.Errorf("a dictionary alias first declared in 2018 collides with the name this 20170630 filing's own header declares, and the section is refused: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want S000009817",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
