package main

import (
	"strings"
	"testing"
)

// Round 2 decoupled row recognition from the VOTE CAST vocabulary but left the
// dependency in three places, each verified against the built tree:
//
//	VOTE CAST "With Management"     -> 0 rows   (a spelling the layout's OWN
//	VOTE CAST "Against Management"  -> 0 rows    vote vocabulary declares valid)
//	PROPOSED BY "Trustee" + VOTE CAST "Non-Voting" -> 0 rows
//	PROPOSED BY "ISSUER" + both vote cells "Non-Voting"
//	                       -> how_voted = "Non-Voting Non-Voting", mgmt = ""
//
// The first is a contradiction inside the layout: vanguardVoteVocabulary lists
// "with management" and "against management", and vanguardHasSourceWord rejects
// any candidate cell containing a token from vanguardSourceVocabulary, which
// contains "management". The two guards cancel and the row disappears.
//
// The second shows the closed-vocabulary dependency was MOVED rather than
// removed: when no trailing cell matches a vote spelling, the block is accepted
// only if the token left of the VOTED? anchor is one of 16 hardcoded PROPOSED BY
// spellings. A filing using any other word for that column loses the row.
//
// The third is a column-assignment defect rather than a recognition one:
// how_voted must be the VOTE CAST cell, and here it swallows MGMT as well. A
// value that is not what the filing printed in that cell is not verbatim,
// whatever it is.
//
// All three land in the same place — a dropped row is parse_status=ok with
// n_rows=0, indistinguishable from a fund that genuinely had nothing to report.
// That is the failure this entire change set exists to remove.

// vgBlock builds a fixed-width Vanguard block, modelled on the real bytes of
// testdata/vanguard/V1.txt, with the three trailing cells given explicitly.
func vgBlock(proposedBy, cast, mgmt string) string {
	pad := func(s string, w int) string {
		if len(s) >= w {
			return s + " "
		}
		return s + strings.Repeat(" ", w-len(s))
	}
	return "  FUND:    VANGUARD EXPLORER FUND\n\n" +
		"- " + strings.Repeat("-", 120) + "\n" +
		"  ISSUER:                3COM CORPORATION\n" +
		"  TICKER:                COMS            CUSIP:     885535104\n" +
		"  MEETING DATE:          9/22/2004                                    FOR/AGAINST\n" +
		"  PROPOSAL:                                     PROPOSED BY      VOTED?      VOTE CAST           MGMT\n\n" +
		pad("ELECTION OF DIRECTOR: ERIC A. BENHAMOU", 60) +
		pad(proposedBy, 16) + pad("YES", 12) + pad(cast, 20) + mgmt + "\n\n" +
		"- " + strings.Repeat("-", 120) + "\n"
}

func parseVgBlock(t *testing.T, proposedBy, cast, mgmt string) parseResultRows {
	t.Helper()
	body := edgarEnvelope("0000052848", "0000932471-05-001498", vgBlock(proposedBy, cast, mgmt))
	res := parseText([]byte(body), FilingMeta{FilePath: "x"})
	return parseResultRows{layout: res.Meta.Layout, status: res.Meta.ParseStatus, rows: res.Rows}
}

type parseResultRows struct {
	layout string
	status string
	rows   []VoteRow
}

// TestVanguardListedVoteContainingSourceWord — the layout must not contradict
// its own vocabulary. Both spellings below are declared valid VOTE CAST values.
func TestVanguardListedVoteContainingSourceWord(t *testing.T) {
	for _, cast := range []string{"With Management", "Against Management"} {
		t.Run(cast, func(t *testing.T) {
			got := parseVgBlock(t, "ISSUER", cast, "For")
			if len(got.rows) != 1 {
				t.Fatalf("VOTE CAST %q produced %d rows, want 1;"+
					" this spelling is in the layout's own vote vocabulary, so a guard"+
					" that rejects it is rejecting a vote the layout claims to know",
					cast, len(got.rows))
			}
			if got.rows[0].HowVoted != cast {
				t.Errorf("how_voted = %q, want %q verbatim", got.rows[0].HowVoted, cast)
			}
			if got.rows[0].ManagementRecommendation != "For" {
				t.Errorf("management_recommendation = %q, want %q",
					got.rows[0].ManagementRecommendation, "For")
			}
		})
	}
}

// TestVanguardUnlistedProposedBy — recognition must not depend on the PROPOSED
// BY vocabulary either. "Trustee" is a real proposer word for a fund ballot and
// is not in the 16-value list.
func TestVanguardUnlistedProposedBy(t *testing.T) {
	// The fallback only bites when NO trailing cell matches a vote spelling, so
	// a case with a listed MGMT cell does not exercise it. The last two rows
	// have both vote cells off-vocabulary AND an unlisted PROPOSED BY, which is
	// the combination that loses the row.
	cases := []struct{ by, cast, mgmt string }{
		{"Trustee", "For", "For"},                 // listed vote, unlisted source
		{"Trustee", "Non-Voting", "For"},          // one listed cell still anchors
		{"Portfolio Manager", "For", "For"},       // multi-word unlisted source
		{"Trustee", "Non-Voting", "Non-Voting"},   // nothing listed anywhere
		{"Adviser", "Non-Voting", "Withhold All"}, // nothing listed anywhere
	}
	for _, c := range cases {
		t.Run(c.by+"/"+c.cast, func(t *testing.T) {
			got := parseVgBlock(t, c.by, c.cast, c.mgmt)
			if len(got.rows) != 1 {
				t.Fatalf("PROPOSED BY %q with VOTE CAST %q produced %d rows, want 1;"+
					" no closed vocabulary may decide whether a line is a row",
					c.by, c.cast, len(got.rows))
			}
			if got.rows[0].HowVoted != c.cast {
				t.Errorf("how_voted = %q, want %q verbatim", got.rows[0].HowVoted, c.cast)
			}
		})
	}
}

// TestVanguardOffVocabularyCellsSplit — how_voted is the VOTE CAST cell, never
// the VOTE CAST and MGMT cells run together. Both cells here are off-vocabulary,
// which is the case where the vocabulary cannot supply the boundary.
func TestVanguardOffVocabularyCellsSplit(t *testing.T) {
	cases := []struct{ cast, mgmt string }{
		{"Non-Voting", "Non-Voting"},
		{"Abstain.", "Abstain."},
		{"Non-Voting", "Abstain."},
	}
	for _, c := range cases {
		t.Run(c.cast+"/"+c.mgmt, func(t *testing.T) {
			got := parseVgBlock(t, "ISSUER", c.cast, c.mgmt)
			if len(got.rows) != 1 {
				t.Fatalf("produced %d rows, want 1", len(got.rows))
			}
			r := got.rows[0]
			if r.HowVoted != c.cast {
				t.Errorf("how_voted = %q, want %q -- it must be the VOTE CAST cell alone,"+
					" not VOTE CAST and MGMT joined", r.HowVoted, c.cast)
			}
			if r.ManagementRecommendation != c.mgmt {
				t.Errorf("management_recommendation = %q, want %q -- the MGMT cell was"+
					" absorbed into how_voted rather than reported",
					r.ManagementRecommendation, c.mgmt)
			}
		})
	}
}

// TestVanguardResidueRegression pins the round-1 and round-2 behaviour these
// fixes must not trade away: furniture still is not a row, and a well-formed
// block still yields exactly one.
func TestVanguardResidueRegression(t *testing.T) {
	got := parseVgBlock(t, "ISSUER", "For", "For")
	if len(got.rows) != 1 {
		t.Fatalf("a well-formed block produced %d rows, want exactly 1 -- the column"+
			" header, the FUND/ISSUER/TICKER/MEETING DATE key lines and the dashed"+
			" rules must not become rows\n%s", len(got.rows), dumpVanguardRows(got.rows))
	}
	r := got.rows[0]
	if r.HowVoted != "For" || r.ManagementRecommendation != "For" || r.VoteSource != "ISSUER" {
		t.Errorf("cells = (src %q, cast %q, mgmt %q), want (ISSUER, For, For)",
			r.VoteSource, r.HowVoted, r.ManagementRecommendation)
	}
}
