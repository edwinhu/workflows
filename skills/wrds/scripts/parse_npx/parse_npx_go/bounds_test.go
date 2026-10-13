package main

import (
	"strings"
	"testing"
)

// The wrap-rejoin work added two unbounded reads of attacker-supplied bytes.
// parse_npx consumes third-party SEC filings from disk on a grid, at up to
// 200 MB each and 90,661 of them per run, so "the input is malformed" is a
// routine condition rather than a hypothetical.
//
// Neither test asserts a timing or an allocation count -- both are flaky. Each
// asserts the OUTCOME a bound produces: an absurd value is simply not the thing
// it is pretending to be. A real SGML element name and a real reportType are
// both short, and treating an unbounded run of bytes as either is the defect.

// ---------------------------------------------------------------------------
// tagName's rejoin buffer
// ---------------------------------------------------------------------------

// tagName rejoins an element name the EDGAR wrap cut in half, appending across
// every break that lands exactly on the wrap column. Nothing caps how many
// times that fires, so a filing whose lines are all name bytes ending on the
// wrap column grows the buffer to the length of the filing.
//
// The bound is semantic, not just defensive: no SGML or HTML element name is
// hundreds of bytes long, so a "name" that keeps going across wrap after wrap
// is not a name and must not be accumulated as one.
func TestTagNameRejoinIsBounded(t *testing.T) {
	// A '<' at column 0 followed by name bytes that fill the line exactly to the
	// wrap column, repeated -- the shape the finding describes.
	const lines = 400
	var b strings.Builder
	b.WriteByte('<')
	b.WriteString(strings.Repeat("a", edgarWrapWidth-1))
	for i := 0; i < lines; i++ {
		b.WriteByte('\n')
		b.WriteString(strings.Repeat("a", edgarWrapWidth))
	}
	b.WriteString(">tail\n")

	src := []byte(b.String())
	name, _, ok := tagName(src, 0, 0)

	if ok && len(name) > 256 {
		t.Errorf("tagName rejoined a %d-byte element name across %d wrapped lines;"+
			" the join must be bounded, and a run this long is not an element name",
			len(name), lines)
	}

	// And the whole pipeline must survive it without swallowing the document.
	out := stripHTML(src)
	if len(out) == 0 {
		t.Errorf("stripHTML consumed the entire input as one tag")
	}
}

// TestTagNameStillRejoinsRealSplit is the guard on the bound: the legitimate
// case the join exists for -- an element name genuinely cut by the wrap -- must
// keep working. Without this, "bound it" could be satisfied by deleting the
// feature and re-breaking testdata/vanguard/V3.txt.
func TestTagNameStillRejoinsRealSplit(t *testing.T) {
	// '<' sits at column 0 and the name runs to the wrap column, so the break
	// falls strictly inside the element name and the tail resumes on the next
	// line. This is the shape the join exists for.
	name := strings.Repeat("n", edgarWrapWidth-1)
	crafted := "<" + name + "\n" + "tail class=x>INNER</span>\n"

	got := string(stripHTML([]byte(crafted)))
	if strings.Contains(got, "class=x") {
		t.Errorf("a tag whose name was split by the wrap was not recognised as a tag;"+
			" its attributes leaked into the text\ngot: %q", got)
	}
	if !strings.Contains(got, "INNER") {
		t.Errorf("the element's text was lost\ngot: %q", got)
	}
}

// ---------------------------------------------------------------------------
// isNoticeReportType's normalisation
// ---------------------------------------------------------------------------

// isNoticeReportType normalises with strings.ToUpper(strings.Join(strings.
// Fields(v), " ")), which on a large value allocates a fields slice, a joined
// copy and an uppercased copy -- several times the element's own size, on a
// string elemText already materialised whole from attacker-controlled XML.
//
// The bound is again semantic. The longest real value is "INSTITUTIONAL MANAGER
// COMBINATION REPORT", 40 bytes. A reportType orders of magnitude longer is not
// a report type, and must be rejected on sight rather than normalised first.
func TestNoticeReportTypeRejectsAbsurdValue(t *testing.T) {
	huge := strings.Repeat("FUND NOTICE REPORT ", 200_000) // ~3.8 MB

	if isNoticeReportType(huge) {
		t.Fatalf("a %d-byte reportType was accepted as a notice declaration", len(huge))
	}

	// The real vector: the value must not be normalised at all before being
	// rejected. A bound on length is the only thing that can establish that, and
	// it must reject a value that is merely long even when its prefix is a valid
	// notice spelling.
	padded := "FUND NOTICE REPORT" + strings.Repeat(" ", 100_000)
	if isNoticeReportType(padded) {
		t.Errorf("a notice spelling padded with %d bytes of whitespace was accepted;"+
			" the length bound must precede normalisation", 100_000)
	}
}

// TestNoticeReportTypeStillAcceptsRealValues is the guard on that bound: the
// two spellings the corpus actually carries, with the case and whitespace
// variation filers actually produce, must keep working.
func TestNoticeReportTypeStillAcceptsRealValues(t *testing.T) {
	accept := []string{
		"FUND NOTICE REPORT",
		"INSTITUTIONAL MANAGER NOTICE REPORT",
		"  Fund Notice Report  ",
		"Institutional  Manager\tNotice\nReport",
	}
	for _, v := range accept {
		if !isNoticeReportType(v) {
			t.Errorf("isNoticeReportType(%q) = false, want true", v)
		}
	}

	reject := []string{
		"FUND VOTING REPORT",
		"INSTITUTIONAL MANAGER VOTING REPORT",
		"INSTITUTIONAL MANAGER COMBINATION REPORT",
		"",
	}
	for _, v := range reject {
		if isNoticeReportType(v) {
			t.Errorf("isNoticeReportType(%q) = true, want false", v)
		}
	}
}
