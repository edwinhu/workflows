package main

import (
	"regexp"
	"strings"
	"testing"
)

// Three rounds of heuristics have not closed the Vanguard cell-boundary problem,
// and they cannot, because the information needed to solve it is destroyed
// before the layout ever runs.
//
// collapseSpaces (html.go) squeezes every run of horizontal whitespace to a
// single space. A fixed-width Vanguard row prints
//
//	ELECTION OF DIRECTOR: JANE DOE        ISSUER      YES      Withhold All      Non-Voting
//
// and the layout receives
//
//	ELECTION OF DIRECTOR: JANE DOE ISSUER YES Withhold All Non-Voting
//
// in which the boundary between the VOTE CAST cell and the MGMT cell is not
// merely hard to find -- it is absent. Every rule that recovers it is guessing,
// and the guesses fail exactly where measured:
//
//	cast "Withhold All",     mgmt "Non-Voting"  -> how_voted "Withhold All Non-Voting", mgmt ""
//	cast "Refer To Adviser", mgmt "Non-Voting"  -> 0 rows
//
// while a symmetric pair happens to work by luck. Reporting "Withhold All
// Non-Voting" as how_voted is reporting a value the filing never printed in that
// cell, which breaks the verbatim guarantee README.md makes; dropping the row
// produces parse_status=ok with n_rows=0, the failure this whole change set
// exists to remove.
//
// The layout originally had the right design for this. It carried a
// vanguardColumnGap ` {2,}` separator and a wide-gap branch in
// vanguardSplitColumns that was written to be the PRIMARY path; normalisation
// made that branch unreachable, and a later round deleted it as dead code. The
// dead code was the symptom. The fix is to stop destroying the gap, so a
// separator-based split becomes possible again -- not to guess better.
//
// Nothing else depends on the collapse width. issnpx and broadridge both read
// their lines with strings.Fields and strings.Split on "\n", neither of which
// can see how wide a horizontal run was, and no test pins the width. The
// mechanical check -- which runs broadridge's eight real-filing fixtures, the
// issnpx fixtures and the Vanguard V1/V2/V3 ground truth -- is the guard on that
// claim.

// columnGapSplit is the separator a fixed-width row uses: two or more spaces,
// or a tab. Declared here rather than reused from a layout, so the test pins the
// property of the normalised text and not a layout's internals.
var columnGapSplit = regexp.MustCompile(` {2,}|\t+`)

// TestNormalisationPreservesColumnGap asserts the property the layouts need: a
// run of whitespace wide enough to be column padding stays distinguishable from
// the single spaces between words, while prose spacing is untouched.
func TestNormalisationPreservesColumnGap(t *testing.T) {
	line := "ELECTION OF DIRECTOR: JANE DOE        ISSUER      YES      Withhold All      Non-Voting\n"
	got := string(stripHTML([]byte(line)))

	if !strings.Contains(got, "  ") {
		t.Fatalf("column padding was collapsed away; a fixed-width row is"+
			" indistinguishable from prose after normalisation\ngot: %q", got)
	}

	// The gap must separate the cells, not appear inside them. The regex is
	// local to the test on purpose: the assertion is about the TEXT the layouts
	// receive, not about any symbol a layout happens to define today.
	var cells []string
	for _, c := range columnGapSplit.Split(strings.TrimSpace(got), -1) {
		if c = strings.TrimSpace(c); c != "" {
			cells = append(cells, c)
		}
	}
	want := []string{"ELECTION OF DIRECTOR: JANE DOE", "ISSUER", "YES", "Withhold All", "Non-Voting"}
	if len(cells) != len(want) {
		t.Fatalf("split on the column gap gave %d cells, want %d\ncells: %q\ngot: %q",
			len(cells), len(want), cells, got)
	}
	for i := range want {
		if cells[i] != want[i] {
			t.Errorf("cell %d = %q, want %q", i, cells[i], want[i])
		}
	}
}

// TestNormalisationKeepsProseSingleSpaced is the guard on the change: only runs
// that were already wide may stay wide. Single spaces between words must not
// grow, or every prose line becomes a column block and the layouts start seeing
// votes in sentences.
func TestNormalisationKeepsProseSingleSpaced(t *testing.T) {
	prose := "TO RATIFY THE APPOINTMENT OF DELOITTE AND TOUCHE LLP AS AUDITORS\n"
	got := string(stripHTML([]byte(prose)))
	if strings.Contains(got, "  ") {
		t.Errorf("single-spaced prose gained a column gap; every sentence would now"+
			" look like a column block\ngot: %q", got)
	}
	if !strings.Contains(got, "TO RATIFY THE APPOINTMENT OF DELOITTE AND TOUCHE LLP AS AUDITORS") {
		t.Errorf("prose text was altered\ngot: %q", got)
	}
}

// TestVanguardMultiWordCellsSplitOnGap is the defect at the layout grain. Every
// case here has an off-vocabulary VOTE CAST, so no vocabulary can supply the
// boundary; only the column gap can.
func TestVanguardMultiWordCellsSplitOnGap(t *testing.T) {
	cases := []struct{ by, cast, mgmt string }{
		{"ISSUER", "Withhold All", "Non-Voting"},        // asymmetric, 3 tokens
		{"ISSUER", "Non-Voting", "Withhold All"},        // asymmetric the other way
		{"ISSUER", "Refer To Adviser", "Non-Voting"},    // 4 tokens, currently 0 rows
		{"ISSUER", "Withhold All", "Withhold All"},      // symmetric, must stay right
		{"Trustee", "Refer To Adviser", "Withhold All"}, // unlisted source too
	}
	for _, c := range cases {
		t.Run(c.cast+"/"+c.mgmt, func(t *testing.T) {
			got := parseVgBlock(t, c.by, c.cast, c.mgmt)
			if len(got.rows) != 1 {
				t.Fatalf("PROPOSED BY %q, VOTE CAST %q, MGMT %q produced %d rows, want 1",
					c.by, c.cast, c.mgmt, len(got.rows))
			}
			r := got.rows[0]
			if r.HowVoted != c.cast {
				t.Errorf("how_voted = %q, want %q -- the VOTE CAST cell alone,"+
					" never VOTE CAST and MGMT joined", r.HowVoted, c.cast)
			}
			if r.ManagementRecommendation != c.mgmt {
				t.Errorf("management_recommendation = %q, want %q", r.ManagementRecommendation, c.mgmt)
			}
			if r.VoteSource != c.by {
				t.Errorf("vote_source = %q, want %q", r.VoteSource, c.by)
			}
		})
	}
}
