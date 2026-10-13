package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The pvtext layout landed and then measured badly at scale: over the 277 filings
// carrying this format it extracted 7,881 rows against 520,449 vote-like lines --
// 1.5% -- and 161 of the 277 still skipped entirely. Two causes, both read off the
// filings rather than guessed.
//
// (1) A COLUMN-ALIGNED RENDERING WITH A THREE-LINE HEADER. PV1 is the compact
// single-spaced rendering. The same format is also printed column-aligned, and its
// header wraps over THREE lines rather than two:
//
//	ISSUER NAME                       TICKER      CUSIP           MTG DATE    MTG TYPE
//	                                                              Proposal    Voted?    Vote      For/Agnst
//	                                                              Type                            Mgmt
//	3M Co                             MMM         88579Y101       5/11/04     Annual
//	1.01       Elect Edward A. Brennan                            MGMT        YES       FOR       FOR
//
// The third line carries only the continuations `Type` and `Mgmt`. A two-line header
// rule reads line three as data and rejects the block.
//
// (2) ONLY THE FIRST SECTION OF A FILING IS READ. `0001010521-04-000174.txt` prints
// FIVE `ISSUER NAME` sections and yielded 139 rows against 3,713 vote lines. A filing
// may repeat this header many times, once per account or sub-advisor, and every
// section holds votes.
//
// The sharpest evidence for (1) is that PV1's own SOURCE filing returns zero rows and
// `skip` while the 5,876-byte excerpt of it passes: the excerpt is one section in one
// rendering, and the whole document is neither.
//
// Ground truth for PV2: 32 vote rows over 3 meetings, counted by walking the
// fixture's lines. Trimmed to end on a complete vote line.

func loadPVFixture(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "pvtext", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(b)
}

// TestPVTextColumnarThreeLineHeader covers the column-aligned rendering.
func TestPVTextColumnarThreeLineHeader(t *testing.T) {
	rows := runISSNPXDoc(t, loadPVFixture(t, "PV2_columnar_3line.txt"))
	if len(rows) != 32 {
		t.Fatalf("got %d rows, want 32 across 3 meetings -- the header wraps over THREE"+
			" lines here, the third carrying only the continuations `Type` and `Mgmt`", len(rows))
	}
	joined := ""
	for _, r := range rows {
		joined += r[colVoteDescription] + "\n"
	}
	for _, w := range []string{
		"Elect Edward A. Brennan", "Increase Authorized Common Stock",
		"Independent Board Chairman", "Elect Roxanne S. Austin",
	} {
		if indexOf(joined, w) < 0 {
			t.Errorf("no extracted row describes %q", w)
		}
	}
}

// TestPVTextColumnarKeepsColumnsApart guards the split in the aligned rendering,
// where wide whitespace runs separate the fields and a description may itself
// contain spaces.
func TestPVTextColumnarKeepsColumnsApart(t *testing.T) {
	for i, r := range runISSNPXDoc(t, loadPVFixture(t, "PV2_columnar_3line.txt")) {
		d, hv := r[colVoteDescription], r[colHowVoted]
		if d == "" {
			t.Fatalf("row %d has an empty description", i)
		}
		for _, tok := range []string{"MGMT", "SHLDR", " YES", " NO"} {
			if indexOf(d, tok) >= 0 {
				t.Errorf("row %d description %q still carries the %q column", i, d, tok)
			}
		}
		if hv != "FOR" && hv != "AGNST" && hv != "ABSTAIN" && hv != "WITHHELD" {
			t.Errorf("row %d how_voted = %q, not a value this filing prints", i, hv)
		}
	}
}

// TestPVTextCompactRenderingStillWorks pins PV1 so the columnar support cannot be
// bought by breaking the rendering that already parses.
func TestPVTextCompactRenderingStillWorks(t *testing.T) {
	if n := len(runISSNPXDoc(t, loadPVFixture(t, "PV1_account_text.txt"))); n != 70 {
		t.Fatalf("PV1 now yields %d rows, want 70 -- the compact rendering regressed", n)
	}
}
