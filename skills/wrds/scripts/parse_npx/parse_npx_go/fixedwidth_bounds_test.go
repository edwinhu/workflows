package main

import (
	"strings"
	"testing"
	"time"
)

// The fixed-width layout reads whole files into lines and splits each line on
// whitespace gaps. Both are unbounded in the input, and the input is untrusted
// third-party SEC bytes: the corpus holds filings up to 155 MB and the grid runs
// at 2 GB per slot. This is not hypothetical -- OOM-killed shards went from one to
// three between the v8 and v9 corpus builds as the layout began doing more work
// per filing, and each one costs a manual resubmit at 16 GB.
//
// These tests bound the three shapes review identified. They assert completion
// under a wall-clock budget rather than measuring memory, because a quadratic or
// unbounded allocation shows up as a test that does not finish.

const boundsBudget = 20 * time.Second

func runWithin(t *testing.T, name, doc string) {
	t.Helper()
	done := make(chan int, 1)
	go func() { done <- len(runISSNPXDoc(t, doc)) }()
	select {
	case <-done:
	case <-time.After(boundsBudget):
		t.Fatalf("%s did not finish within %s -- the fixed-width path is superlinear in this"+
			" input shape, and the corpus contains filings 100x larger than this fixture",
			name, boundsBudget)
	}
}

// TestFixedWidthGapRichLineIsBounded: one physical line of alternating text and
// wide gaps. A splitter that emits a cell per gap allocates millions of cells from
// a single line.
func TestFixedWidthGapRichLineIsBounded(t *testing.T) {
	var b strings.Builder
	b.WriteString("<PRE>\n")
	b.WriteString("Issue No.  Description  Proponent  Mgmt Rec  Vote Cast\n")
	for i := 0; i < 200_000; i++ {
		b.WriteString("x     ") // token, wide gap, repeated
	}
	b.WriteString("\n</PRE>\n")
	runWithin(t, "gap-rich line", edgarEnvelope("0000823535", "0000000000-14-000001", b.String()))
}

// TestFixedWidthManyContinuationsIsBounded: a row followed by a very long run of
// continuation lines. Joining by repeated string concatenation is quadratic.
func TestFixedWidthManyContinuationsIsBounded(t *testing.T) {
	var b strings.Builder
	b.WriteString("<PRE>\n")
	b.WriteString("Issue No.  Description              Proponent  Mgmt Rec   Vote Cast\n")
	b.WriteString("1.1        Elect Someone            Mgmt       For        For\n")
	for i := 0; i < 100_000; i++ {
		b.WriteString("            continuation text for the description\n")
	}
	b.WriteString("</PRE>\n")
	runWithin(t, "many continuations", edgarEnvelope("0000823535", "0000000000-14-000002", b.String()))
}

// TestFixedWidthManyRowsIsBounded: a filing whose row count alone is large. Rows
// accumulate into one slice; the corpus already contains a filing with 500,000
// vote rows, so the ceiling has to be real rather than assumed.
func TestFixedWidthManyRowsIsBounded(t *testing.T) {
	var b strings.Builder
	b.WriteString("<PRE>\n")
	b.WriteString("Issue No.  Description              Proponent  Mgmt Rec   Vote Cast\n")
	for i := 0; i < 200_000; i++ {
		b.WriteString("1.1        Elect Someone            Mgmt       For        For\n")
	}
	b.WriteString("</PRE>\n")
	runWithin(t, "many rows", edgarEnvelope("0000823535", "0000000000-14-000003", b.String()))
}
