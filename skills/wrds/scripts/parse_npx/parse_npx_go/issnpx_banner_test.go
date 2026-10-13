package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The issnpx layout carries 166,281,248 vote rows -- 67% of the parsed corpus --
// and stamps series_id on 69.81% of them. The unstamped remainder is 50,199,396
// rows, more than double the next largest block. Measured on the ISS side, a row
// with no series_id cannot link, and "the fund is absent from a meeting we did
// reach" accounts for 52,874,011 ISS rows (36.43% of the ISS universe) -- the
// single largest loss in the reconciliation.
//
// The residual is NOT a name-matching-tolerance problem. Every fuzzy tolerance
// measured against held-out ground truth (11,302 (cik, heading) keys whose
// answer is known from another filing of the same registrant) errs at 2.4%-9.2%,
// and the errors are sibling funds inside one complex -- "Growth Portfolio"
// absorbed into "Mid Cap Growth Portfolio". A wrong series_id silently moves
// votes between funds, so every one of those is rejected.
//
// What remains is three DETERMINISTIC banner-extraction defects. Each reads a
// name the filing did not print, or fails to read one it did. The fixtures below
// are VERBATIM excerpts -- SGML header plus the banner region -- of the real
// filings that exhibit them.
//
//	D1  a long fund name wraps across two consecutive banner rules and the
//	    second silently REPLACES the first, so the stored name is a suffix.
//	    7,897 wrapped banner lines in 1,225 filings.
//	D2  a per-fund index letter is printed inside the banner; the stored name
//	    is "A  DWS LARGE COMPANY GROWTH FUND" against a declared
//	    "DWS Large Company Growth Fund". 143 filings.
//	D3  issFundSeparator requires a "==" prefix, but a long name shrinks the
//	    left pad to a single "="; the banner is invisible and fund stays empty
//	    for the WHOLE filing. 2,550 lines in 154 filings; 78.0% of the names
//	    recovered match a declared SERIES-NAME exactly.
//
// A stamped series_id is a link key. Every assertion here demands the series the
// filing's own header declares, matched by exact normalised equality -- never a
// near miss, and never a guess.

// A GAP IN THE SPEC, FOUND BY RUNNING THESE TESTS AND LEFT VISIBLE ON PURPOSE.
// D1's joined banner reads
//
//	MORGAN STANLEY INSTITUTIONAL FUND INC. ACTIVE INTERNATIONAL ALLOCATION PORTFOLIO
//
// while the series it belongs to is declared as
//
//	<SERIES-NAME>ACTIVE INTERNATIONAL ALLOCATION PORTFOLIO
//
// so reassembling the wrapped banner is NECESSARY but NOT SUFFICIENT: the joined
// name still does not equal the declared one. The leading text is exactly the
// filing's own COMPANY CONFORMED NAME ("MORGAN STANLEY INSTITUTIONAL FUND INC"),
// which means a deterministic strip is available -- exact equality against a
// value the same header declares, the same character as the broadridge code
// strip, and not a fuzzy tolerance. It is nonetheless UNMEASURED: nobody has
// counted how many headings it moves or whether it ever strips a prefix that was
// part of the fund's real name.
//
// The assertion below therefore demands the outcome, not the mechanism. If the
// registrant-prefix strip cannot be made safe, D1 is reported as open rather than
// closed by widening the match until it passes.

// GROUND TRUTH CORRECTION, 2026-08-29. The three series ids below were originally
// written as S000010764 / S000005395 / S000005538. Those values appear NOWHERE in
// these fixtures -- I wrote plausible-looking ids from memory instead of reading
// them out of the bytes, and three independent reviewers caught it. The values now
// used are grepped from each fixture's own SGML header, matched to the exact
// SERIES-NAME its banner prints. The parser had been stamping these correctly the
// whole time; the test was demanding invented numbers.
type issnpxBannerCase struct {
	file   string
	fund   string // the fund name the filing PRINTED, once reassembled
	series string // the SERIES-ID its own header declares for that name
	defect string
}

var issnpxBannerCases = []issnpxBannerCase{
	{
		file:   "D1_wrapped_banner.txt",
		fund:   "MORGAN STANLEY INSTITUTIONAL FUND INC. ACTIVE INTERNATIONAL ALLOCATION PORTFOLIO",
		series: "S000002820",
		defect: "banner wraps across two rules; today the layout keeps only 'ALLOCATION PORTFOLIO'",
	},
	{
		file:   "D2_index_letter.txt",
		fund:   "DWS LARGE COMPANY GROWTH FUND",
		series: "S000005707",
		defect: "index letter 'A' printed inside the banner survives as part of the name",
	},
	{
		file:   "D3_single_equals.txt",
		fund:   "Invesco European Small Company Fund",
		series: "S000000212",
		defect: "single leading '=' makes the banner invisible to issFundSeparator",
	},
}

func loadISSNPXFixture(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(b)
}

// issnpxBannerRows drives the whole binary the way the grid does -- the same
// path runISSNPXDoc uses -- and returns (series_id, fund_name) per emitted row.
func issnpxBannerRows(t *testing.T, name string) [][]string {
	t.Helper()
	return runISSNPXDoc(t, loadISSNPXFixture(t, name))
}

// TestISSNPXBannerDefectsStampTheDeclaredSeries is the user-visible assertion:
// every emitted row of the fixture carries the series_id the filing's own header
// declares for the fund whose banner opens the block.
func TestISSNPXBannerDefectsStampTheDeclaredSeries(t *testing.T) {
	for _, c := range issnpxBannerCases {
		t.Run(c.file, func(t *testing.T) {
			got := issnpxBannerRows(t, c.file)
			if len(got) == 0 {
				t.Fatalf("%s produced 0 rows -- %s", c.file, c.defect)
			}
			for i, r := range got {
				if r[colSeriesID] != c.series {
					t.Fatalf("row %d: series_id = %q, want %q\n"+
						"  fund_name = %q\n"+
						"  the filing declares %q for the fund its banner names, %q\n"+
						"  defect: %s",
						i, r[colSeriesID], c.series, r[colFundName], c.series, c.fund, c.defect)
				}
			}
		})
	}
}

// TestISSNPXBannerNameIsWhatTheFilingPrinted guards the failure mode that would
// make the test above pass dishonestly. A layout could stamp the right series by
// guessing -- falling back to the filing's only series, or to positional order --
// and the series assertion alone would not notice. The fund_name it stored must
// be the name actually printed, reassembled where the filing wrapped it.
func TestISSNPXBannerNameIsWhatTheFilingPrinted(t *testing.T) {
	for _, c := range issnpxBannerCases {
		t.Run(c.file, func(t *testing.T) {
			got := issnpxBannerRows(t, c.file)
			if len(got) == 0 {
				t.Fatalf("%s produced 0 rows", c.file)
			}
			want := normalizeSeriesName(c.fund)
			for i, r := range got {
				if normalizeSeriesName(r[colFundName]) != want {
					t.Fatalf("row %d: fund_name = %q\n  normalises to %q, want %q (from %q)\n"+
						"  defect: %s",
						i, r[colFundName], normalizeSeriesName(r[colFundName]), want, c.fund, c.defect)
				}
			}
		})
	}
}

// TestISSNPXBannerNeverStampsAnUndeclaredSeries is the safety assertion. It is
// the one that must not be relaxed: every series_id emitted has to appear in the
// filing's own SGML header. A layout that invents, or that borrows a series from
// a neighbouring fund, fails here even if it stamps more rows.
func TestISSNPXBannerNeverStampsAnUndeclaredSeries(t *testing.T) {
	for _, c := range issnpxBannerCases {
		t.Run(c.file, func(t *testing.T) {
			raw := loadISSNPXFixture(t, c.file)
			declared := map[string]bool{}
			for _, line := range strings.Split(raw, "\n") {
				if v, ok := strings.CutPrefix(strings.TrimSpace(line), "<SERIES-ID>"); ok {
					declared[strings.TrimSpace(v)] = true
				}
			}
			if len(declared) == 0 {
				t.Fatalf("%s declares no series; the fixture is wrong, not the parser", c.file)
			}
			for i, r := range issnpxBannerRows(t, c.file) {
				if r[colSeriesID] != "" && !declared[r[colSeriesID]] {
					t.Fatalf("row %d stamped series_id %q, which the filing never declares"+
						" -- that attributes this fund's votes to a fund the filing does not name",
						i, r[colSeriesID])
				}
			}
		})
	}
}
