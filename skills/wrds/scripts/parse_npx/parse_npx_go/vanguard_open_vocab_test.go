package main

import (
	"strings"
	"testing"
)

// Row RECOGNITION must not depend on the vote vocabulary being complete.
//
// vanguardOpensRow delegates to vanguardPeelColumns, which returns ok=false
// unless it can peel a cell from vanguardVoteVocabulary -- a closed set of ~30
// spellings. So a filing whose VOTE CAST uses a spelling nobody listed is not
// merely given the wrong vote: the line stops being a row at all, the proposal
// is dropped, and a filing of such rows lands parse_status=ok with n_rows=0.
//
// That is the exact failure this whole change set exists to remove. Before it,
// 644 of 2,510 vanguard filings parsed ok-with-zero-rows, which the README's own
// vocabulary makes indistinguishable from a fund that genuinely had nothing to
// report. A closed vocabulary in the recognition path re-creates it for every
// vintage and filer the list does not happen to cover.
//
// The spellings below are not invented. Each one is a value parse_npx ALREADY
// emits from the issnpx and broadridge layouts over the corpus, and none is in
// vanguardVoteVocabulary:
//
//	"abstain."      4,598 rows
//	"non-voting"    1,105 rows
//	"no action."      862 rows
//	"three years."    675 rows
//
// The requirement is structural: recognise the row, then report whatever the
// filing put in the cell, VERBATIM. An unrecognised vote spelling is a fact
// about the filing to be recorded, never a reason to discard the vote. The
// vocabulary may still decide where the cell boundaries fall; it must not decide
// whether a row exists.

// vanguardBlockWithVote builds a fixed-width Vanguard block, modelled on the
// real bytes of testdata/vanguard/V1.txt, whose single proposal carries the
// given VOTE CAST and MGMT spellings.
func vanguardBlockWithVote(cast, mgmt string) string {
	pad := func(s string, w int) string {
		if len(s) >= w {
			return s + " "
		}
		return s + strings.Repeat(" ", w-len(s))
	}
	return "  FUND:    VANGUARD EXPLORER FUND\n" +
		"\n" +
		"- " + strings.Repeat("-", 120) + "\n" +
		"  ISSUER:                3COM CORPORATION\n" +
		"  TICKER:                COMS            CUSIP:     885535104\n" +
		"  MEETING DATE:          9/22/2004                                    FOR/AGAINST\n" +
		"  PROPOSAL:                                     PROPOSED BY      VOTED?      VOTE CAST           MGMT\n" +
		"\n" +
		pad("ELECTION OF DIRECTOR: ERIC A. BENHAMOU", 60) +
		pad("ISSUER", 16) + pad("YES", 12) + pad(cast, 20) + mgmt + "\n" +
		"\n" +
		"- " + strings.Repeat("-", 120) + "\n"
}

func TestVanguardRecognisesRowWithUnlistedVoteSpelling(t *testing.T) {
	cases := []struct {
		name string
		cast string
		mgmt string
	}{
		{"trailing period", "Abstain.", "For"},
		{"non-voting", "Non-Voting", "For"},
		{"no action with period", "No Action.", "For"},
		{"three years with period", "Three Years.", "Three Years."},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			body := edgarEnvelope("0000052848", "0000932471-05-001498",
				vanguardBlockWithVote(c.cast, c.mgmt))
			res := parseText([]byte(body), FilingMeta{FilePath: "x"})

			if res.Meta.Layout != "vanguard" {
				t.Fatalf("layout = %q, want vanguard", res.Meta.Layout)
			}
			if len(res.Rows) == 0 {
				t.Fatalf("a proposal whose VOTE CAST reads %q produced NO rows;"+
					" an unlisted vote spelling must cost the row its vote value at worst,"+
					" never its existence -- this is the ok/n_rows=0 failure the change set"+
					" exists to remove", c.cast)
			}
			if len(res.Rows) != 1 {
				t.Fatalf("emitted %d rows, want 1", len(res.Rows))
			}

			got := res.Rows[0]
			if !strings.HasPrefix(got.VoteDescription, "ELECTION OF DIRECTOR: ERIC A. BENHAMOU") {
				t.Errorf("vote_description = %q, want the proposal text", got.VoteDescription)
			}
			// Verbatim: parse_npx stores what the filing said. The vocabulary
			// decides cell boundaries, never the recorded value.
			if got.HowVoted != c.cast {
				t.Errorf("how_voted = %q, want %q recorded verbatim", got.HowVoted, c.cast)
			}
			if got.IssuerName != "3COM CORPORATION" {
				t.Errorf("issuer_name = %q, want %q", got.IssuerName, "3COM CORPORATION")
			}
			if got.CUSIP != "885535104" {
				t.Errorf("cusip = %q, want %q", got.CUSIP, "885535104")
			}
		})
	}
}

// TestVanguardStillRejectsNonRows is the other half, and it is what stops the
// fix above from degenerating into "every line is a row". The furniture in a
// real Vanguard block -- the column header, the key lines, the dashed rules --
// must still produce nothing, or the layout trades dropped rows for invented
// ones. V1/V2/V3 all carry every line exercised here.
func TestVanguardStillRejectsNonRows(t *testing.T) {
	body := edgarEnvelope("0000052848", "0000932471-05-001498",
		vanguardBlockWithVote("For", "For"))
	res := parseText([]byte(body), FilingMeta{FilePath: "x"})
	if len(res.Rows) != 1 {
		t.Fatalf("emitted %d rows, want exactly 1 -- the header line, the FUND/ISSUER/"+
			"TICKER/MEETING DATE key lines and the dashed rules must not become rows\n%s",
			len(res.Rows), dumpVanguardRows(res.Rows))
	}
	if got := res.Rows[0].HowVoted; got != "For" {
		t.Errorf("how_voted = %q, want %q", got, "For")
	}
}
