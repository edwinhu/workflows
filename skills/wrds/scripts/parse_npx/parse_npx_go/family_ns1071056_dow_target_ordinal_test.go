package main

import (
	"path/filepath"
	"testing"
)

// ns1071056Dispatch runs the real dispatch on the family NS1071056 fixture with
// this registrant's own eight dictionary rows loaded, and asserts the fixture's
// own preconditions -- status, layout and row count -- so a failure below is an
// assertion about the ordinal-abbreviated fund banner and its series id, never a
// broken fixture. Same mechanism as ns1355064Dispatch in
// family_ns1355064_groesbeck_slash_test.go, pointed at its own testdata dir.
func ns1071056Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns1071056_dow_target", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns1071056_dow_target", fixture), sink, make([]byte, headBytes))
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

// CIK 0001071056 (Dow Target Variable Fund LLC) files
// 000107/1071056/0001144204-11-041734.txt (period 20110630, 2,982 lines) as ONE
// `<TABLE>` (source lines 152-2962) carrying EIGHT fund sections, each opened by
// its own `Fund Name : <name>` banner at source lines 150, 624, 1109, 1592, 2057,
// 2280, 2503 and 2740 (the last with a single leading space before `Fund`).
// Measured with the tracked binary parse_npx_go_361 over the real bytes with
// -cik-series and -series-map both pointed at the real
// /scratch/nyu/eddyhu/npx-reconcile-corpus dictionaries, the filing yields 1,112
// rows of which ALL 1,112 carry a BLANK series_id -- the whole filing is
// LOST_BASE -- while every row's fund_name is captured correctly, verbatim from
// the banner. Nothing is missing from the capture side; only the lookup fails.
//
// The barrier is an ordinal-abbreviation mismatch, and nothing else. This
// filing's own SEC-HEADER declares all eight sleeves (source lines 116-147 of
// the SERIES-AND-CLASSES-CONTRACTS-DATA block) and this registrant's own
// cik_series.tsv carries the same eight rows at the single vintage 20060630 --
// so every one of them is in scope at any later period date, 20110630 included:
//
//	S000007939  Dow Target 10 - First Quarter Portfolio    20060630
//	S000007940  Dow Target 10 - Second Quarter Portfolio   20060630
//	S000007941  Dow Target 10 - Third Quarter Portfolio    20060630
//	S000007942  Dow Target 10 - Fourth Quarter Portfolio   20060630
//	S000007943  Dow Target 5 - First Quarter Portfolio     20060630
//	S000007944  Dow Target 5 - Second Quarter Portfolio    20060630
//	S000007945  Dow Target 5 - Third Quarter Portfolio     20060630
//	S000007946  Dow Target 5 - Fourth Quarter Portfolio    20060630
//
// but the vote-table body spells the ordinal as a NUMBER in every one of the
// eight banners -- `1st`, `2nd`, `3rd`, `4th` -- where both the header and the
// dictionary spell it out -- `First`, `Second`, `Third`, `Fourth`. The two
// spellings name the same fund and differ in nothing else: same `Dow Target 10 `
// prefix, same ` Quarter Portfolio` suffix, same dash. normalizeSeriesName
// (header.go) does not reconcile them, so neither the header index nor the
// dictionary fallback finds a key, and the row goes out blank.
//
// This registrant is the unambiguous case. The mapping is 1:1 in both
// directions over its own dictionary -- exactly one dictionary name per printed
// banner, no cross-registrant borrowing, no rival candidate to choose between --
// because the eight names are distinguished ONLY by the ordinal and the 10/5
// prefix, and dict.tsv below is all eight real rows for this CIK, fetched
// verbatim, so no rival spelling is being hidden to make the claim easy.
//
// The fixture is a verbatim, unedited slice of the real filing: source lines
// 1-670, which is the whole SEC-HEADER (including the eight spelled-out
// SERIES-NAME declarations), the document preamble, `<TEXT>`, the `Fund Name :
// Dow Target 10 - 1st Quarter Portfolio` banner at source line 150, the section's
// opening `<TABLE>`/`<CAPTION>`/`<S> <C>` rows, the whole first section down
// through its last meeting, then the `Fund Name : Dow Target 10 - 2nd Quarter
// Portfolio` banner at source line 624 and that section's first (AT&T Inc.)
// meeting, cut at the meeting's own closing separator -- plus a synthesised
// `</TABLE>`/`</TEXT>`/`</DOCUMENT>`/`</SEC-DOCUMENT>` to close the excerpt,
// since the real ones sit at source lines 2962-2982 past the cut.
//
// Measured against HEAD, the fixture reproduces the full filing's behaviour on
// the two sections it covers: layout icr, status ok, 202 rows, every row's
// fund_name captured verbatim from its own ordinal-abbreviated banner (182 rows
// `1st Quarter`, 19 rows `2nd Quarter`) and every row's series_id blank.
func TestFamilyNS1071056DowTargetOrdinal(t *testing.T) {
	const fixture = "dow_target_10_q1_q2_ordinal.txt"

	// The two ordinal-abbreviated banners the fixture carries, and the
	// dictionary/header id each one names.
	want := map[string]string{
		"Dow Target 10 - 1st Quarter Portfolio": "S000007939",
		"Dow Target 10 - 2nd Quarter Portfolio": "S000007940",
	}

	rows := ns1071056Dispatch(t, fixture, "dict.tsv", "icr", 202)

	// One error per banner, not per row: the whole point is that the failure is
	// uniform across the section, so 202 identical lines would bury it.
	seen := map[string]int{}
	bad := map[string]int{}
	sample := map[string]VoteRow{}
	for _, r := range rows {
		id, ok := want[r.FundName]
		if !ok {
			t.Fatalf("fixture precondition: row carries unexpected fund_name %q (issuer=%q cusip=%q meeting=%q) -- the banner capture changed and the assertion below is measuring the wrong thing", r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate)
		}
		seen[r.FundName]++
		if r.SeriesID != id {
			if bad[r.FundName] == 0 {
				sample[r.FundName] = r
			}
			bad[r.FundName]++
		}
	}
	for banner, id := range want {
		if seen[banner] == 0 {
			t.Fatalf("fixture precondition: no row carried banner %q -- the fixture does not cover both sections", banner)
		}
		if bad[banner] > 0 {
			r := sample[banner]
			t.Errorf("ordinal-abbreviated banner %q never resolved to its own registrant's dictionary sleeve: %d of %d rows carry series=%q, want %s (first: issuer=%q cusip=%q meeting=%q desc=%q)", banner, bad[banner], seen[banner], r.SeriesID, id, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription)
		}
	}
}
