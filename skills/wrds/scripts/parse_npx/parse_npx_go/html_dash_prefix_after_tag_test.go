package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestStripHTMLDashPrefixAfterTagBreak pins the `- ` prefix on a line whose
// preceding break fell INSIDE a tag. The wrap cut `font-size` into `font` /
// `-size`, EDGAR prefixed the second half, and the prefix check in the
// break branch never saw it because advanceColumn had consumed that break.
// The line then counted 1025 columns and kept its own break, splitting the
// entity there: `&#1` / `60;`. About 90 rows in the tail, one HTML agent.
func TestStripHTMLDashPrefixAfterTagBreak(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "html", "H2_dash_prefix_after_tag_break.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	got := string(stripHTML(b))
	if m := regexp.MustCompile(`&#?1?6?0?\n`).FindStringIndex(got); m != nil {
		lo := max(0, m[0]-40)
		t.Errorf("an entity is split across a kept break: %q", got[lo:min(len(got), m[1]+12)])
	}
	if i := strings.Index(got, "&#"); i >= 0 {
		lo := max(0, i-40)
		t.Errorf("an entity survived normalisation: %q", got[lo:min(len(got), i+20)])
	}
}
