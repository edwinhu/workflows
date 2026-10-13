package main

import (
	"path/filepath"
	"testing"
)

// ns931491TransposeDispatch runs the real dispatch on one family
// NS931491-adjacent-transposition fixture and asserts that fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the misspelled fund banners and their series ids, never a
// broken fixture. Same mechanism as ns931491Dispatch in
// family_ns931491_unassigned_placeholder_banner_test.go, pointed at its own
// testdata dir.
//
// No dictionary and no overlay are loaded, and that is deliberate rather than a
// shortcut: BOTH fixtures carry their own SEC-HEADER
// SERIES-AND-CLASSES-CONTRACTS-DATA block, and a header that declares any
// series is the authority for that filing (see cikSeries' own doc comment), so
// the dictionary cannot reach these rows. Measured on HEAD by running the built
// binary over both fixtures twice -- once with `-cik-series` naming this
// registrant's four real declarations at both vintages and an empty
// `-series-map`, once with neither flag -- the series_id and fund_name columns
// are byte-identical. Every id asserted below is read off the fixture's own
// header, not off a dictionary.
func ns931491TransposeDispatch(t *testing.T, relPath, fixture, layout string, count int) []VoteRow {
	t.Helper()
	dir := filepath.Join("testdata", "family_ns931491_adjacent_transposition")
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	sink := &rowSink{}
	meta := processFile(relPath, filepath.Join(dir, fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// CIK 0000931491 (Capital Management Investment Trust) misspells its own fund
// name in the vote-table banner of two filings, nine years and two vendors
// apart, and in both the misspelling is the SAME shape: one adjacent-character
// transposition of a name the filing's own SEC-HEADER declares on the line
// above, with every other character identical and the string the same length.
//
//	000093/931491/0001398344-10-001108.txt  (period 20100630)
//	  banner, source line 320:  `Capital Managemetn Mid-Cap Fund`
//	  header, source line 71:   `Capital Management Mid-Cap Fund`  S000010456
//	  `Managemetn` -> `Management`: swap of the adjacent pair at offsets 8,9.
//
//	000093/931491/0001413042-19-000225.txt  (period 20190630)
//	  banner, source line 134:  `Account Name: WELLINGTON SHEILDS SMALL-CAP FUND`
//	  header, source line 46:   `Wellington Shields Small-Cap Fund`  S000010455
//	  `SHEILDS` -> `SHIELDS`: swap of the adjacent pair at offsets 2,3.
//
// Both are isolated to the one mis-typed banner, and in BOTH filings the
// registrant's OTHER sleeve is printed correctly in the same document and
// resolves today -- so each filing carries its own control, and neither fund is
// a floor. Neither sleeve pools several series (the header declares exactly two,
// one per fund, in each filing) and both are declared under this very CIK, so
// there is nothing here that a correct reading could not reach.
//
// Measured on HEAD with the built binary over the two fixtures, the failure is
// NOT the one a blank series_id alone would suggest. The mis-typed banner is not
// read as a fund banner at all: its section's rows come out with fund_name AND
// series_id both empty, while the correctly-spelled sibling section in the same
// filing carries both.
//
//	capmgmt_managemetn_2010.txt   6 rows, layout htmltable
//	  Flextronics, Steris x2  (the `Managemetn` section)  fund="" series=""
//	  Del Monte x3            (the correct sibling)       fund="Capital Management Small Cap Fund" series=S000010455
//
//	wellington_sheilds_2019.txt   8 rows, layout htmltable
//	  3D SYSTEMS x4           (the `SHEILDS` section)     fund="" series=""
//	  US BANK x4              (the correct sibling)       fund="Account Name: WELLINGTON SHIELDS ALL-CAP FUND" series=S000010456
//
// The Del Monte control is what rules out a mere punctuation gap: its banner
// prints `Capital Management Small Cap Fund` for the declared `Capital
// Management Small-Cap Fund`, an actual difference in bytes, and it resolves --
// so the resolver already tolerates the hyphen. What it does not tolerate is a
// transposed pair, and a banner it cannot tie to a declared name is discarded
// rather than emitted.
//
// SCOPE FIXTURED: adjacent transposition specifically, not edit-distance-1
// generally. Both real misspellings here are transpositions, and the corpus
// already carries a third of the same shape under a different registrant and a
// different layout (`SPDR` -> `SDPR`, family NS1064641, which resolves on HEAD
// through the ICR/issnpx near-miss rungs) -- so transposition is a demonstrated
// vendor habit with three independent instances, while a substitution or an
// inserted character has no instance here to fixture. A fix that admits any
// single edit would also pass this test; a fix that admits only transpositions
// is enough to pass it. The fixtures are the two real filings' bytes, unedited.
//
// The assertions key on the ISSUER each section opens under, never on the fund
// label, because the fund label is the thing under test: keying on it would
// assert nothing in exactly the case that is broken. series_id is pinned for all
// four sections; fund_name is pinned only for the two control sections, since
// what a fix should print for a mis-typed banner -- the printed typo verbatim,
// as family NS1064641 keeps it, or the declared spelling -- is a separate
// question from whether the row reaches its sleeve.
func TestFamilyNS931491AdjacentTransposition(t *testing.T) {
	type want struct {
		// fund is the fund_name every row of this section must carry; "" means
		// this is a section under test and the label is not pinned.
		fund string
		id   string
		rows int
	}

	for _, tc := range []struct {
		relPath string
		fixture string
		count   int
		want    map[string]want
	}{
		{
			relPath: "000093/931491/0001398344-10-001108.txt",
			fixture: "capmgmt_managemetn_2010.txt",
			count:   6,
			want: map[string]want{
				// Under test: the `Capital Managemetn Mid-Cap Fund` banner.
				"Flextronics International Ltd.": {"", "S000010456", 1},
				"Steris Corp.":                   {"", "S000010456", 2},
				// Control: correctly spelled but for the missing hyphen, and
				// already resolving on HEAD.
				"Del Monte Foods Co.": {"Capital Management Small Cap Fund", "S000010455", 3},
			},
		},
		{
			relPath: "000093/931491/0001413042-19-000225.txt",
			fixture: "wellington_sheilds_2019.txt",
			count:   8,
			want: map[string]want{
				// Under test: the `WELLINGTON SHEILDS SMALL-CAP FUND` banner.
				"3D SYSTEMS CORPORATION": {"", "S000010455", 4},
				// Control: the sibling all-cap sleeve, already resolving on
				// HEAD. Its issuer column captures the banner block's
				// `Custodian Name:` line rather than ACCENTURE PLC; that is
				// this layout's behaviour on HEAD and is pinned here as-is, so
				// a change to it shows up rather than silently reshaping the
				// control.
				"Custodian Name: US BANK, N.A.": {"Account Name: WELLINGTON SHIELDS ALL-CAP FUND", "S000010456", 4},
			},
		},
	} {
		t.Run(tc.fixture, func(t *testing.T) {
			rows := ns931491TransposeDispatch(t, tc.relPath, tc.fixture, "htmltable", tc.count)

			// One error per section, not per row: the failure is uniform across
			// a section, so four identical lines would bury it.
			seen := map[string]int{}
			bad := map[string]int{}
			sample := map[string]VoteRow{}
			for _, r := range rows {
				w, ok := tc.want[r.IssuerName]
				if !ok {
					t.Fatalf("fixture precondition: row carries unexpected issuer %q (fund=%q series=%q meeting=%q) -- the issuer capture changed and the assertions below are measuring the wrong thing", r.IssuerName, r.FundName, r.SeriesID, r.MeetingDate)
				}
				seen[r.IssuerName]++
				if r.SeriesID != w.id || (w.fund != "" && r.FundName != w.fund) {
					if bad[r.IssuerName] == 0 {
						sample[r.IssuerName] = r
					}
					bad[r.IssuerName]++
				}
			}
			for issuer, w := range tc.want {
				if seen[issuer] != w.rows {
					t.Errorf("issuer %q carried %d rows, want %d -- the fixture's coverage of this section changed", issuer, seen[issuer], w.rows)
				}
				if bad[issuer] > 0 {
					r := sample[issuer]
					t.Errorf("section opened under issuer %q does not reach its own registrant's declared sleeve: %d of %d rows carry fund=%q series=%q, want series=%s (fund=%q, \"\" = not pinned) (first: item=%q meeting=%q desc=%q)", issuer, bad[issuer], seen[issuer], r.FundName, r.SeriesID, w.id, w.fund, r.ItemSeq, r.MeetingDate, r.VoteDescription)
				}
			}
		})
	}
}
