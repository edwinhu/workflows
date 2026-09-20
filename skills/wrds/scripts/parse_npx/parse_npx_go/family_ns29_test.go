package main

import (
	"path/filepath"
	"testing"
)

// familyNS29Dispatch runs the real dispatch on a family NS29 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS29Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns29", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns29", fixture), sink, make([]byte, headBytes))
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

// 000088/880583/0000930413-04-004219.txt: verbatim source lines 11-29 (the SEC
// document opener through the registrant's FISCAL YEAR END), 51-56 (the header
// closer through `<TEXT>`), 106-126 (the `<PAGE>`, `ITEM 1. PROXY VOTING
// RECORD` and the `FORM N-Px REPORT` banner with its ICA number, reporting
// period and registrant line), 35763-35792 (the SOCIAL AWARENESS STOCK
// two-line banner and the whole AETNA INC. block under it) and the filing's own
// last five lines. Every byte is verbatim. Dispatches to `issnpx` (the
// precondition asserts it).
//
// Travelers Series Trust, period 20040630, `issnpx`. This is a WRONG series,
// not a blank one, and the correct outcome is BLANK: no series this registrant
// declares at any vintage is named `Social Awareness`. Measured on the current
// tree with the full 41,139-row dictionary, two of this filing's sections:
//
//	1119 S000011153  "THE TRAVELERS SERIES TRUST - SOCIAL AWARENESS STOCK PORTFOLIO"
//	 838 S000011153  "THE TRAVELERS SERIES TRUST - FEDERATED STOCK PORTFOLIO"
//
// Both are stamped S000011153, which the dictionary declares as `Federated
// Stock Portfolio`. The filing prints the two as SEPARATE ruled sections
// (source lines 35763 and 12228), so they cannot be one fund, and the heading's
// own bytes name `SOCIAL AWARENESS STOCK`, a phrase that appears in
// `cik_series.tsv` only under OTHER registrants (Legg Mason Partners, LVIP
// Delaware, Smith Barney) and never at CIK 880583.
//
// The two ruled lines are joined correctly -- the banner's `PORTFOLIO`
// continuation reaches fund_name -- so the defect is entirely inside the
// resolver chain. PROBED, not judged by eye, against this filing's own index
// (20 dictionary-backfilled decls; the 2004 filing declares no `<SERIES>`
// blocks):
//
//	icrResolveFundShared(ix, "THE TRAVELERS SERIES TRUST - SOCIAL AWARENESS STOCK PORTFOLIO") -> "S000011153"
//	icrResolveFundShared(ix, "SOCIAL AWARENESS STOCK PORTFOLIO")                 -> ""
//	icrResolveFundShared(ix, "STOCK PORTFOLIO")                                  -> "S000011153"
//	icrResolveFundShared(ix, "THE TRAVELERS SERIES TRUST - XYZZY STOCK PORTFOLIO")-> "S000011153"
//	icrResolveFundShared(ix, "THE TRAVELERS SERIES TRUST - FEDERATED STOCK PORTFOLIO") -> "S000011153"  (contrast: correct)
//
// The invented `XYZZY` heading answering the same id is the proof that nothing
// in the heading's distinctive words is being read: with
// `issStripRegistrantPrefix = false` every one of those prefixed headings
// resolves to "" instead, so the registrant-strip path is the gate, and the
// remainder it eventually hands over is the bare tail `STOCK PORTFOLIO`, which
// `lessLeadToken` answers from the declared `Federated Stock Portfolio` by
// dropping that declaration's leading token.
//
// Fix location: `layout_issnpx.go`, the `issStripRegistrantPrefix` block in
// `issResolveFundUncached` (the `issCutAbbreviatedRegistrantPrefix` cut and its
// `issResolveFund` recursion) -- the strip may consume only the registrant's
// OWN tokens, and the remainder must resolve as a name of its own rather than
// reach `lessLeadToken` after the heading's distinctive words have come off.
// `SOCIAL AWARENESS STOCK PORTFOLIO` resolves to nothing on its own, so the
// prefixed heading must resolve to nothing too.
func TestFamilyNS29TravelersSocialAwarenessNotFederated(t *testing.T) {
	rows := familyNS29Dispatch(t, "travelers_social_awareness_banner.txt", "travelers_dict.tsv", "issnpx", 17)
	for _, r := range rows {
		if r.SeriesID != "" {
			t.Errorf("the banner names `SOCIAL AWARENESS STOCK PORTFOLIO`, a fund this registrant declares at no vintage, and the id stamped is the one declared for the filing's SEPARATE `FEDERATED STOCK PORTFOLIO` section: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want \"\"",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
