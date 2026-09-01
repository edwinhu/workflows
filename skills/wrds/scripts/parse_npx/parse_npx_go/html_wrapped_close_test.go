package main

import (
	"strings"
	"testing"
)

// TestStripHTMLWrappedCloseTag pins a closing tag the EDGAR wrap cuts between
// its '<' and its '/'.
//
// EDGAR breaks these documents at exactly 1023 columns, wherever that lands:
//
//	line N   (1023 chars) ... Management </font><
//	line N+1              /p><p style="margin:0pt ...
//
// tagName consumes a leading '/' only BEFORE its loop, so when the break falls
// between '<' and '/' the slash arrives after the rejoin and hits the `c == '/'`
// terminator instead. The tag is not recognised and its characters survive into
// the text:
//
//	8.1  Elect Ted Hsu, a Representative of  For  Did Not  Management </p>
//
// Measured 2026-09-01 that puts a literal `</p>` or `</font>` in the vote cell
// of 2,173 issnpx rows corpus-wide, and it is in shared normalisation code, so
// any layout reading an EDGAR-wrapped document is exposed.
func TestStripHTMLWrappedCloseTag(t *testing.T) {
	head := "<p>" + strings.Repeat("x", edgarWrapWidth-len("<p>")-1) + "<"
	if len(head) != edgarWrapWidth {
		t.Fatalf("built a %d-column line, want %d", len(head), edgarWrapWidth)
	}
	got := string(stripHTML([]byte(head + "\n/p>after")))

	if strings.Contains(got, "/p>") {
		t.Errorf("stripHTML kept the wrapped close tag: %q", got)
	}
	if !strings.Contains(got, "after") {
		t.Errorf("stripHTML lost the text after the tag: %q", got)
	}
}
