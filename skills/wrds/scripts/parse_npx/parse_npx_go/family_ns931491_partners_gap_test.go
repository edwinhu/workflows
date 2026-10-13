package main

import (
	"path/filepath"
	"testing"
)

// ns931491PartnersDispatch runs the real dispatch on the family
// NS931491-partners fixture with this registrant's own two dictionary rows
// loaded, and asserts the fixture's own preconditions -- status, layout and row
// count -- so a failure below is an assertion about the section banner and its
// series id, never a broken fixture. Same mechanism as
// ns931491CorpSuffixDispatch in family_ns931491_corpsuffix_gap_test.go, pointed
// at its own testdata dir.
func ns931491PartnersDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	dir := filepath.Join("testdata", "family_ns931491_partners_gap")
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
// broadridge EXHIBIT A whose FIRST fund section is opened by the unindented
// banner `Capital Management Small-Cap Fund` at source line 147, an exact match
// for the filing's own declared S000010455 (source lines 43-57). That section
// runs to source line 1603, where the NEXT banner (`Capital Management Mid-Cap
// Fund`) opens, and every issuer block between those two lines belongs to
// S000010455.
//
// This is the residue of family NS-931491-corpsuffix-gap (commit f5dde15f),
// which added the spelled-out forms `corporation` and `company` to
// brCorporateSuffixes and taught brStraySlot to rejoin a trailing pair of
// single-letter tokens (`N.V.` -> [n v] -> nv). That commit's own comment named
// a third spelled-out form it did not fix, and this is it.
//
// The fixture is that filing's real bytes, sliced and never edited: the
// SEC-HEADER through `</SEC-HEADER>` plus the document preamble and the section
// banner (source lines 1-150, byte-identical to the sibling fixture
// testdata/family_ns931491_corpsuffix_gap/capmgmt_corpsuffix_2011.txt, reused
// rather than re-derived), then ONE of the section's own `UNASSIGNED` issuer
// blocks --
//
//	EAGLE ROCK ENERGY PARTNERS   source lines 773-795
//
// -- and the filing's own closing `</TABLE>` / `</TEXT>` / `</DOCUMENT>` /
// `</SEC-DOCUMENT>` tail (source lines 3053-3057).
//
// The rung is brStraySlot (layout_broadridge.go:1184). It protects a section's
// already-set banner from being cleared by a slot that merely holds an issuer
// name, and it recognises such a slot only when the slot's last normalized token
// is in brCorporateSuffixes (layout_broadridge.go:1240), currently
// {se,sa,ag,nv,bv,plc,spa,ab,asa,oyj,as,kgaa,inc,corp,corporation,co,company,
// ltd,llc,lp}.
//
// `EAGLE ROCK ENERGY PARTNERS` normalizes to tokens [eagle rock energy
// partners]. The map carries the ABBREVIATION `lp` but not the bare spelled-out
// word `partners`, so brStraySlot returns false. The point of this block is
// precisely that the issuer name carries NO trailing LP/L.P.: Broadridge prints
// the same issuer twice in this same section, once as `EAGLE ROCK ENERGY
// PARTNERS LP` (source line 798, last token `lp`, already protected) and once
// bare (source line 775, unprotected). Only the bare spelling falls through.
//
// Because brStraySlot refuses the slot, it falls through to the branch that
// treats the slot as this section's heading: the correct banner is replaced by
// the issuer's own name as a phantom banner with no series id. That phantom then
// persists -- correctly, per the surrounding banner-persistence logic -- across
// every following row until some later slot happens to be misread the same way.
// So this is not a per-row miss: one unrecognised corporate form costs the rest
// of the section its identity, exactly as `corporation` and `company` did before
// f5dde15f closed those two.
func TestFamilyNS931491PartnersGap(t *testing.T) {
	const fixture = "capmgmt_partners_2011.txt"

	// The fixture's one block sits under the one banner, so the want is a
	// single pair -- keyed by ISSUER, never by the fund label, since the fund
	// label is the thing under test.
	const (
		wantFund = "Capital Management Small-Cap Fund"
		wantID   = "S000010455"
	)
	const issuer = "EAGLE ROCK ENERGY PARTNERS" // the gap: spelled-out `partners`

	// 4 rows: the DIRECTOR item's single nominee (WILLIAM K. WHITE) plus its
	// own item line, and the two advisory items 02 and 03.
	rows := ns931491PartnersDispatch(t, fixture, "dict.tsv", "broadridge", 4)

	// One error for the block, not one per row: the failure is uniform across
	// the block, so a line each would bury it.
	var seen, bad int
	var sample VoteRow
	for _, r := range rows {
		if r.IssuerName != issuer {
			t.Fatalf("fixture precondition: row carries unexpected issuer %q (fund=%q series=%q meeting=%q) -- the issuer capture changed and the assertions below are measuring the wrong thing", r.IssuerName, r.FundName, r.SeriesID, r.MeetingDate)
		}
		seen++
		if r.SeriesID != wantID || r.FundName != wantFund {
			if bad == 0 {
				sample = r
			}
			bad++
		}
	}
	if seen == 0 {
		t.Fatalf("issuer %q carried no rows -- the fixture's coverage of this block changed", issuer)
	}
	if bad > 0 {
		t.Errorf("block opened under issuer %q does not carry its section's banner: %d of %d rows carry fund=%q series=%q, want fund=%q series=%s (first: item=%q meeting=%q desc=%q)", issuer, bad, seen, sample.FundName, sample.SeriesID, wantFund, wantID, sample.ItemSeq, sample.MeetingDate, sample.VoteDescription)
	}
}
