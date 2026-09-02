package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXBlankLinePerParagraphVintage pins the HTML vintage that puts a
// blank line between EVERY physical line, and the two ways it loses data.
//
//	1     Accept Financial Statements and         For   For   Management
//	                                                                   <blank>
//	      Statutory Reports
//	                                                                   <blank>
//	3a1   Reelect Benjamin Zhengmin Pan as        For   For   Management
//
// (1) `3a1` is not an item token: issItemRe allowed one trailing letter but
// not a letter followed by digits, so 3a1..3a4 opened no row and were lost --
// four of this excerpt's ten items.
//
// (2) A wrapped tail arrives AFTER a blank line. The blank flushes the complete
// row above it, so the tail lands with no row open and is taken for the next
// meeting's issuer name -- every description in the vintage is truncated at its
// first line. An issuer name is followed by a `Ticker:` line; a wrapped tail is
// not, and that lookahead is what separates them.
//
// Measured 2026-09-01 on 0001140361-10-035306.txt: 425 blank votes, but those
// are only the fragments that happened to start with a numeral. The lost rows
// and truncated descriptions are invisible to any blank-vote count.
func TestISSNPXBlankLinePerParagraphVintage(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "DZ_wrap_after_blank.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) != 10 {
		t.Errorf("got %d rows, want 10 -- the excerpt numbers ten items", len(rows))
	}
	got := map[string]string{}
	for _, r := range rows {
		got[r[colItemSeq]] = r[colVoteDescription]
	}
	if _, ok := got["3a1"]; !ok {
		t.Errorf("item 3a1 missing")
	}
	for item, want := range map[string]string{
		"1":   "Accept Financial Statements and Statutory Reports",
		"3a1": "Reelect Benjamin Zhengmin Pan as Executive Director",
		"6":   "Authorize Repurchase of Up to 10 Percent of Issued Share Capital",
	} {
		if got[item] != want {
			t.Errorf("item %s description = %q, want %q", item, got[item], want)
		}
	}
}
