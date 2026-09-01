package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestISSNPXNumericWrapIsNotANewItem pins a wrapped line that begins with a
// numeral -- the same defect c422f060 fixed in broadridge, present here too.
//
//	17  Authorize Board to Set Issue Price for  For  Split Vote  Management
//	10 Percent Per Year of Issued Capital
//	Pursuant to Issue Authority without
//
// Item 17's description continues "... for 10 Percent Per Year of Issued
// Capital ...", but issSplitItem reads the leading `10` as an item token, so the
// continuation opens a row of its own. That costs twice: item 17's description
// is truncated at "for", and a junk row appears carrying item `10`, no cells and
// a blank vote.
//
// The discriminator is the one broadridge uses: a real item row inside a table
// brings cells of its own, and this line has none. A row the filing reports
// without a vote still carries its Sponsor cell, so it is not swallowed here.
func TestISSNPXNumericWrapIsNotANewItem(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "DA_numeric_wrap.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))

	for _, r := range rows {
		if strings.HasPrefix(r[colVoteDescription], "Percent Per Year") {
			t.Errorf("emitted item %q %q -- that is the wrapped tail of item 17",
				r[colItemSeq], r[colVoteDescription])
		}
	}

	var item17 []string
	for _, r := range rows {
		if r[colItemSeq] == "17" {
			item17 = r
		}
	}
	if item17 == nil {
		t.Fatalf("item 17 missing; got %d rows", len(rows))
	}
	if d := item17[colVoteDescription]; !strings.Contains(d, "10 Percent Per Year") {
		t.Errorf("item 17 description = %q, want it to carry the wrapped %q", d, "10 Percent Per Year")
	}
}
