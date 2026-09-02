package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestStripHTMLDashPrefixedWrap pins the EDGAR wrap on a line EDGAR itself
// prefixed.
//
// EDGAR wraps a dissemination file at 1023 columns and THEN prefixes `- ` to
// any line that begins with a dash, so a wrapped line that opens with a dashed
// rule arrives 1025 bytes long:
//
//	- -------------</font></p><p style="margin:0in ...   &#160;&#160;&
//	#160;&#160; ...
//
// The break was counted at column 1025, not recognised as the wrap, and kept
// -- leaving `&` on one line and `#160;` on the next, which the layouts then
// glued as `&# 160;` inside a vote cell. One filing carries 357 such lines;
// 93 blank votes in four filings, 2026-09-02, and the same bytes reach every
// layout through this normalisation.
func TestStripHTMLDashPrefixedWrap(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "html", "H1_dash_prefixed_wrap.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	got := string(stripHTML(b))
	// A kept break leaves the entity's head at one line end and its tail at
	// the next line start; a dropped one lets it decode to a space.
	if m := regexp.MustCompile(`&#?1?6?0?\n`).FindStringIndex(got); m != nil {
		lo := max(0, m[0]-40)
		t.Errorf("an entity is split across a kept break: %q", got[lo:min(len(got), m[1]+12)])
	}
	if i := strings.Index(got, "&#"); i >= 0 {
		lo := max(0, i-40)
		t.Errorf("an entity survived normalisation: %q", got[lo:min(len(got), i+20)])
	}
	if !strings.Contains(got, "Security ID:") {
		t.Errorf("text lost: %q", got[:min(len(got), 200)])
	}
}
