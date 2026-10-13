package main

import (
	"path/filepath"
	"testing"
)

// An ISS text report prints a fund's banner even when that fund cast NO proxies,
// leaving a complete banner, blank lines, and then the NEXT fund's complete
// banner. Verbatim from 000108/1081400/0001193125-04-149058.txt lines
// 37491-37496 (WELLS FARGO FUNDS TRUST, CIK 1081400, period 20040630):
//
//	====================== WELLS FARGO NEBRASKA TAX-FREE FUND ======================
//
//
//
//
//	======================== WELLS FARGO OUTLOOK 2010 FUND =========================
//
// On binary 283 (commit e78cb6a7) the two rules are JOINED and all 5,647 rows of
// the Outlook 2010 section are emitted under the fund name `WELLS FARGO NEBRASKA
// TAX-FREE FUND WELLS FARGO OUTLOOK 2010 FUND`, stamped S000007393 -- the
// Nebraska Tax-Free Fund. One fund's votes attributed to another; a wrong
// series_id is worse than a blank one.
//
// The join happens ONLY when `-cik-series` is loaded, which is how every run
// since r64 invokes the binary. The chain, in issBannerWrapVisible
// (layout_issnpx.go:6795-6811):
//
//	next = `WELLS FARGO OUTLOOK 2010 FUND` resolves to nothing (no `Outlook`
//	      name exists in this CIK's dictionary at any vintage), so the
//	      "a rule that resolves by itself is the next fund" guard does not fire;
//	joined = `... NEBRASKA TAX-FREE FUND WELLS FARGO OUTLOOK 2010 FUND` resolves
//	      to S000007393 by the same tolerant rung that answers the head alone,
//	      and sofarDecl.SeriesID == joined.SeriesID, so the join is taken.
//
// Two guards that exist for exactly this shape both miss:
//
//   - the registrant-name guard at 6784-6791 refuses a continuation that opens
//     on the registrant's own name, but issCutRegistrantPrefix demands the WHOLE
//     conformed name (`wells fargo funds trust`) and the banner prints the brand
//     only (`wells fargo ...`);
//   - issHeadOnlyJoin (6839-6848) refuses a join whose answering declaration is
//     a prefix of the banner so far, but it compares the RAW declared name
//     `nebraska tax-free fund` against `wells fargo nebraska tax-free fund` --
//     the head resolved through the registrant-brand strip, so the prefix test
//     is false and the guard passes a join it was written to catch.
//
// Fixture: the filing's own SGML header (lines 1-55) and body lines 37303-37520
// byte for byte, inside the <PRE> the filing itself uses; the dictionary is this
// CIK's own 395 rows as the run loads them.
func TestISSNPXEmptySectionBannerDoesNotGlueOntoTheNext(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "issnpx", "wf1081400_cik_series.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	fixture := "wf1081400_empty_section_banner_glue.txt"
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "issnpx", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s error=%s", meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	if len(sink.buf) == 0 {
		t.Fatal("no rows")
	}
	const glued = "WELLS FARGO NEBRASKA TAX-FREE FUND WELLS FARGO OUTLOOK 2010 FUND"
	const want = "WELLS FARGO OUTLOOK 2010 FUND"
	n, outlook, gluedSeries := 0, 0, ""
	for _, r := range sink.buf {
		switch r.FundName {
		case glued:
			n++
			gluedSeries = r.SeriesID
		case want:
			outlook++
		}
	}
	if n > 0 {
		t.Fatalf("%d rows under the glued fund name %q (stamped series %q); the Outlook 2010 section is its own fund",
			n, glued, gluedSeries)
	}
	if outlook == 0 {
		t.Fatalf("no rows under %q", want)
	}
}
