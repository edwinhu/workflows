package main

import (
	"os"
	"path/filepath"
	"testing"
)

// After the three residue shapes landed, 8,134 of the 9,160 HTML and fixed-width
// filings still skip. Measured on WRDS: 5,340 are under 50 KB and 2,970 of those
// carry fewer than 20 <td> -- cover page and signature, nothing to parse. The real
// remaining target is the 1,223 filings that carry 100+ <td>, and their dominant
// shape is this one.
//
// THE CAUSE, read off the bytes rather than guessed: the header labels ENUMERATE
// THEIR OWN VOTE VOCABULARY.
//
//	Description | Proposal Type (Mgmt or Shldr) | Voted (Yes or No) |
//	Vote (For, Agnst, Abstain, ...) | For/ Agnst Mgmt
//
// The strict header test rejects any header row containing vote-value cells, which
// exists to stop a data row being mistaken for a header. A self-documenting label
// like `Vote (For, Agnst, Abstain)` trips it on the words it is DEFINING. The guard
// is right; it just cannot tell a definition from an instance.
//
// This filing also prints its vote values off-vocabulary -- `FOR ALL-DIRS` and
// `AGNST` -- so it exercises the concern a review lens raised about closed
// vocabularies deciding row-hood, on a shape where that decision is real.
//
// Ground truth: 11 vote rows, counted by walking the fixture's <tr> elements.
// Meeting context arrives as 1-cell `Label: value` rows between the vote blocks.

func loadSelfDoc(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H14_selfdoc_header.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return string(b)
}

// TestHTMLSelfDocumentingHeaderIsStillAHeader is the coverage assertion.
func TestHTMLSelfDocumentingHeaderIsStillAHeader(t *testing.T) {
	rows := runISSNPXDoc(t, loadSelfDoc(t))
	if len(rows) != 11 {
		t.Fatalf("got %d rows, want 11 -- the header labels enumerate their own vote"+
			" vocabulary (`Vote (For, Agnst, Abstain)`), which the vote-value guard reads"+
			" as a data row", len(rows))
	}
	want := []string{"Election of Directors", "Ratification of appt.", "Pay-for-Superior",
		"Approve Annual Incentive Pla"}
	joined := ""
	for _, r := range rows {
		joined += r[colVoteDescription] + "\n"
	}
	for _, w := range want {
		if indexOf(joined, w) < 0 {
			t.Errorf("no extracted row describes %q", w)
		}
	}
}

// TestHTMLSelfDocumentingHeaderKeepsOffVocabularyVotesVerbatim is the fidelity
// assertion. This filing prints `FOR ALL-DIRS` and `AGNST`; neither is in any vote
// vocabulary, and both are what the filing actually said. A layout that drops these
// rows, or normalises them to `FOR` and `AGAINST`, has reported something the filing
// never printed -- and dropping them silently is the worse failure, because the row
// count still looks plausible.
func TestHTMLSelfDocumentingHeaderKeepsOffVocabularyVotesVerbatim(t *testing.T) {
	rows := runISSNPXDoc(t, loadSelfDoc(t))
	seen := map[string]int{}
	for _, r := range rows {
		seen[r[colHowVoted]]++
	}
	for _, w := range []string{"FOR ALL-DIRS", "AGNST"} {
		if seen[w] == 0 {
			t.Errorf("no row carries how_voted %q verbatim; stamped values: %v\n"+
				"  the filing prints this value and it is not in any vote vocabulary,"+
				" so a closed-vocabulary row test drops the row or rewrites the value", w, seen)
		}
	}
}

// TestHTMLSelfDocumentingHeaderNeverEmitsContextAsAVote is the safety assertion.
// Context arrives as 1-cell `Issuer:`, `Ticker:`, `CUSIP:`, `Meeting Date:` rows.
func TestHTMLSelfDocumentingHeaderNeverEmitsContextAsAVote(t *testing.T) {
	for i, r := range runISSNPXDoc(t, loadSelfDoc(t)) {
		d := r[colVoteDescription]
		for _, bad := range []string{"Issuer:", "Ticker:", "CUSIP:", "Meeting Date:", "Description"} {
			if indexOf(d, bad) >= 0 {
				t.Fatalf("row %d description is %q -- a header or context row emitted as a vote", i, d)
			}
		}
	}
}
