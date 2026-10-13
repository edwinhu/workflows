package main

import (
	"path/filepath"
	"testing"
)

// ns931491CorpSuffixDispatch runs the real dispatch on the family
// NS931491-corpsuffix fixture with this registrant's own two dictionary rows
// loaded, and asserts the fixture's own preconditions -- status, layout and row
// count -- so a failure below is an assertion about the section banner and its
// series id, never a broken fixture. Same mechanism as ns931491Dispatch in
// family_ns931491_unassigned_placeholder_banner_test.go, pointed at its own
// testdata dir.
func ns931491CorpSuffixDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	dir := filepath.Join("testdata", "family_ns931491_corpsuffix_gap")
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join(dir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile("000093/931491/0001398344-11-001891.txt", filepath.Join(dir, fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// CIK 0000931491 (Capital Management Investment Trust) files
// 000093/931491/0001398344-11-001891.txt (period 20110630, 3057 lines) as a
// broadridge EXHIBIT A whose FIRST fund section -- opened by the unindented
// banner `Capital Management Small-Cap Fund` at source line 147, an exact match
// for the filing's own declared S000010455 (source lines 43-57) -- loses that
// banner partway through and never gets it back, leaving 484 of the filing's 552
// rows blank for series_id on the production binary.
//
// The fixture is that filing's real bytes, sliced and never edited: the
// SEC-HEADER through `</SEC-HEADER>` plus the document preamble and the section
// banner (source lines 1-150), then three of the section's own consecutive
// `UNASSIGNED` issuer blocks in their original relative order --
//
//	ASHFORD HOSPITALITY TRUST, INC.   source lines 151-200
//	BLACK HILLS CORPORATION           source lines 284-318
//	CRUCELL N.V.                      source lines 496-625
//
// -- and the filing's own closing `</TABLE>` / `</TEXT>` / `</DOCUMENT>` /
// `</SEC-DOCUMENT>` tail (source lines 3053-3057).
//
// All three blocks sit under the SAME banner and every row of all three belongs
// to S000010455. Ashford is the control: its shape is already covered and fixed
// by TestFamilyNS931491UnassignedPlaceholderBanner, and it must keep resolving
// here. The other two are the defect, and they differ from Ashford in exactly one
// respect -- the last normalized token of the issuer name.
//
// The rung is brStraySlot (layout_broadridge.go:1184). It protects a section's
// already-set banner from being cleared by a slot that merely holds an issuer
// name, and it recognises such a slot only when the slot's last normalized token
// is in brCorporateSuffixes (layout_broadridge.go:1229), currently
// {se,sa,ag,nv,bv,plc,spa,ab,asa,oyj,as,kgaa,inc,corp,co,ltd,llc,lp}. Two gaps:
//
//  1. Spelled-out corporate forms are absent. `BLACK HILLS CORPORATION`
//     normalizes to tokens [black hills corporation]; the map carries the
//     abbreviation `corp` but not the word `corporation`, so brStraySlot returns
//     false. The same gap swallows `DEL MONTE FOODS COMPANY` (last token
//     `company`, map has only `co`) and `EAGLE ROCK ENERGY PARTNERS` (last token
//     `partners`, map has only the abbreviation `lp`), both of which this same
//     section also carries.
//
//  2. A dotted multi-letter abbreviation does not survive tokenization.
//     `CRUCELL N.V.` normalizes to tokens [crucell n v] -- the dot is a
//     separator, so the Dutch form arrives as two single-letter tokens and the
//     last is the bare `v`. The map's `nv` and `bv` entries can therefore never
//     match a name ending in the dotted spelling they were written for; they are
//     reachable only for an already-joined `NV`/`BV`.
//
// Because brStraySlot refuses these slots, each falls through to the branch that
// treats the slot as this section's heading: the correct banner is replaced by
// the issuer's own name as a phantom banner with no series id. That phantom then
// persists -- correctly, per the surrounding banner-persistence logic -- across
// every following row until some later slot happens to be misread the same way.
// It is why the production binary shows unrelated real issuers (RAILAMERICA
// INC., RAYONIER INC., SNYDERS-LANCE INC, SOUTH JERSEY INDUSTRIES INC., SUN
// HEALTHCARE GROUP INC.) all carrying fund_name `NORTHWESTERN CORPORATION` with
// a blank series_id: their own names DO end in a recognised suffix, so they never
// reset the phantom back.
//
// So this is not a per-row miss. One unrecognised corporate form costs the rest
// of the section its identity.
func TestFamilyNS931491CorpSuffixGap(t *testing.T) {
	const fixture = "capmgmt_corpsuffix_2011.txt"

	// Every block in the fixture sits under the one banner, so the want is the
	// same triple for all three -- keyed by ISSUER, never by the fund label,
	// since the fund label is the thing under test.
	const (
		wantFund = "Capital Management Small-Cap Fund"
		wantID   = "S000010455"
	)
	issuers := []string{
		"ASHFORD HOSPITALITY TRUST, INC.", // control: resolves on HEAD
		"BLACK HILLS CORPORATION",         // gap 1: spelled-out `corporation`
		"CRUCELL N.V.",                    // gap 2: dotted `N.V.` -> tokens [n v]
	}

	rows := ns931491CorpSuffixDispatch(t, fixture, "dict.tsv", "broadridge", 23)

	want := map[string]bool{}
	for _, iss := range issuers {
		want[iss] = true
	}

	// One error per block, not per row: the failure is uniform across a block,
	// so a line each would bury it.
	seen := map[string]int{}
	bad := map[string]int{}
	sample := map[string]VoteRow{}
	for _, r := range rows {
		if !want[r.IssuerName] {
			t.Fatalf("fixture precondition: row carries unexpected issuer %q (fund=%q series=%q meeting=%q) -- the issuer capture changed and the assertions below are measuring the wrong thing", r.IssuerName, r.FundName, r.SeriesID, r.MeetingDate)
		}
		seen[r.IssuerName]++
		if r.SeriesID != wantID || r.FundName != wantFund {
			if bad[r.IssuerName] == 0 {
				sample[r.IssuerName] = r
			}
			bad[r.IssuerName]++
		}
	}
	for _, iss := range issuers {
		if seen[iss] == 0 {
			t.Errorf("issuer %q carried no rows -- the fixture's coverage of this block changed", iss)
			continue
		}
		if bad[iss] > 0 {
			r := sample[iss]
			t.Errorf("block opened under issuer %q does not carry its section's banner: %d of %d rows carry fund=%q series=%q, want fund=%q series=%s (first: item=%q meeting=%q desc=%q)", iss, bad[iss], seen[iss], r.FundName, r.SeriesID, wantFund, wantID, r.ItemSeq, r.MeetingDate, r.VoteDescription)
		}
	}
}
