package main

import (
	"path/filepath"
	"testing"
	"time"
)

// 000130/1303459/0000878467-07-000113.txt: 1-73, 104-109. Fidelity Central
// Investment Portfolios LLC 2007, a 9,243-byte no-activity notice that never
// finished when a per-registrant dictionary is loaded (`-cik-series`), which is
// how every run since r64 invokes it. Two shards of the run73 full parse sat on
// filings of this shape for hours at flat memory. Reproduced at 58d5d654 and on
// the grid's parse_npx_go_266: 40 s wall, killed by the timeout, 0 rows written.
// Fixed by 0aeccc55 (resolver recursion-depth bound), which returns in 1 s; this
// fixture is the regression guard for that bound.
//
// The filing is an ordinary htmltable no-activity report. Its summary banner is
// a bare centred line:
//
//	<p align="center">VOTE SUMMARY REPORT						<br>Fidelity High Income Central Fund 1<br>07/01/2006-						06/30/2007<br></p>
//
// htmlBareFundLine hands `Fidelity High Income Central Fund 1` to
// issResolveFund, and two rungs of issResolveFundUncached then pass the key
// back and forth forever, growing it by two bytes each round trip:
//
//	layout_issnpx.go:3740-3744  the heading DROPPED the word every declared
//	                            name shares, so append ix.commonSuffix and
//	                            resolve again. The guard is
//	                            `toks[len(toks)-1] != ix.commonSuffix`, and the
//	                            comment above it states the termination
//	                            argument: "the retried key ends in the suffix,
//	                            so it cannot recurse".
//	layout_issnpx.go:3074-3087  a series letter printed as the digit it looks
//	                            like: a STANDALONE single-character last token
//	                            `1` is rewritten to `I` and resolved again.
//
// The dictionary's only name for this CIK is `Fidelity High Income Central Fund
// 1`, so ix.commonSuffix is the one-character word `1`. The append rung makes
// `... Fund 1`; the digit-swap rung rewrites the trailing `1` to `I`, which is
// no longer equal to commonSuffix, so the append rung fires again on `... Fund
// I`, and so on. The swap rung is precisely what invalidates the append rung's
// termination argument. The observed key lengths on this fixture, entry first:
// 46, 34, 36, 38, 40, ... 239 and still climbing after 15 seconds, with the
// whole rule chain re-run at every level and the resolved cache never hitting
// because every key is a new string.
//
// This is a parser hang, not a data shape: no vote is lost or gained by fixing
// it, and the fixture asserts only that the dispatch RETURNS.
//
// Fix in layout_issnpx.go, issResolveFundUncached: the append rung at 3740 must
// not hand back a key that a later rung can un-suffix. Either bound the chain
// (a recursion depth or a "this key is longer than the longest declared name"
// refusal before any recursive rung runs), or make the two rungs disjoint --
// refuse the digit-to-letter swap at 3074 when the single-character token is
// one this resolver appended, and refuse the append at 3740 when the key's last
// token is a single character. A length cap alone is enough to stop the run.
func TestFamilyHangFidelityCentralSuffixCycle(t *testing.T) {
	dir, fixture := "family_hang", "fidelity_central_suffix_cycle.txt"
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", dir, "fidelity_central_cik_series.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	done := make(chan FilingMeta, 1)
	go func() {
		sink := &rowSink{}
		done <- processFile(fixture, filepath.Join("testdata", dir, fixture), sink, make([]byte, headBytes))
	}()
	select {
	case meta := <-done:
		if meta.ParseStatus != "ok" || meta.Layout != "no-activity" {
			t.Fatalf("fixture/dispatch precondition: status=%s layout=%s error=%s", meta.ParseStatus, meta.Layout, meta.ErrorMsg)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("dispatch on %s did not return within 10s: `Fidelity High Income Central Fund 1` cycles between the commonSuffix append (layout_issnpx.go:3742) and the single-character digit-to-letter swap (layout_issnpx.go:3084), growing the key two bytes per round trip", fixture)
	}
}
