package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// 000105/1053425/0000950135-07-005427.txt (HARTFORD SERIES FUND INC, CIK
// 1053425, period 20070630): the largest unfloored no_series family in the
// corpus ranking, 812 blank-series rows out of 26,664 measured with the
// corpus's own cik_series.tsv and series_map_applied.tsv loaded
// (parse_npx_go_367 on WRDS, 2026-09-26).
//
// WHICH READER OWNS THESE ROWS. The manifest calls this filing `broadridge`
// and parseBroadridge does read it -- but only 20,438 of the 26,664 rows. The
// other 6,226 come from icrSupplement (text_parser.go:508), the mixed-document
// pass that offers the ICR reader every body a different layout won. So the
// grammar at fault is layout_icr.go even though nothing in the manifest says
// `icr`, which is why a run of the whole filing is the only way to see it.
//
// THE DOCUMENT ALTERNATES TWO GRAMMARS, one per fund section.
//
// G1, the paginated `PROXY VOTING RECORD` grammar, opens with a masthead and
// prints its ballots under a column header of its own:
//
//	ITEM 1: PROXY VOTING RECORD
//
//	Hartford Index HLS Fund
//	...
//	ISSUE NO.      DESCRIPTION      PROPONENT    MGMT REC   VOTE CAST   FOR/AGNST MGMT
//
// G2 is the ICR grammar proper -- `Investment Company Report`, the fund
// banner, the issuer, a SECURITY/TICKER SYMBOL/ISIN label block, an
// ITEM/PROPOSAL/TYPE/VOTE table, and then a settlement table that is NOT a
// ballot at all:
//
//	ACCOUNT NUMBER   CUSTODIAN   BALLOT SHARES   SHARES        VOTE DATE     DATE CONFIRMED
//	997QR1E          837         2376550         0             17-Jul-2006   17-Jul-2006
//
// parseBroadridge reads all 21 G2 sections and names every one of their funds.
// icrSupplement then reads the 2 G1 sections, which broadridge cannot, and
// names those funds too -- 5,414 correctly attributed rows. Everything the ICR
// reader contributes ON TOP of that, over the G2 regions broadridge already
// owns, is the whole of the 812.
//
// THE DEFECT IS THE G1 -> G2 SEAM, and it has two spellings in these bytes.
// Source lines 83466-83474, the last ballot of the XERIUM TECHNOLOGIES G1
// meeting followed by the seam:
//
//	2                RATIFICATION OF APPOINTMENT OF       Mgmt         For        For         For
//	                 ERNST & YOUNG LLP.
//	</TABLE>
//	<PAGE>
//
//	                            Investment Company Report
//
//	Hartford Stock HLS Fund
//
// and source lines 57260-57266, the same seam with a COMPLETE ballot row in
// the slot instead of a wrapped description tail:
//
//	3              Transaction of Other Business              Mgmt         For        Against     Against
//	</TABLE>
//	<PAGE>
//
//	                            Investment Company Report
//
//	Hartford International Capital Appreciation HLS Fund
//
// At neither seam does the ICR reader take the banner the filing prints. It
// does not open the G2 meeting either: `AT&T INC.`, its label block and its
// ITEM/PROPOSAL table are all stepped over. The ONLY thing it emits across the
// whole following G2 region is the SETTLEMENT table, read as ballots --
// `item_seq=997QR1E  description=837  how_voted=17-Jul-2006`, carrying the
// stale issuer of the last G1 meeting -- and it stamps each of those rows with
// a fund banner lifted from the tail of the G1 table above the seam. Measured
// over the whole filing, `awk -F'\t' '$8==""{print $10}' | sort | uniq -c`:
//
//	145  QR1M  50P  4341157  0  21-Jun-2007  21-Jun-2007
//	110  QR6N  50P  353992  39008  19-Jun-2007  19-Jun-2007
//	100  ERNST & YOUNG LLP.
//	 97  respect to which the registrant exercised its voting rights.
//	 95  FIX  Annual  Management  Yes  For  For  For
//	 91  QR2A  50P  719000  824000  19-Jun-2007  19-Jun-2007
//	 89  3  Transaction of Other Business  Mgmt  For  Against  Against
//	 85  QR6M  50P  2584509  0  21-Jun-2007  21-Jun-2007
//
// 780 of the 812 have a date where how_voted belongs; the remaining 32 are
// column-mangled misreads of ballots broadridge already read correctly
// (`L.W. STRANGHOENER For For II`, `JOHN T. REDMOND$ For For C`).
//
// SO THIS IS NOT A FLOOR AND NOT A LOOKUP FAILURE. Every fund named in these
// blank rows' own section IS printed in the filing and IS declared in its SGML
// header -- `Hartford Stock HLS Fund` is <SERIES-ID>S000003221, and
// parseBroadridge resolves it 1,180 times in this same filing. The rows are
// blank because they are not ballots: the right outcome for them is not a fund
// name, it is not existing. Both assertions below are therefore stated
// negatively, and both hold under any fix: a line the filing printed inside a
// vote table is never a fund banner, and a settlement row is never a ballot.
//
// WHY THE FIXTURES ARE `.npx` AND NOT `.txt`. Same reason as family
// NS-790558-subadvised-caption: TestHowVotedVocabularyInvariant sweeps every
// `*.txt` under testdata/ and asserts no emitted how_voted is a non-vote, and
// these bytes emit `17-Jul-2006` as a vote. That IS the defect asserted here,
// so it is asserted here by name rather than left to a corpus sweep that would
// report it against a file instead of against a grammar rule.
//
// READ THIS BEFORE FIXING -- the NS-790558 collision, measured, and it is NOT
// the one the two reverted attempts hit. Those added an `icrSettlementHeader`
// matcher that CLOSED the open fund section, which wiped the banner the
// 790558 Kayne section carries; nothing below asks for that, and a fix that
// merely refuses to emit the settlement rows cannot reach that fixture's
// banner state. But 790558 has a second, quieter dependency. Measured on HEAD
// against its own fixture, parseICR yields 94 rows, 90 of which resolve to
// S000004109 -- and 89 of those 90 are settlement rows with a date in
// how_voted, exactly the junk that fixture's own docstring records as "a third
// defect in these same bytes". Its guard reads `if resolved < 60`. Stop
// emitting the settlement rows and that count falls 90 -> 1 and the guard
// fails on a fixture whose fund association is perfectly intact. The guard is
// counting the defect, so it has to be re-expressed over real ballots (rows
// whose how_voted is a vote) in the same change that lands the fix. That is a
// test edit, not a grammar concession.
func TestFamilyNS1053425ICRG1TailBanner(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	// Verbatim from the filing's own SGML header. Only the two series the two
	// cuts name are listed; no dictionary and no overlay is loaded, so nothing
	// below depends on a lookup.
	meta := FilingMeta{
		CIK:            "0001053425",
		CompanyName:    "HARTFORD SERIES FUND INC",
		PeriodOfReport: "20070630",
		SeriesDecls: []SeriesDecl{
			{SeriesID: "S000003212", Name: "Hartford International Capital Appreciation HLS Fund"},
			{SeriesID: "S000003221", Name: "Hartford Stock HLS Fund"},
		},
	}

	// settlementVote is the shape the `VOTE DATE` column prints. The ICR
	// grammar's vote vocabulary is For / Against / Abstain / Withhold / `*`, so
	// a date in that column is proof the row came from the settlement table and
	// not from a ballot -- no name list to keep current.
	settlementVote := regexp.MustCompile(`^\d{2}-[A-Z][a-z]{2}-\d{4}$`)

	cases := []struct {
		name string
		file string
		// sourceLines is the one contiguous cut each fixture is, no seams and
		// nothing added.
		sourceLines string
		// guard is a ballot from the G1 meeting AHEAD of the seam. If it stops
		// reading, the cut is broken and the assertions prove nothing.
		guard string
		// tail is the line the filing prints as the last thing inside that G1
		// table -- the line that becomes the fund banner today.
		tail string
		// banner is what the filing actually prints after the seam, and the
		// series its own header declares for it.
		banner   string
		bannerID string
	}{
		{
			name:        "wrapped_description_tail",
			file:        "hls2007_stock_after_wrapped_description_tail.npx",
			sourceLines: "83412-83528",
			guard:       "Elect John Saunders",
			tail:        "ERNST & YOUNG LLP.",
			banner:      "Hartford Stock HLS Fund",
			bannerID:    "S000003221",
		},
		{
			name:        "complete_ballot_row_tail",
			file:        "hls2007_intlcapapp_after_vote_row_tail.npx",
			sourceLines: "57216-57302",
			guard:       "Elect Steven Wheelwright",
			tail:        "3  Transaction of Other Business  Mgmt  For  Against  Against",
			banner:      "Hartford International Capital Appreciation HLS Fund",
			bannerID:    "S000003212",
		},
	}

	dir := filepath.Join("testdata", "family_ns1053425_icr_after_g1_tail")
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b, err := os.ReadFile(filepath.Join(dir, tc.file))
			if err != nil {
				t.Fatal(err)
			}
			rows, err := parseICR(string(stripHTML(b)), meta)
			if err != nil {
				t.Fatal(err)
			}

			// The cut still reads the G1 meeting ahead of the seam.
			guarded := false
			for _, r := range rows {
				if r.VoteDescription == tc.guard {
					guarded = true
				}
			}
			if !guarded {
				t.Fatalf("fixture guard: no row carries %q -- the G1 meeting at source lines %s stopped reading, so the cut is broken rather than the grammar", tc.guard, tc.sourceLines)
			}
			// The filing prints the banner in these bytes; if the cut lost it
			// the assertions below would pass for the wrong reason.
			if !strings.Contains(string(b), tc.banner) {
				t.Fatalf("fixture guard: the cut does not contain %q -- source lines %s no longer span the seam", tc.banner, tc.sourceLines)
			}

			for _, r := range rows {
				// A line the filing printed INSIDE a vote table is not a fund
				// banner. The banner is the line the filing prints after
				// `Investment Company Report`, and the header declares it.
				if strings.TrimSpace(r.FundName) == tc.tail {
					t.Errorf("item %q (%q): fund=%q -- that is the last line the G1 vote table prints above the seam, not a fund banner; the banner this section opens with is %q, which the filing's own header declares as %s",
						r.ItemSeq, r.VoteDescription, r.FundName, tc.banner, tc.bannerID)
				}
				// A settlement row is not a ballot. `ACCOUNT NUMBER /
				// CUSTODIAN / BALLOT SHARES / SHARES / VOTE DATE / DATE
				// CONFIRMED` records how a ballot was delivered; the vote it
				// delivered is in the ITEM/PROPOSAL table above it, which
				// parseBroadridge already read.
				if settlementVote.MatchString(r.HowVoted) {
					t.Errorf("row item=%q desc=%q how_voted=%q fund=%q -- this is a row of the `ACCOUNT NUMBER / CUSTODIAN / BALLOT SHARES / SHARES / VOTE DATE / DATE CONFIRMED` settlement table read as a ballot: item_seq is a custodian account code, description is the custodian, and how_voted is the confirmation date",
						r.ItemSeq, r.VoteDescription, r.HowVoted, r.FundName)
				}
			}
		})
	}
}
