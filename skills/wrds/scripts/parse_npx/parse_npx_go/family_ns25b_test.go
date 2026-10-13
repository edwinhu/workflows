package main

import (
	"path/filepath"
	"testing"
)

// familyNS25BDispatch runs the real dispatch on a family NS25b fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS25BDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns25b", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns25b", fixture), sink, make([]byte, headBytes))
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

// 000082/825062/0000088053-04-000648.txt: verbatim source lines 1-29 (the SEC
// header through the registrant's FISCAL YEAR END), 60-66 (the header closer
// and the document opener through `<TEXT>`), 1881-1925 (the `<PAGE>` break, the
// SECOND `Selected Accounts:` banner and the UNIVERSAL CORPORATION and EMERSON
// ELECTRIC blocks under it), the filing's own `</TABLE>` at 6436 and its last
// five lines. Every byte is verbatim. Dispatches to `splittable` (the
// precondition asserts it).
//
// Scudder Value Series, Inc., period 20040630, `splittable`. Measured on the
// current tree with the full 41,139-row dictionary:
//
//	=== 000082/825062/0000088053-04-000648.txt layout=splittable status=ok rows=924
//	    356 SCUDDER DREMAN SM CAP VALUE  S000006150
//	    323 SCUDDER LARGE CAP VALUE FUND S000006144
//	    245 SCUD DREMAN HIGH RET EQUITY  (blank)
//
// The three sections are the filing's three `Selected Accounts:` banners
// (source lines 128, 1886, 3300). Two resolve; the middle one does not, and the
// only difference is that the vendor truncated the REGISTRANT BRAND WORD in it:
//
//	Selected Accounts: SCUDDER LARGE CAP VALUE FUND
//	Selected Accounts: SCUD DREMAN HIGH RET EQUITY
//	Selected Accounts: SCUDDER DREMAN SM CAP VALUE
//
// PROBED, not judged by eye, against this filing's own index (15
// dictionary-backfilled decls; the 2004 filing declares no `<SERIES>` blocks).
// The abbreviated TAIL is already handled -- `SM CAP` reaches `Small Cap` and
// `HIGH RET EQUITY` reaches `High Return Equity` -- and the one token that
// refuses is `SCUD`:
//
//	icrResolveFundShared(ix, "SCUDDER LARGE CAP VALUE FUND")   -> "S000006144"
//	icrResolveFundShared(ix, "SCUDDER DREMAN SM CAP VALUE")    -> "S000006150"
//	icrResolveFundShared(ix, "SCUDDER DREMAN HIGH RET EQUITY") -> "S000006146"
//	icrResolveFundShared(ix, "DREMAN HIGH RET EQUITY")         -> "S000006146"
//	icrResolveFundShared(ix, "SCUD DREMAN HIGH RET EQUITY")    -> ""
//	icrResolveFundShared(ix, "SCUD DREMAN SM CAP VALUE")       -> ""
//
// Nothing is guessed by fixing it. `SCUD` is a prefix of the registrant's own
// brand word `SCUDDER` (`COMPANY CONFORMED NAME: SCUDDER VALUE SERIES INC`,
// source line 25), the same filing spells that word in full on its other two
// banners, and the remainder alone -- `DREMAN HIGH RET EQUITY` -- already
// resolves to exactly one declared sleeve through the unchanged chain. The
// filing's own cover page prints the unabbreviated name at source line 77:
//
//	Scudder-Dreman High Return Equity Fund
//
// The rung that answers the full spelling is the leading registrant-own-word
// run, and it is a WHOLE-TOKEN membership test, so a truncation of one of those
// words is foreign to it. Probed on the same index:
//
//	icrResolveFundShared(ix, "VALUE DREMAN HIGH RET EQUITY") -> "S000006146"  (a registrant word)
//	icrResolveFundShared(ix, "ZZZZ DREMAN HIGH RET EQUITY")  -> ""            (not one)
//	icrResolveFundShared(ix, "SCUDD DREMAN HIGH RET EQUITY") -> ""            (a truncation)
//
// Fix location: `layout_issnpx.go`, `issCutRegistrantWordRun` (:4385) and the
// `issRegistrantTokens` (:1794) membership it is built on -- a leading banner
// token that is a prefix of at least three characters of one of the
// registrant's own naming words is that word truncated, and the run must cut it
// exactly as it cuts the full spelling, with the existing guards (a named word
// in the run, two tokens surviving, the remainder naming exactly one declared
// sleeve) unchanged. `issCutAbbreviatedRegistrantPrefix` (:3847) already makes
// that prefix judgement and refuses here only because it requires at least two
// tokens to come off (`n < 2`); one token is cut here.
//
// Rows affected: 245 in this filing (the whole middle section).
func TestFamilyNS25BScudderTruncatedRegistrantBrand(t *testing.T) {
	rows := familyNS25BDispatch(t, "scudder04_scud_brand.txt", "scudder04_dict.tsv", "splittable", 4)
	for _, r := range rows {
		if r.SeriesID != "S000006146" {
			t.Errorf("the registrant brand word truncated to `SCUD` is not recognised as `SCUDDER`, so the banner resolves to nothing and the section's rows carry no series: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want S000006146",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
