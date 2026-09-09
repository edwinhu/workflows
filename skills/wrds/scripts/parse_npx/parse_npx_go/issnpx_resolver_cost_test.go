package main

import (
	"fmt"
	"testing"
	"time"
)

// A dictionary-backed registrant declares hundreds of series (iShares Trust,
// CIK 0001100663, carries 882 in cik_series.tsv), and every heading in the body
// is resolved against all of them: the declaration-scanning rungs
// (issNearMissDecl, issDistinctiveTokenDecl, issAbbrevStemDecl and their
// siblings) walk ix.decls and re-normalise every declared name on every call.
// A body prints the SAME heading on every page, so the identical banner is
// resolved thousands of times over one filing, at full scan cost each time.
// On 000110/1100663/0001193125-05-178348.txt that is 35+ minutes of CPU for a
// 46.8 MB filing that parses in 5.5s without a dictionary.
//
// issResolveFund is pure in (ix, banner): the repeat is recomputation, never
// new evidence. This asserts only that the repeats are amortised — it changes
// nothing about which series any rung reaches on the first call.
func TestISSResolveFundRepeatAmortised(t *testing.T) {
	decls := make([]SeriesDecl, 0, 900)
	for i := range 900 {
		decls = append(decls, SeriesDecl{
			SeriesID: fmt.Sprintf("S%09d", i),
			Name:     fmt.Sprintf("iShares Synthetic Market Index Portfolio %d Fund", i),
		})
	}
	ix := newISSSeriesIndex(decls, normalizeSeriesName("iShares Trust"))

	// A page heading no rung resolves, so every rung runs to completion.
	const banner = "Unlisted Counterparty Holding Aggregate Balanced Reserve Trust"

	start := time.Now()
	if _, d := issResolveFund(ix, banner); d != nil {
		t.Fatalf("banner resolved to %s; the fixture must stay unresolvable", d.SeriesID)
	}
	first := time.Since(start)

	start = time.Now()
	for range 1000 {
		issResolveFund(ix, banner)
	}
	repeats := time.Since(start)

	// Ten first-call costs is a generous ceiling for a thousand repeats of one
	// banner against one index; without memoisation this is a thousand.
	if limit := 10 * first; repeats > limit {
		t.Fatalf("1000 repeats of one banner took %s; first call took %s, want under %s", repeats, first, limit)
	}
}
