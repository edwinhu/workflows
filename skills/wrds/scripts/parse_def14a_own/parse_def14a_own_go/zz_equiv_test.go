package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"
)

// TestScreenNameDecisionsDump is a harness, not an assertion: with
// SCREEN_DUMP_IN/OUT set it writes the screen's per-name decision for every name
// in a file so the Go rules can be compared against the python simulation the
// rule set was measured with. It is skipped in a normal run.
func TestScreenNameDecisionsDump(t *testing.T) {
	in, out := os.Getenv("SCREEN_DUMP_IN"), os.Getenv("SCREEN_DUMP_OUT")
	if in == "" || out == "" {
		t.Skip("no SCREEN_DUMP_IN/OUT")
	}
	f, err := os.Open(in)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	w, err := os.Create(out)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		p := strings.SplitN(sc.Text(), "\t", 2)
		if len(p) != 2 {
			continue
		}
		pct, _ := strconv.ParseFloat(p[1], 64)
		r := Row{HolderName: p[0], Percent: &pct}
		screenRepairPair(&r)
		drop := screenNoHolder(strings.TrimSpace(r.HolderName)) || *r.Percent == 100.0
		fmt.Fprintf(w, "%s\t%s\t%v\t%s\t%s\n", p[0], p[1], drop, r.HolderName,
			strconv.FormatFloat(*r.Percent, 'f', -1, 64))
	}
}
