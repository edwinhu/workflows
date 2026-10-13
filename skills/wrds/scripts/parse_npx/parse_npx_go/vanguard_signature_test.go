package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// matchVanguard (text_parser.go) accepts a filing when the first 128 KB of its
// normalised text contains "PROPOSAL:", "PROPOSED BY" and "VOTE CAST" anywhere
// -- three unanchored substring searches over a large window. In the real
// Vanguard grammar those three are one physical line, the column header:
//
//	PROPOSAL:                     PROPOSED BY      VOTED?      VOTE CAST           MGMT
//
// Scattered across the window they prove nothing, and one of them is a phrase
// that occurs in ordinary proposal prose. testdata/vanguard/V4.txt is a verbatim
// excerpt of 000002/24238/0000023355-06-000041.txt, a Fidelity filing in an HTML
// <table> grammar, where the three tokens are supplied by:
//
//	"Proposed By"  a <th> column header, alone on its own line
//	"Vote Cast"    a <th> column header, alone on its own line
//	"PROPOSAL:"    the sentence "PLEASE NOTE THAT THIS IS A SHAREHOLDER
//	               PROPOSAL: APPROVE TO REMOVE KPMG AS THE AUDITORS"
//
// vanguard therefore claims a grammar it cannot parse. Measured over the 31,902
// filings re-parsed on 2026-08-28: 288 filings, 60,719 rows. They are Fidelity
// and its Variable Insurance Products funds, concentrated in 2004-2008 (275 of
// 288), and the damage takes both forms this change set exists to remove --
// rows shredded across columns ("Take No Action" arriving as
// vote_description="Take", vote_other_info="No", how_voted="Action", 57,967
// rows) and filings emitting ok with zero rows.
//
// A layout must not claim what it cannot parse. The registry is built for this:
// an unmatched family lands parse_status=skip carrying a body-derived signature,
// so it is COUNTABLE in the manifest instead of silently wrong in the panel.
// Emitting no rows beats emitting 60,719 wrong ones.
//
// The table grammar is worth registering as its own layout later -- its columns
// are Proposal No | Proposal | Proposed By | Management Recommendation | Vote
// Cast, with Vote Cast LAST, the reverse of the fixed-width order, so a layout
// that assumed the text order would silently swap how_voted and
// management_recommendation. That is a separate job with its own ground truth.

func loadVanguardRaw(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "vanguard", name))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return edgarEnvelope("0000023355", "0000023355-06-000041", string(b))
}

// TestVanguardDoesNotClaimTableGrammar is the defect.
func TestVanguardDoesNotClaimTableGrammar(t *testing.T) {
	res := parseText([]byte(loadVanguardRaw(t, "V4.txt")), FilingMeta{FilePath: "V4.txt"})

	if res.Meta.Layout == "vanguard" {
		t.Errorf("the vanguard layout claimed an HTML <table> filing it cannot parse"+
			" (emitting %d rows, parse_status=%q). Its three signature tokens are"+
			" scattered across the window here -- two are <th> cells and the third is"+
			" the phrase \"SHAREHOLDER PROPOSAL:\" inside a proposal description --"+
			" so none of them is a Vanguard column header",
			len(res.Rows), res.Meta.ParseStatus)
	}

	// Whatever does or does not claim it, the filing must never leave here
	// carrying values that are not votes.
	for i, r := range res.Rows {
		if !isVoteValue(r.HowVoted) {
			t.Errorf("row %d: how_voted = %q is not a vote value", i, r.HowVoted)
		}
	}

	// If nothing claims it, the family must still be countable rather than
	// invisible -- that is what the skip signature is for.
	if res.Meta.ParseStatus == "skip" && strings.TrimSpace(res.Meta.Layout) == "" {
		t.Errorf("filing skipped with an empty layout signature; an unparsed family" +
			" must be countable in the manifest")
	}
}

// TestVanguardSignatureNeedsItsHeaderLine pins the property that makes the fix
// correct rather than merely narrow: the three tokens mean "Vanguard" only when
// they are the one column-header line the grammar actually prints. Scattered
// over separate lines they are a coincidence.
func TestVanguardSignatureNeedsItsHeaderLine(t *testing.T) {
	header := "  PROPOSAL:                          PROPOSED BY      VOTED?      VOTE CAST           MGMT\n"

	t.Run("the real header line matches", func(t *testing.T) {
		body := "  FUND:    SOME VANGUARD FUND\n\n" +
			"- " + strings.Repeat("-", 60) + "\n" +
			"  ISSUER:                ACME INC\n" +
			"  TICKER:                ACME            CUSIP:     000000000\n" +
			"  MEETING DATE:          9/22/2004\n" + header + "\n" +
			"ELECTION OF DIRECTOR: JANE DOE                              ISSUER          YES          FOR               FOR\n"
		res := parseText([]byte(edgarEnvelope("0000052848", "a", body)), FilingMeta{FilePath: "x"})
		if res.Meta.Layout != "vanguard" {
			t.Errorf("layout = %q, want vanguard -- the real column header must still"+
				" be recognised", res.Meta.Layout)
		}
	})

	t.Run("the same tokens scattered over separate lines do not match", func(t *testing.T) {
		body := "Proposal No\nProposal\nProposed By\nManagement Recommendation\nVote Cast\n\n" +
			"1\nELECT A DIRECTOR\nManagement\nFor\nFor\n\n" +
			"23\nPLEASE NOTE THAT THIS IS A SHAREHOLDER PROPOSAL: APPROVE TO REMOVE KPMG\n" +
			"Shareholder\nAgainst\nAgainst\n"
		res := parseText([]byte(edgarEnvelope("0000023355", "b", body)), FilingMeta{FilePath: "y"})
		if res.Meta.Layout == "vanguard" {
			t.Errorf("layout = vanguard: PROPOSAL:, PROPOSED BY and VOTE CAST on three"+
				" different lines were taken for a Vanguard column header (emitted %d rows)",
				len(res.Rows))
		}
	})
}
