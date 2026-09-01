package main

import (
	"os"
	"path/filepath"
	"testing"
)

// A verbatim contiguous meeting block from 0001144204-13-048821, cut rule to
// rule: White Mountains Insurance's 2013 annual meeting. Its director slate is
// numbered with a DOUBLED dot, one sub-number per nominee:
//
//	1..1  DIRECTOR-M.W.DAVIS*     For   For   Management
//	1..10 DIRECTOR-NICOLL@        For   For   Management
//
// issItemRe was `^\d+(\.\d+)*[A-Za-z]?[.)]?$`, which requires digits after every
// dot and so rejected all fourteen. A rejected leading token makes the line a
// CONTINUATION, so every nominee folded into the row above and their votes were
// lost: this block read 3 items against ISS's 39, and the three were the plain
// proposals 10, 11 and 12 that follow the slate.
//
// issnpx was the largest remaining source of partial parsing when this was
// found: 115,096 items across 1,814 filings.
func TestISSNPXDoubleDotSlate(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "I_whitemountains_double_dot.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) != 39 {
		t.Fatalf("got %d rows, want 39 -- the count ISS records for this meeting", len(rows))
	}
	var slate int
	for _, r := range rows {
		if len(r[colItemSeq]) > 2 && r[colItemSeq][:3] == "1.." {
			slate++
			if r[colHowVoted] == "" {
				t.Errorf("item %q has no vote", r[colItemSeq])
			}
		}
	}
	if slate != 36 {
		t.Errorf("got %d slate rows, want 36; the doubled-dot numbering runs 1..1 through 1..36", slate)
	}
}

// The regex change is a WIDENING on a hot path, so its bound is pinned here: a
// doubled dot must be accepted and a token that is not an item must still be
// rejected.
func TestISSItemReAcceptsDoubledDots(t *testing.T) {
	for _, tok := range []string{"1", "1.1", "2a", "6", "1)", "1..1", "1..14", "1...2"} {
		if !issItemRe.MatchString(tok) {
			t.Errorf("issItemRe rejects %q, which is an item number", tok)
		}
	}
	for _, tok := range []string{"DIRECTOR-NICOLL@", "Management", "For", "", "..", "1..", "a.1"} {
		if issItemRe.MatchString(tok) {
			t.Errorf("issItemRe accepts %q, which is not an item number", tok)
		}
	}
}
