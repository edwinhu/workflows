package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The broadridge layout carries 22,922,126 vote rows and stamps series_id on
// 6.26% of them -- 21,487,068 unstamped. Everything it does stamp comes from the
// chassis single-series fallback, which fires only when a filing covers exactly
// one series; the layout itself attributes nothing, so every multi-series filing
// contributes nothing to the link.
//
// Measured over the whole 5,412-filing broadridge corpus (pulled from WRDS,
// 8.8 GB): 1,301 filings declare NO series and are unattributable in principle,
// leaving 21,592,079 rows attributable. A rule that reads the fund heading the
// filing already prints stamps 14,275,870 of them, 66.12%.
//
// THE GRAMMAR FACT THIS TEST EXISTS TO PIN: the fund heading is STATE, not a
// per-block field. It appears once, at column 0, immediately above the dashed
// rule that opens a meeting block, and it governs every block that follows until
// the next heading. In the Jackson National fixture below one heading governs 700
// lines and 23 `Agenda Number` blocks. A layout that attributes only the block
// its heading touches will pass a one-block test and still stamp almost nothing.
//
// A stamped series_id is a link key, so the direction of error matters and the
// two are not symmetric: a blank costs coverage, a WRONG one silently moves a
// fund's votes to another fund. Every assertion below demands the series the
// filing's own header declares for the heading actually printed above the block,
// matched by exact normalised equality. Hand-verification of the shipped rule ran
// 65 of 65 accepts correct; the one tolerance that erred (suffix stripping, 1 in
// 25) is deliberately not exercised here because it must not ship.

type brSeriesCase struct {
	file  string
	funds map[string]string // declared SERIES-NAME -> SERIES-ID, each governing >=1 block
	// silent holds funds whose heading opens a section reporting NO votes. They must
	// never appear among the stamped series: the only way to stamp one is to suppress
	// the silent-section reset and let its heading swallow the NEXT fund's rows, which
	// is the exact failure this suite exists to prevent.
	silent map[string]string
	note   string
}

var broadridgeSeriesCases = []brSeriesCase{
	{
		file: "B3_jackson_state.txt",
		funds: map[string]string{
			"JNL Aggressive Growth Allocation Fund": "S000014519",
			"JNL Conservative Allocation Fund":      "S000068120",
		},
		silent: map[string]string{
			"JNL Bond Index Fund": "S000071121",
		},
		note: "147 declared series; the first heading governs 700 lines and 20 agenda blocks," +
			" then a SILENT section, then a third fund with 3 blocks",
	},
	{
		file: "B2_two_funds_keeley.txt",
		funds: map[string]string{
			"Keeley All Cap Value Fund":     "S000012526",
			"Keeley Alternative Value Fund": "S000028151",
		},
		note: "7 declared series; headings 3,192 lines apart, so the state must survive the whole span",
	},
}

func loadBRSeriesFixture(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "broadridge", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(b)
}

// declaredSeriesIDs reads the SERIES-IDs out of the fixture's own SGML header.
// The fixtures are verbatim, so this is the filing's own declaration, not a
// second copy of the ground truth that could drift from it.
func declaredSeriesIDs(doc string) map[string]bool {
	out := map[string]bool{}
	for _, line := range strings.Split(doc, "\n") {
		if v, ok := strings.CutPrefix(strings.TrimSpace(line), "<SERIES-ID>"); ok {
			out[strings.TrimSpace(v)] = true
		}
	}
	return out
}

// TestBroadridgeStampsSeriesFromFundHeading is the coverage assertion: a
// multi-series broadridge filing must attribute its rows, and every fund whose
// heading governs a block in the fixture must appear among the stamped series.
func TestBroadridgeStampsSeriesFromFundHeading(t *testing.T) {
	for _, c := range broadridgeSeriesCases {
		t.Run(c.file, func(t *testing.T) {
			rows := runISSNPXDoc(t, loadBRSeriesFixture(t, c.file))
			if len(rows) == 0 {
				t.Fatalf("%s produced 0 rows; the fixture carries real vote blocks (%s)", c.file, c.note)
			}
			seen := map[string]int{}
			for _, r := range rows {
				seen[r[colSeriesID]]++
			}
			for name, id := range c.funds {
				if seen[id] == 0 {
					t.Errorf("no row carries series_id %q (%s)\n"+
						"  stamped series in this filing: %v\n"+
						"  the heading %q is printed above a block here and the filing's own"+
						" header declares that series for it\n  %s",
						id, name, seen, name, c.note)
				}
			}
			for name, id := range c.silent {
				if seen[id] > 0 {
					t.Errorf("%d rows carry series_id %q (%s), whose section reports NO votes;"+
						" that heading can only have been left standing over the NEXT fund's blocks",
						seen[id], id, name)
				}
			}
			if blank := seen[""]; blank > 0 {
				t.Errorf("%d of %d rows carry an EMPTY series_id;"+
					" every block in this fixture is governed by a heading that resolves",
					blank, len(rows))
			}
		})
	}
}

// TestBroadridgeNeverStampsAnUndeclaredSeries is the safety assertion and the one
// that must never be relaxed to raise the coverage number. A wrong series_id is
// worse than a blank: it attributes this fund's votes to a different fund.
func TestBroadridgeNeverStampsAnUndeclaredSeries(t *testing.T) {
	for _, c := range broadridgeSeriesCases {
		t.Run(c.file, func(t *testing.T) {
			doc := loadBRSeriesFixture(t, c.file)
			declared := declaredSeriesIDs(doc)
			if len(declared) == 0 {
				t.Fatalf("%s declares no series; the fixture is wrong, not the parser", c.file)
			}
			for i, r := range runISSNPXDoc(t, doc) {
				if id := r[colSeriesID]; id != "" && !declared[id] {
					t.Fatalf("row %d stamped series_id %q, which this filing never declares", i, id)
				}
			}
		})
	}
}

// TestBroadridgeHeadingGovernsEveryBlockUntilTheNext is the assertion that
// separates a real state machine from a rule that stamps only the block its
// heading touches. The second fund's rows must not be attributed to the first,
// and -- the failure mode that matters -- the first fund's LATER blocks must
// still carry the first fund's series rather than falling blank.
func TestBroadridgeHeadingGovernsEveryBlockUntilTheNext(t *testing.T) {
	const file = "B3_jackson_state.txt"
	rows := runISSNPXDoc(t, loadBRSeriesFixture(t, file))
	if len(rows) < 2 {
		t.Fatalf("%s produced %d rows, want the fixture's several blocks", file, len(rows))
	}
	first, last := rows[0][colSeriesID], rows[len(rows)-1][colSeriesID]
	if first == "" || last == "" {
		t.Fatalf("first row series_id = %q, last = %q;"+
			" a heading that governs 23 blocks cannot leave any of them blank", first, last)
	}
	if first == last {
		t.Fatalf("every row carries %q, but this fixture spans TWO fund headings"+
			" -- the second fund's blocks are being attributed to the first", first)
	}
}
