package main

import (
	"path/filepath"
	"testing"
)

// ns931491Dispatch runs the real dispatch on the family NS931491 fixture with
// this registrant's own two dictionary rows loaded, and asserts the fixture's
// own preconditions -- status, layout and row count -- so a failure below is an
// assertion about the two fund banners and their series ids, never a broken
// fixture. Same mechanism as ns1064641Dispatch in
// family_ns1064641_sdpr_transposition_test.go, pointed at its own testdata dir.
func ns931491Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	dir := filepath.Join("testdata", "family_ns931491_unassigned_placeholder_banner")
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
// 000093/931491/0001398344-11-001891.txt (period 20110630, 255 lines) as a
// broadridge EXHIBIT A carrying TWO fund sections, and the fixture is that
// filing's real bytes, unedited and uncut.
//
// Each section is opened by its own unindented banner printed at column 0 --
// `Capital Management Small-Cap Fund` at source line 147 and `Capital
// Management Mid-Cap Fund` at source line 207 -- and each banner is followed by
// `<TABLE>`/`<CAPTION>`, the literal placeholder line `UNASSIGNED` (source lines
// 151 and 211), a dashed rule, and then the block's own issuer name. The two
// banners are EXACT matches for the two series this filing's own SEC-HEADER
// declares (source lines 43-72), and dict.tsv beside this test is those same two
// rows:
//
//	S000010455  Capital Management Small-Cap Fund
//	S000010456  Capital Management Mid-Cap Fund
//
// The second section resolves on HEAD and the first does not, and the two
// sections are IDENTICAL in shape -- same banner column, same `UNASSIGNED`
// placeholder, same rule, same caption furniture. What separates them is the
// ISSUER name each block opens under, and nothing else:
//
//	ASHFORD HOSPITALITY TRUST, INC.   -- banner lost, section blank
//	B&G FOODS, INC.                   -- banner read, S000010456 on every row
//
// Measured against HEAD by renaming one line of the real bytes and re-parsing:
// rename Ashford to `ASHFORD HOSPITALITY CORP., INC.` and its banner resolves to
// S000010455; rename B&G to `B&G FOODS TRUST, INC.` and ITS banner is lost the
// same way. The word `TRUST` inside the issuer name is the whole difference, and
// it is why a REIT-heavy small-cap sleeve loses its identity while the sleeve
// beside it keeps one.
//
// The rung is brStraySlot (layout_broadridge.go:1184). It is what protects a
// section's already-set banner from being cleared by a slot that merely holds an
// issuer name, and it recognises an issuer as `a corporate form as its last word
// and no fund word at all`. `ASHFORD HOSPITALITY TRUST, INC.` carries the
// corporate form (`inc`) but also carries `trust`, which is in brFundTypeWords,
// so the slot is NOT read as a stray issuer; it falls through to the branch that
// treats the slot as this section's heading, which clears the banner's series and
// records the issuer name as the fund. `B&G FOODS, INC.` carries no fund word,
// is read as the issuer it is, and leaves its banner standing.
//
// So the placeholder `UNASSIGNED` is NOT what costs this registrant its
// identity -- it resolves to nothing under either section and is harmless. A
// corporate trust in the issuer column is.
func TestFamilyNS931491UnassignedPlaceholderBanner(t *testing.T) {
	const fixture = "capmgmt_unassigned_2011.txt"

	// Keyed by ISSUER, not by the fund label: the fund label is the thing under
	// test, so keying on it would assert nothing when it comes out wrong.
	want := map[string]struct {
		fund string
		id   string
		rows int
	}{
		"ASHFORD HOSPITALITY TRUST, INC.": {"Capital Management Small-Cap Fund", "S000010455", 12},
		"B&G FOODS, INC.":                 {"Capital Management Mid-Cap Fund", "S000010456", 12},
	}

	rows := ns931491Dispatch(t, fixture, "dict.tsv", "broadridge", 24)

	// One error per section, not per row: the failure is uniform across a
	// section, so 12 identical lines would bury it.
	seen := map[string]int{}
	bad := map[string]int{}
	sample := map[string]VoteRow{}
	for _, r := range rows {
		w, ok := want[r.IssuerName]
		if !ok {
			t.Fatalf("fixture precondition: row carries unexpected issuer %q (fund=%q series=%q meeting=%q) -- the issuer capture changed and the assertions below are measuring the wrong thing", r.IssuerName, r.FundName, r.SeriesID, r.MeetingDate)
		}
		seen[r.IssuerName]++
		if r.SeriesID != w.id || r.FundName != w.fund {
			if bad[r.IssuerName] == 0 {
				sample[r.IssuerName] = r
			}
			bad[r.IssuerName]++
		}
	}
	for issuer, w := range want {
		if seen[issuer] != w.rows {
			t.Errorf("issuer %q carried %d rows, want %d -- the fixture's coverage of this section changed", issuer, seen[issuer], w.rows)
		}
		if bad[issuer] > 0 {
			r := sample[issuer]
			t.Errorf("section opened under issuer %q does not carry its own banner: %d of %d rows carry fund=%q series=%q, want fund=%q series=%s (first: item=%q meeting=%q desc=%q)", issuer, bad[issuer], seen[issuer], r.FundName, r.SeriesID, w.fund, w.id, r.ItemSeq, r.MeetingDate, r.VoteDescription)
		}
	}
}
