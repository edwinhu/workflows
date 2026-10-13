package main

import (
	"path/filepath"
	"testing"
)

// Ohio National Fund, Inc. (CIK 0000315754), verbatim bytes.
// Fixture: 000031/315754/0001144204-11-041855.txt (md5
// a15d339b459944e912f0dcb6d2fb331d, 70,121 lines) lines 1-298 -- the SGML
// header including the whole SERIES-AND-CLASSES-CONTRACTS-DATA block (24
// declared series) plus the document tags and cover prose -- concatenated with
// lines 7092-7533, the `Fund Name : Bristol Portfolio` section marker and its
// first three issuer blocks (3M Company, Celanese Corporation, Chevron
// Corporation), and the document's own trailing close tags (lines
// 70119-70121). The extracted region is byte-identical to the source:
// `{ sed -n '1,298p' $f; sed -n '7092,7533p' $f; sed -n '70119,70121p' $f; }
// | md5sum` on the WRDS host and `md5sum` on the committed fixture both report
// 26ec74a0bfab5c360f5c0c8bb92e69a5. Dictionary: all 107 cik_series.tsv rows
// this CIK carries, copied verbatim.
//
// This is a DEFECT reproduction, not a floor guard. Measured by running the
// tracked parse_npx_go_328 binary against the whole filing with the corpus
// -cik-series and -series-map files, 5,678 of its 24,136 rows come back with
// series_id blank, in SEVEN runs that each begin partway through a fund's own
// section and end at the next `Fund Name :` label. Every banner this filing
// prints names a series the header declares EXACTLY, so no run is a dead
// sleeve.
//
// The trigger is a corrupted issuer separator. This report divides issuer
// blocks with a bare rule of '=' signs, and `grep -n '^=*[^=[:space:]]=*$' $f`
// returns exactly seven lines where a stray '?' has replaced one of them --
// 7470, 11579, 22844, 23889, 39044, 52215, 59409 -- one per observed run.
// Line 7470 is
//
//	========================?==================================================================================
//
// sitting between the Celanese Corporation and Chevron Corporation blocks.
// issFundSeparator (layout_issnpx.go:7271) strips the leading and trailing runs
// of '=' and returns whatever is left as the banner's NAME, so this line is
// read as a fund banner named "?": parseICR (layout_icr.go:571-584) then sets
// curFund="?", curSeries="" and fundFromBanner=true, overriding the still-open
// `Fund Name : Bristol Portfolio` section. The next clean bare rule is now a
// section END rather than an issuer divider, because fundFromBanner is set, so
// curFund clears to "" and the rest of the section carries neither name nor id.
// A one-character interior that contains no letter or digit is not a fund name
// under any grammar; the line is the same issuer divider its 300 uncorrupted
// siblings in this section are.
func TestFamilyNSICRCorruptRuleKeepsOpenFundBanner(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns_icr_corrupt_rule_banner", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	sink := &rowSink{}
	fixture := "ohio_national_bristol.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_ns_icr_corrupt_rule_banner", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "icr" || meta.CIK != "0000315754" || meta.PeriodOfReport != "20110630" {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}

	const (
		wantFund   = "Bristol Portfolio"
		wantSeries = "S000007881" // declared by this filing's own SEC-HEADER
	)

	// Precondition: the blocks BEFORE the corrupted rule are attributed. If this
	// fails the fixture, not the defect, has moved.
	var before, after int
	for _, r := range sink.buf {
		if r.IssuerName == "Chevron Corporation" {
			after++
		} else {
			before++
		}
	}
	if before == 0 || after == 0 {
		t.Fatalf("fixture precondition: %d rows before the corrupted rule, %d after (Chevron Corporation), want both non-zero; total=%d", before, after, len(sink.buf))
	}
	for _, r := range sink.buf {
		if r.IssuerName != "Chevron Corporation" && (r.FundName != wantFund || r.SeriesID != wantSeries) {
			t.Fatalf("fixture precondition: issuer %q before the corrupted rule has fund=%q series=%q, want %q/%q",
				r.IssuerName, r.FundName, r.SeriesID, wantFund, wantSeries)
		}
	}

	for i, r := range sink.buf {
		if r.IssuerName != "Chevron Corporation" {
			continue
		}
		if r.FundName != wantFund || r.SeriesID != wantSeries {
			t.Fatalf("row %d (issuer %q, item %q): fund=%q series=%q, want %q/%q -- line 7470 of the source is the issuer divider `========================?=====...`, a rule whose only interior character is '?'. No new `Fund Name :` label has been printed since line 7092, so the Bristol Portfolio section is still open",
				i, r.IssuerName, r.ItemSeq, r.FundName, r.SeriesID, wantFund, wantSeries)
		}
	}
}
