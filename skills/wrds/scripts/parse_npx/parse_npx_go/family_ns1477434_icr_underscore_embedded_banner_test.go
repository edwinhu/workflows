package main

import (
	"path/filepath"
	"testing"
)

// BofA Funds Series Trust (CIK 0001477434, formerly Columbia Funds Series
// Trust III), verbatim bytes.
//
// Fixture: 000147/1477434/0001104659-12-057737.txt (period 20120630, 1,470
// lines) lines 1-486 -- the SGML header including the whole
// SERIES-AND-CLASSES-CONTRACTS-DATA block (all 11 declared series) plus the
// <DOCUMENT>/<TEXT> tags and the <html>/<body> opening -- concatenated with
// lines 609-957, the `Item 1. Proxy Voting Record` page through the end of the
// third per-fund section, and the document's own trailing close tags (lines
// 1466-1470). The extracted region is byte-identical to the source:
// `{ sed -n '1,486p' $f; sed -n '609,957p' $f; sed -n '1466,1470p' $f; }` on
// the WRDS copy and the committed fixture both md5 to
// 2f7a215fa321ef2301f4a908fc65df63. dict.tsv is the 11 cik_series.tsv rows
// this CIK carries, copied verbatim (md5 fddf23d2bec5584bc87408d253a98f6f).
//
// This is a DEFECT reproduction, not a floor guard. Measured by building HEAD
// (`go build -o /tmp/pnx .`) and running it over the WHOLE filing with the
// corpus -cik-series file, ALL 257 of its rows come back with series_id blank
// and fund_name literally equal to the string `Registrant Time Period:`
// (`cut -f9,10 /tmp/votes.tsv | sort | uniq -c` reports a single bucket,
// `257 <tab>Registrant Time Period:`). Every per-fund banner this filing
// prints names a series the header declares, so no run is a dead sleeve.
//
// TWO compounding defects in layout_icr.go produce that single bucket.
//
// (1) Source line 628 is a two-column CAPTION row introducing the list of
// funds with no reportable votes this period:
//
//	Fund Name:                          Registrant Time Period:
//
// icrFundName (layout_icr.go:1071) cuts at the FIRST colon in the line and
// returns everything after it as the fund name, so the caption is read as a
// real `Fund Name:` declaration whose VALUE is the second column's own label,
// the literal string `Registrant Time Period:`. That value names no declared
// series, so curSeries goes blank -- but curFund is now corrupted to the
// caption text.
//
// (2) After that caption, this filing's real per-fund banners print the fund
// name embedded in the MIDDLE of a rule of underscores, on the same line:
//
//	___________________BofA California Tax- Exempt Reserves_________________________
//	__________________BofA Connecticut Municipal Reserves________________________
//	___________________BofA Massachusetts Municipal Reserves_______________________
//
// icrUnderscoreRule (layout_icr.go:138) recognises a FULLY BLANK rule of
// underscores, and the rung near layout_icr.go:628 reads a fund name on the
// line ABOVE such a blank rule. Neither reads a name embedded INSIDE the
// underscores of the same line, so no rung recognises this banner shape at
// all and curFund/curSeries never update past the corrupted caption value --
// including for rows correctly printed under a banner that names a declared
// series exactly modulo the vendor's stray space in `Tax- Exempt`.
func TestFamilyNS1477434ICRUnderscoreEmbeddedBanner(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	dir := filepath.Join("testdata", "family_ns1477434_icr_underscore_embedded_banner")
	var err error
	cikDict, err = loadCIKSeries(filepath.Join(dir, "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	sink := &rowSink{}
	fixture := "bofa_funds_series_trust_2012.txt"
	meta := processFile(fixture, filepath.Join(dir, fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "icr" || meta.CIK != "0001477434" || meta.PeriodOfReport != "20120630" {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}

	// Each per-fund section of the fixture, keyed by a (CUSIP, meeting date)
	// pair that is unique to it. The two `670987502` sections print the SAME
	// issuer and CUSIP under different banners and are told apart only by the
	// meeting date, which is why the key is a pair. Series ids are the ones
	// this filing's own SEC-HEADER declares for the banner text, hand-copied
	// from the header -- not computed by the parser.
	type section struct {
		banner string // the banner line as printed, verbatim
		series string
	}
	california := section{banner: "___________________BofA California Tax- Exempt Reserves_________________________", series: "S000027917"}
	connecticut := section{banner: "__________________BofA Connecticut Municipal Reserves________________________", series: "S000027919"}
	massachusetts := section{banner: "___________________BofA Massachusetts Municipal Reserves_______________________", series: "S000027909"}

	type key struct{ cusip, date string }
	want := map[key]section{
		{"67062A408", "20120314"}: california,  // Nuveen California Investment Quality Municipal Fund
		{"67062Q502", "20120314"}: california,  // Nuveen California Performance Municipal Fund
		{"670985506", "20120314"}: california,  // Nuveen California Quality Income Municipal Fund.
		{"670975507", "20120314"}: california,  // Nuveen California Select Quality Municipal Fund, Inc.
		{"67061X300", "20120330"}: california,  // Nuveen Insured California Premium Income Municipal Fund
		{"670987502", "20120330"}: connecticut, // Nuveen Premier Insured Municipal Income Fund
		{"670987502", "20111116"}: massachusetts,
	}

	// The corrupted caption value, and the only series id it could ever yield.
	const captionValue = "Registrant Time Period:"

	// Tally per section rather than reporting per row: all 7 sections of the
	// fixture fail identically on HEAD and 200-odd identical lines hide the
	// shape of the defect.
	type tally struct {
		rows        int
		bad         int            // rows failing (a) or (b)
		caption     int            // fund_name == the caption value
		blank       int            // fund_name == ""
		wrongSeries map[string]int // observed series_id -> count, for every row whose id is not the wanted one
		example     *VoteRow       // first row that failed, for the message
	}
	tallies := map[key]*tally{}
	for k := range want {
		tallies[k] = &tally{wrongSeries: map[string]int{}}
	}

	for i := range sink.buf {
		r := sink.buf[i]
		k := key{r.CUSIP, r.MeetingDate}
		tl, known := tallies[k]
		if !known {
			t.Fatalf("fixture precondition: row %d has an unexpected (CUSIP, meeting date) pair %q/%q (issuer %q, item %q); the fixture's section boundaries have moved",
				i, r.CUSIP, r.MeetingDate, r.IssuerName, r.ItemSeq)
		}
		tl.rows++
		bad := false
		// (a) No row may carry the caption text, or anything resolved from it.
		switch r.FundName {
		case captionValue:
			tl.caption++
			bad = true
		case "":
			tl.blank++
			bad = true
		}
		// (b) Each row resolves to the series its own banner names, and holds
		// that id until the NEXT banner of this shape.
		if r.SeriesID != want[k].series {
			tl.wrongSeries[r.SeriesID]++
			bad = true
		}
		if bad {
			tl.bad++
			if tl.example == nil {
				tl.example = &sink.buf[i]
			}
		}
	}

	// Precondition: every section named above really is in the fixture, so the
	// assertions below cannot pass vacuously over a section that is not there.
	if len(sink.buf) == 0 {
		t.Fatalf("fixture precondition: the fixture produced no rows at all")
	}
	for k, sec := range want {
		if tallies[k].rows == 0 {
			t.Fatalf("fixture precondition: no row for CUSIP %s meeting %s (banner %s, series %s); the fixture has changed",
				k.cusip, k.date, sec.banner, sec.series)
		}
	}

	for _, k := range []key{
		{"67062A408", "20120314"}, {"67062Q502", "20120314"}, {"670985506", "20120314"},
		{"670975507", "20120314"}, {"67061X300", "20120330"},
		{"670987502", "20120330"}, {"670987502", "20111116"},
	} {
		sec, tl := want[k], tallies[k]
		if tl.example == nil {
			continue
		}
		t.Errorf("section under the banner\n\t%s\nCUSIP %s, meeting %s, issuer %q: %d of %d rows misattributed -- %d carry fund_name == the caption %q (defect 1: source line 628 is the two-column caption row `Fund Name:   Registrant Time Period:` heading this filing's list of funds with NO reportable votes; icrFundName cut it at the FIRST colon and took the second column's own label as the fund name), %d carry a blank fund_name, and the observed series_id counts are %v, want all %d rows on %s (defect 2: the banner above is a rule of underscores with a declared series name embedded in the MIDDLE of the same line; icrUnderscoreRule (layout_icr.go:138) matches only a fully blank rule and the rung at layout_icr.go:628 reads a name only on the line ABOVE one, so this shape is recognised by no rung and the section never opens, leaving every row stuck on the corrupted caption value)",
			sec.banner, k.cusip, k.date, tl.example.IssuerName,
			tl.bad, tl.rows,
			tl.caption, captionValue, tl.blank, tl.wrongSeries, tl.rows, sec.series)
	}
}
