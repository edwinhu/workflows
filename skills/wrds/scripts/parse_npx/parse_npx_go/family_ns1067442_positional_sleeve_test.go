package main

import (
	"path/filepath"
	"sort"
	"testing"
)

const ns1067442SleeveDir = "family_ns1067442_positional_sleeve"

// ns1067442SleeveDispatch runs the fixture through the same top-level entry
// point production uses -- processFile, which sniffs the layout itself -- with
// the CIK's real cik_series.tsv rows loaded and no overlay, so nothing below
// depends on a hand-built FilingMeta or a hand-picked reader.
func ns1067442SleeveDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns1067442SleeveDir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1067442SleeveDir, fixture), sink, make([]byte, headBytes))
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

// 000106/1067442/0000067590-06-000172.txt (STRATEGIC PARTNERS ASSET ALLOCATION
// FUNDS, CIK 1067442, period 20060630, manifest layout `issnpx`): 428
// known-registrant no_series rows, all of them under exactly two of the
// filing's 36 vote-table section banners.
//
// THE FILING'S SHAPE. The SGML <SERIES-AND-CLASSES-CONTRACTS-DATA> block
// declares exactly three series, and no more:
//
//	S000004703  STRATEGIC PARTNERS CONSERVATIVE ALLOCATION FUND
//	S000004704  STRATEGIC PARTNERS MODERATE ALLOCATION FUND
//	S000004705  STRATEGIC PARTNERS GROWTH ALLOCATION FUND
//
// Each is a fund of sub-advised sleeves, and the vendor prints one `=`-ruled
// (decoration-wrapped, two physical lines) section banner per sleeve:
// `STRATEGIC PARTNERS CONSERVATIVE ALLOCATION FUND - LARGE CAP VALUE SLEEVE -
// ADVISOR: J.P. MORGAN` and 33 siblings like it, which the issnpx chain already
// resolves today by cutting the sleeve/advisor suffix back to the declared name.
// Two banners do not resolve, and those two own the whole residue.
//
// DEFECT 1 -- source line 13640-13641, 214 rows in production, 8 in this cut:
//
//	=========== STRATEGIC PARTNERS CONSERVATIVE GROWTH ALLOCATION FUND - ===========
//	===========          SMALL CAP VALUE SLEEVE - ADVISOR: NFJ           ===========
//
// The word GROWTH is spliced into what should read CONSERVATIVE ALLOCATION FUND.
// No spelling rung can settle it: the banner's token run contains BOTH declared
// names as a subsequence (STRATEGIC PARTNERS [CONSERVATIVE] GROWTH ALLOCATION
// FUND and STRATEGIC PARTNERS CONSERVATIVE [GROWTH] ALLOCATION FUND), so
// CONSERVATIVE and GROWTH are equally good matches on the words alone.
//
// What settles it is the filing's own SLEEVE ROSTER, which this fixture carries
// whole (all 36 banners are present). Sorting the 34 resolved banners by
// declared series and by sleeve/advisor suffix:
//
//	suffix `SMALL CAP VALUE SLEEVE - ADVISOR: NFJ`
//	  S000004705 GROWTH    -> present   (source line 32213)
//	  S000004704 MODERATE  -> present   (source line 54001)
//	  S000004703 CONSERV.  -> ABSENT
//
// Conservative is the ONE declared series whose roster is missing exactly that
// suffix, and the garbled banner prints exactly that suffix. The two
// independently-resolved peers claim the other two series, one apiece, leaving
// one seat; the garbled banner is that seat. Conservative's sibling small-cap
// sleeves -- EARNEST PARTNERS and VAUGHN NELSON, both resolved -- confirm the
// fund really does run a small-cap-value book, so the NFJ seat is a real sleeve
// and not an artifact.
//
// POSITION IS NOT EVIDENCE HERE -- DO NOT BUILD THE RULE ON IT. The brief for
// this fixture described the bracketing as positional: the garbled banner sits
// after the last Conservative sleeve (source line 13628, TRB - PIMCO) and before
// the first Growth sleeve (14397, ADVISOR: JENNISON), inside an unbroken run of
// Conservative sections. That reading is confounded. The filing's 36 sections
// are in ASCII order of their own banner text -- CONSERVATIVE ALLOCATION ... <
// CONSERVATIVE GROWTH ALLOCATION ... < GROWTH ALLOCATION ... < LARGE
// CAPITALIZATION ... < MODERATE ALLOC. ... < MODERATE ALLOCATION ..., and within
// each fund ADVISOR: < HIGH YIELD < INTL < LARGE CAP < SMALL CAP < TRB. Section
// position is therefore a deterministic function of the printed banner string:
// a banner reading CONSERVATIVE GROWTH ALLOCATION sorts into that slot whichever
// fund it truly belongs to, so its neighbours carry no information the banner
// text did not already carry. A positional-bracketing rung would be measuring
// the sort key, not the filing. The roster/elimination reading above is the
// sound one, and it is what the assertion below is written against; the
// assertion reads only series_id, so any rung that reaches the same answer
// passes.
//
// DEFECT 2 IS NOT A DEFECT -- source line 34111-34112, 214 rows in production,
// 8 in this cut:
//
//	============= STRATEGIC PARTNERS LARGE CAPITALIZATION VALUE FUND - =============
//	=============                     ADVISOR: NFJ                     =============
//
// The brief expected these rows to resolve to S000004705 (GROWTH ALLOCATION) on
// the same positional argument. They must NOT. This banner names a real fund,
// and it belongs to a DIFFERENT REGISTRANT: CIK 1090155, STRATEGIC PARTNERS
// STYLE SPECIFIC FUNDS, whose own header declares S000004719 LARGE
// CAPITALIZATION VALUE FUND. Verified against the corpus:
//
//   - cik_series.tsv: 0001090155 S000004719 `LARGE CAPITALIZATION VALUE FUND`
//     20060630, declared in 000109/1090155/0000067590-06-000173.txt -- the
//     sibling filing lodged by the same filer agent (0000067590) on the same day,
//     accession +1.
//   - That filing prints the byte-identical banner at its own line 6899-6900, and
//     the 757-line section body under it is byte-identical to the 757 lines under
//     line 34111 here (md5 a722c6522894cef4a3049749b8c171e7 over both cuts).
//     The vendor pasted one registrant's section into the other's report.
//   - Nothing in CIK 1067442's roster wants it. All three of this filing's funds
//     run a LARGE CAP VALUE sleeve with HOTCHKIS & WILEY and J.P. MORGAN and no
//     third advisor, so the LCV-NFJ seat is missing from all THREE rosters, not
//     one -- the elimination that settles defect 1 is ambiguous three ways here
//     and must refuse. And the Growth fund's NFJ seat is already taken: its
//     SMALL CAP VALUE SLEEVE - ADVISOR: NFJ section is right there at source line
//     32213. Stamping S000004705 on line 34111 would give one fund two different
//     NFJ sections and would attribute a sibling CIK's votes to this registrant.
//
// So these 8 rows are floor: a sibling-registrant bleed-through, unreachable
// without borrowing across CIKs, which this project does not do. The assertion
// below pins them BLANK deliberately, as a tripwire -- if a later positional or
// nearest-neighbour rung lands S000004705 (or anything else) on them, this test
// must fail, because that rung is wrong even when it happens to look plausible.
//
// SCOPE NOTE FOR WHOEVER DESIGNS THE FIX. Fire only on a banner that reaches the
// end of the issnpx chain unresolved, and only when: (a) the banner's
// sleeve/advisor suffix, taken verbatim, also appears on at least two OTHER
// banners in the SAME filing that each resolved, independently, to a DIFFERENT
// declared series; (b) exactly ONE declared series of the filing's own closed
// header lacks that suffix; and (c) that same series is not claimed by any other
// unresolved banner. Refuse on any tie, on a suffix that appears nowhere else in
// the filing, and on any banner whose fund-name slot matches a declared name of
// some OTHER CIK -- never widen to a sibling CIK and never to the corpus
// dictionary (eliminating against this CIK's full dictionary, which spans
// 2006-2018 and the TARGET/PRUDENTIAL/PGIM-era renames, would leave seats
// unclaimed and say nothing). Do NOT implement bracketing by section position:
// see POSITION IS NOT EVIDENCE above.
func TestFamilyNS1067442PositionalSleeve(t *testing.T) {
	const (
		fixture = "spaa2006_garbled_sleeve_banners.txt"

		// The two banners that do not resolve today, as the parser emits them
		// (the two decoration-wrapped physical lines joined).
		garbled = "STRATEGIC PARTNERS CONSERVATIVE GROWTH ALLOCATION FUND - SMALL CAP VALUE SLEEVE - ADVISOR: NFJ"
		bleed   = "STRATEGIC PARTNERS LARGE CAPITALIZATION VALUE FUND - ADVISOR: NFJ"

		conservative = "S000004703"
		moderate     = "S000004704"
		growth       = "S000004705"

		// MEASURED on the fixture, not derived. The cut keeps all 36 banners and
		// trims each section's vote table to its first two issuer blocks, so the
		// counts below are the cut's, not production's 428-row residue.
		wantRows = 513
	)

	// Every distinct fund_name the fixture yields, with the series_id its rows
	// must carry. 34 entries are today's behaviour and are pure regression
	// guards; `garbled` is the defect (blank today, must become S000004703);
	// `bleed` is pinned blank on purpose (see DEFECT 2 IS NOT A DEFECT above).
	type want struct {
		series string
		rows   int
	}
	wantByBanner := map[string]want{
		"STRATEGIC PARTNERS CONSERVATIVE ALLOCATION FUND - ADVISOR: JENNISON":                                  {conservative, 25},
		"STRATEGIC PARTNERS CONSERVATIVE ALLOCATION FUND - HIGH YIELD BOND - ADVISOR: GOLDMAN SACHS":           {conservative, 8},
		"STRATEGIC PARTNERS CONSERVATIVE ALLOCATION FUND - LARGE CAP GROWTH - ADVISOR: MARSICO":                {conservative, 23},
		"STRATEGIC PARTNERS CONSERVATIVE ALLOCATION FUND - LARGE CAP GROWTH SLEEVE - ADVISOR: GOLDMAN SACHS":   {conservative, 11},
		"STRATEGIC PARTNERS CONSERVATIVE ALLOCATION FUND - LARGE CAP VALUE SLEEVE - ADVISOR: HOTCHKIS & WILEY": {conservative, 7},
		"STRATEGIC PARTNERS CONSERVATIVE ALLOCATION FUND - LARGE CAP VALUE SLEEVE - ADVISOR: J.P. MORGAN":      {conservative, 22},
		"STRATEGIC PARTNERS CONSERVATIVE ALLOCATION FUND - SMALL CAP GROWTH SLEEVE - ADVISOR: RS INVESTMENTS":  {conservative, 7},
		"STRATEGIC PARTNERS CONSERVATIVE ALLOCATION FUND - SMALL CAP VALUE SLEEVE - ADVISOR: EARNEST PARTNERS": {conservative, 8},
		"STRATEGIC PARTNERS CONSERVATIVE ALLOCATION FUND - SMALL CAP VALUE SLEEVE - ADVISOR: VAUGHN NELSON":    {conservative, 10},

		// THE DEFECT: blank today, must resolve to the Conservative fund.
		garbled: {conservative, 8},

		"STRATEGIC PARTNERS GROWTH ALLOCATION FUND - ADVISOR: JENNISON":                                  {growth, 25},
		"STRATEGIC PARTNERS GROWTH ALLOCATION FUND - INTL SLEEVE - ADVISOR: LSV":                         {growth, 33},
		"STRATEGIC PARTNERS GROWTH ALLOCATION FUND - INTL SLEEVE - ADVISOR: THORNBURG":                   {growth, 30},
		"STRATEGIC PARTNERS GROWTH ALLOCATION FUND - LARGE CAP GROWTH - ADVISOR: MARSICO":                {growth, 23},
		"STRATEGIC PARTNERS GROWTH ALLOCATION FUND - LARGE CAP GROWTH SLEEVE - ADVISOR: GOLDMAN SACHS":   {growth, 11},
		"STRATEGIC PARTNERS GROWTH ALLOCATION FUND - LARGE CAP VALUE SLEEVE - ADVISOR: HOTCHKIS & WILEY": {growth, 7},
		"STRATEGIC PARTNERS GROWTH ALLOCATION FUND - LARGE CAP VALUE SLEEVE - ADVISOR: J.P. MORGAN":      {growth, 22},
		"STRATEGIC PARTNERS GROWTH ALLOCATION FUND - SMALL CAP GROWTH SLEEVE - ADVISOR: RS INVESTMENTS":  {growth, 7},
		"STRATEGIC PARTNERS GROWTH ALLOCATION FUND - SMALL CAP VALUE SLEEVE - ADVISOR: EARNEST PARTNERS": {growth, 8},
		// The Growth fund's OWN NFJ small-cap-value seat, already resolved. This
		// row is why `bleed` cannot also be Growth.
		"STRATEGIC PARTNERS GROWTH ALLOCATION FUND - SMALL CAP VALUE SLEEVE - ADVISOR: NFJ":           {growth, 8},
		"STRATEGIC PARTNERS GROWTH ALLOCATION FUND - SMALL CAP VALUE SLEEVE - ADVISOR: VAUGHN NELSON": {growth, 10},

		// FLOOR, pinned blank: CIK 1090155's S000004719, pasted in by the filer
		// agent. Resolving it at all would mean borrowing across CIKs.
		bleed: {"", 8},

		"STRATEGIC PARTNERS MODERATE ALLOC. FUND - HIGH YIELD BOND - ADVISOR: GOLDMAN SACHS":               {moderate, 8},
		"STRATEGIC PARTNERS MODERATE ALLOC. FUND - SMALL CAP VALUE SLEEVE - ADVISOR: VAUGHN NELSON":        {moderate, 10},
		"STRATEGIC PARTNERS MODERATE ALLOCATION FUND - ADVISOR: JENNISON":                                  {moderate, 25},
		"STRATEGIC PARTNERS MODERATE ALLOCATION FUND - INTL SLEEVE - ADVISOR: LSV":                         {moderate, 33},
		"STRATEGIC PARTNERS MODERATE ALLOCATION FUND - INTL SLEEVE - ADVISOR: THORNBURG":                   {moderate, 30},
		"STRATEGIC PARTNERS MODERATE ALLOCATION FUND - LARGE CAP GROWTH - ADVISOR: MARSICO":                {moderate, 23},
		"STRATEGIC PARTNERS MODERATE ALLOCATION FUND - LARGE CAP GROWTH SLEEVE - ADVISOR: GOLDMAN SACHS":   {moderate, 11},
		"STRATEGIC PARTNERS MODERATE ALLOCATION FUND - LARGE CAP VALUE SLEEVE - ADVISOR: HOTCHKIS & WILEY": {moderate, 7},
		"STRATEGIC PARTNERS MODERATE ALLOCATION FUND - LARGE CAP VALUE SLEEVE - ADVISOR: J.P. MORGAN":      {moderate, 22},
		"STRATEGIC PARTNERS MODERATE ALLOCATION FUND - SMALL CAP GROWTH SLEEVE - ADVISOR: RS INVESTMENTS":  {moderate, 7},
		"STRATEGIC PARTNERS MODERATE ALLOCATION FUND - SMALL CAP VALUE SLEEVE - ADVISOR: EARNEST PARTNERS": {moderate, 8},
		"STRATEGIC PARTNERS MODERATE ALLOCATION FUND - SMALL CAP VALUE SLEEVE - ADVISOR: NFJ":              {moderate, 8},
	}

	rows := ns1067442SleeveDispatch(t, fixture, "dict.tsv", "issnpx", wantRows)

	// got[banner][series_id] = row count, so a partially-resolved section is
	// visible rather than averaged away.
	got := map[string]map[string]int{}
	for _, r := range rows {
		if got[r.FundName] == nil {
			got[r.FundName] = map[string]int{}
		}
		got[r.FundName][r.SeriesID]++
	}

	// FIXTURE TRIPWIRE, not the defect: the cut must still yield exactly the 36
	// banners and the per-banner row counts the table was measured against. If
	// this fires, re-measure the fixture rather than believing the assertions.
	if len(got) != len(wantByBanner) {
		var extra []string
		for b := range got {
			if _, ok := wantByBanner[b]; !ok {
				extra = append(extra, b)
			}
		}
		sort.Strings(extra)
		t.Fatalf("fixture precondition: %d distinct banners in output, want %d; unexpected: %q", len(got), len(wantByBanner), extra)
	}
	banners := make([]string, 0, len(wantByBanner))
	for b := range wantByBanner {
		banners = append(banners, b)
	}
	sort.Strings(banners)
	for _, b := range banners {
		n := 0
		for _, c := range got[b] {
			n += c
		}
		if n != wantByBanner[b].rows {
			t.Fatalf("fixture precondition: banner %q yielded %d rows, want %d", b, n, wantByBanner[b].rows)
		}
	}

	// THE DEFECT, and the regression guard, read off the same table.
	for _, b := range banners {
		w := wantByBanner[b]
		if got[b][w.series] == w.rows && len(got[b]) == 1 {
			continue
		}
		switch b {
		case garbled:
			t.Errorf("garbled banner %q: rows carry series_id %v, want all %d rows on %s (CONSERVATIVE ALLOCATION FUND).\n"+
				"  The banner splices GROWTH into the Conservative fund's declared name (source line 13640-13641), so it spell-matches CONSERVATIVE and GROWTH equally and the issnpx chain resolves neither.\n"+
				"  The filing's own roster settles it: the suffix %q also appears on two OTHER resolved banners in this same filing -- under %s (source line 32213) and %s (source line 54001) -- and %s is the one declared series of the filing's three-series header that has no banner with that suffix. One seat, one claimant.\n"+
				"  Do NOT reach this by section position: the filing's 36 sections are in ASCII order of their own banner text, so the Conservative sections that surround this one surround it because of how the garbled string sorts, not because of which fund it is.",
				b, got[b], w.rows, w.series, "SMALL CAP VALUE SLEEVE - ADVISOR: NFJ", growth, moderate, w.series)
		case bleed:
			t.Errorf("bleed-through banner %q: rows carry series_id %v, want all %d rows BLANK.\n"+
				"  This banner names CIK 1090155's declared series S000004719 (STRATEGIC PARTNERS STYLE SPECIFIC FUNDS), not a series of CIK 1067442, and the 757-line section under it in the real filing is byte-identical to that registrant's own copy in 000109/1090155/0000067590-06-000173.txt (line 6899). It is a filer-agent paste, and it is floor.\n"+
				"  If this fired with %s, the rung under test is guessing from position or nearest neighbour: all three of this filing's funds lack an LCV-NFJ seat (so elimination is ambiguous three ways and must refuse), and the Growth fund's NFJ seat is already filled by its SMALL CAP VALUE SLEEVE - ADVISOR: NFJ section at source line 32213.",
				b, got[b], w.rows, growth)
		default:
			t.Errorf("REGRESSION on a clean sibling section %q: rows carry series_id %v, want all %d rows on %s. This banner resolves today; a new rung must not disturb it.",
				b, got[b], w.rows, w.series)
		}
	}
}
