package main

import (
	"path/filepath"
	"testing"
)

// familyNS25Dispatch runs the real dispatch on a family NS25 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS25Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns25", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns25", fixture), sink, make([]byte, headBytes))
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

// 000082/825062/0000088053-05-000967.txt: verbatim source lines 1-29 (the SEC
// header through the registrant's FILING VALUES opener), 59-66 (the header
// closer and the document opener through `<TEXT>`), 126-152 (the first
// `Selected Accounts:` banner, the SUNTRUST issuer block under it and its two
// proposals), 1598-1637 (the page break, the `NO PROXIES` Concentrated Value
// banner, the SECOND `Selected Accounts:` banner and the R.J. REYNOLDS block
// under it) and the filing's own last five lines. Every byte is verbatim.
// Dispatches to `splittable` (the precondition asserts it).
//
// Scudder Value Series, Inc., period 20050630, `splittable`. Measured on the
// current tree with the full 41,139-row dictionary:
//
//	=== 000082/825062/0000088053-05-000967.txt layout=splittable status=ok rows=2166 blank=0
//	    2166 S000006144 "Scudder Large Cap Value Fund"
//
// Every row of the filing carries ONE series. The filing is four funds: its
// cover page names them (source lines 76-80) and the vendor opens a section
// for each with a `Selected Accounts:` line -- source lines 129, 1602, 1611
// and 2936:
//
//	Selected Accounts: Scudder Large Cap Value Fund
//	Selected Accounts: SVS - Scudder-Dreman Concentrated Value Fund
//	Selected Accounts: Scudder Dreman High Return Equity Fund
//	Selected Accounts: Scudder-Dreman Small Cap Value
//
// The reader takes the FIRST one and never switches, so the 1,690 rows below
// line 1611 -- the High Return Equity and Small Cap Value sections -- are
// stamped with the Large Cap Value sleeve. This is a WRONG-SERIES defect, not
// a blank one: the bytes name the governing fund on its own line and the tree
// stamps a sleeve those bytes do not name.
//
// PROBED, not judged by eye, against this filing's own index (15
// dictionary-backfilled decls; the 2005 filing declares no `<SERIES>` blocks).
// All four banners resolve exactly, so nothing is guessed by fixing the
// attribution:
//
//	icrResolveFundShared(ix, "Scudder Large Cap Value Fund")                  -> "S000006144"
//	icrResolveFundShared(ix, "SVS - Scudder-Dreman Concentrated Value Fund")  -> "S000006145"
//	icrResolveFundShared(ix, "Scudder Dreman High Return Equity Fund")        -> "S000006146"
//	icrResolveFundShared(ix, "Scudder-Dreman Small Cap Value")                -> "S000006150"
//
// The third is the one this fixture turns on: the R.J. REYNOLDS block sits
// under `Selected Accounts: Scudder Dreman High Return Equity Fund` (source
// lines 1611 and 1620) and must carry S000006146.
//
// Fix location: `layout_splittable.go`, the `Selected Accounts:` banner reader
// reached from the body walk that `issFilingIndex` is built for at :251 -- a
// `Selected Accounts:` line is a section boundary every time it is printed,
// not only the first time, and the section it opens keeps the fund it names
// until the next one is printed.
func TestFamilyNS25ScudderSelectedAccountsSwitch(t *testing.T) {
	rows := familyNS25Dispatch(t, "scudder_selected_accounts_switch.txt", "scudder_dict.tsv", "splittable", 3)
	for _, r := range rows {
		want := "S000006144"
		if r.IssuerName == "R.J. REYNOLDS TOBACCO HOLDINGS, INC." {
			want = "S000006146"
		}
		if r.SeriesID != want {
			t.Errorf("a later `Selected Accounts:` banner never reopens the section, so the fund the filing names is discarded and the first sleeve is stamped on every row: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want %s",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID, want)
		}
	}
}
