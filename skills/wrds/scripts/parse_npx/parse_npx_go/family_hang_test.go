package main

import (
	"path/filepath"
	"testing"
	"time"
)

// 000168/1683471/0001879992-21-000002.txt: 1-61, 115-140, 255-264, 18294-18543,
// 45326-45330. Listed Funds Trust 2021, a 2.8 MB filing the current binary never
// finishes: a 120-second timeout kills it while it burns CPU at flat memory.
//
// The filing carries TWO documents. The first is the 200-line N-PX text the
// broadridge layout reads. The second is the same report as a uuencoded PDF,
// 45,064 lines of it, verbatim:
//
//	<DOCUMENT>
//	<TYPE>N-PX
//	<SEQUENCE>2
//	<FILENAME>a.pdf
//	<TEXT>
//	<PDF>
//	begin 644 a.pdf
//	M)5!$1BTQ+C<*"C0@,\"!O8FH*/#P*+T9I;'1E<B O1FQA=&5$96-O9&4*+TQE
//
// Uuencoded bytes contain `<` and `>` as ordinary payload characters. stripHTML
// treats the first `<` as a tag open and deletes everything through the next
// `>`, NEWLINES INCLUDED, so hundreds of 61-character payload lines are welded
// into one pseudo-line. In this fixture the welded line is 11,468 bytes; in the
// whole filing the longest is 257,313 bytes.
//
// parseBroadridge (layout_broadridge.go:1184) splits the normalised text on
// "\n", so that weld is a single `line`. It carries no label and no item token,
// so it falls through to the free-standing-text branch, becomes pendingIssuer
// (layout_broadridge.go:1560), and on the next boundary is handed whole to
// issResolveFund (layout_broadridge.go:1556).
//
// issResolveFundUncached then recurses on it. The medial-parenthetical branch
// (layout_issnpx.go:2597-2601) cuts `head (x) tail` to `head tail` and calls
// issResolveFund again; the trailing-parenthetical, sub-adviser, dash, colon and
// fund-code branches each recurse on their own cut of the SAME banner. Each cut
// removes only the two parentheses, so a banner with 224 `(` characters descends
// hundreds of levels with a branching factor above one, and every level re-runs
// the whole rule chain -- strings.Fields over 11 KB among them
// (layout_issnpx.go:3753). The resolved cache is keyed on the exact banner
// string and every cut is a distinct string, so it never hits.
//
// Measured on the fixture's own 11,468-byte weld, one issResolveFund call
// against a one-series index: 2,800 bytes / 39 parens = 242 ms, 4,000 / 99 =
// 592 ms, 5,600 / 136 = 1.43 s, 8,000 / 170 = 4.46 s, 11,468 / 224 = over 8 s.
// The filing has many such welds, which is the 120-second wall.
//
// This is a parser hang, not a data shape: no vote is lost or gained by fixing
// it, and the fixture asserts only that the dispatch RETURNS.
//
// Fix in layout_issnpx.go, at the top of issResolveFundUncached: refuse a banner
// that cannot be a fund name before any recursive cut runs -- a length cap (a
// declared series name is tens of bytes, never kilobytes) and/or a recursion
// depth bound threaded through the cut chain. The complementary fix is in
// main.go/text_parser.go: a `<TEXT>` document whose body is a `begin 644 ...`
// uuencode block is a binary attachment and should never reach a layout parser
// at all.
func TestFamilyHangListedFundsTrust2021(t *testing.T) {
	fixture := "listed_funds_trust_uuencoded_pdf.txt"
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	done := make(chan FilingMeta, 1)
	go func() {
		done <- processFile(fixture, filepath.Join("testdata", "family_hang", fixture), sink, make([]byte, headBytes))
	}()
	select {
	case meta := <-done:
		if meta.ParseStatus != "ok" || meta.Layout != "broadridge" {
			t.Fatalf("fixture/dispatch precondition: status=%s layout=%s error=%s", meta.ParseStatus, meta.Layout, meta.ErrorMsg)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("dispatch on %s did not return within 10s: the uuencoded PDF welds into an 11,468-byte pseudo-banner and issResolveFundUncached recurses on its 224 parentheses (layout_issnpx.go:2597)", fixture)
	}
}
