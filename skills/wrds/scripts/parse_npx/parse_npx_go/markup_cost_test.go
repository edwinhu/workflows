package main

import (
	"runtime"
	"strings"
	"testing"
)

// commentHeavyBody mimics a legacy EDGAR body: machine-generated HTML sprinkled
// with comments and page-break markup around line-oriented report text.
func commentHeavyBody(comments, filler int) []byte {
	var b strings.Builder
	b.WriteString("<HTML><BODY>\n")
	pad := strings.Repeat("Meeting Date: FEB 28, 2017 Record Date: DEC 30, 2016 ", filler)
	for i := 0; i < comments; i++ {
		b.WriteString("<!-- page break ")
		b.WriteString(pad[:64])
		b.WriteString(" -->\n")
		b.WriteString("<P><FONT SIZE=\"2\">")
		b.WriteString(pad)
		b.WriteString("</FONT></P>\n")
	}
	b.WriteString("</BODY></HTML>\n")
	return []byte(b.String())
}

func allocBytes(f func()) uint64 {
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	f()
	runtime.ReadMemStats(&after)
	return after.TotalAlloc - before.TotalAlloc
}

// stripHTML must scan the body a bounded number of times. A per-comment or
// per-script rescan that lowercases and copies the whole remaining document is
// O(comments x N): on the 66 MB legacy filings this parser targets that is tens
// of gigabytes of copying for one file, multiplied again by worker concurrency.
func TestMarkupScanCost(t *testing.T) {
	body := commentHeavyBody(400, 120)
	n := uint64(len(body))
	if n < 2<<20 {
		t.Fatalf("fixture is only %d bytes; it must be large enough for the scaling to bite", n)
	}

	got := allocBytes(func() { _ = stripHTML(body) })

	// A linear scan allocates the output plus a small constant number of
	// working buffers. 16x the input is generous headroom for that; a
	// per-comment rescan of the remainder lands three orders of magnitude above.
	const budget = 16
	if got > budget*n {
		t.Fatalf("stripHTML allocated %d bytes for a %d-byte body (%.1fx); a bounded scan must stay under %dx",
			got, n, float64(got)/float64(n), budget)
	}

	// Doubling the comment count at constant body size must not multiply cost.
	small := commentHeavyBody(200, 120)
	large := commentHeavyBody(400, 60)
	if len(small) == 0 || len(large) == 0 {
		t.Fatal("fixtures are empty")
	}
	aSmall := float64(allocBytes(func() { _ = stripHTML(small) })) / float64(len(small))
	aLarge := float64(allocBytes(func() { _ = stripHTML(large) })) / float64(len(large))
	if aLarge > 4*aSmall+float64(budget) {
		t.Fatalf("per-byte allocation rose from %.1fx to %.1fx when comment density doubled; cost is scaling with comment count, not body size",
			aSmall, aLarge)
	}
}
