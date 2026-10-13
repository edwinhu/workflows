package main

import "testing"

// A filing that declares several series and names no fund on any row reports the
// trust's votes as one record (JHVIT 2011: 111 series, 6,267 meetings, no fund name
// anywhere; 645 such filings, 2.45M rows on run68). Those rows belong to every
// declared series, and the stamp says so with the full list, MultiValueSep-joined,
// for the linker to expand. One fund heading anywhere, or a header declaring fewer
// than two series, means the ordinary rules apply and nothing is stamped.
func TestConsolidatedFilingStampsEveryDeclaredSeries(t *testing.T) {
	sc := []SeriesClass{{SeriesID: "S000000001", ClassID: "C1"}, {SeriesID: "S000000002", ClassID: "C2"}, {SeriesID: "S000000002", ClassID: "C3"}}
	rows := []VoteRow{{IssuerName: "A"}, {IssuerName: "B"}}
	if got := consolidatedSeries(sc, rows); got != "S000000001;S000000002" {
		t.Fatalf("consolidated stamp = %q", got)
	}
	if got := consolidatedSeries(sc, []VoteRow{{IssuerName: "A"}, {IssuerName: "B", FundName: "Growth Fund"}}); got != "" {
		t.Fatalf("a fund heading anywhere must disable the stamp, got %q", got)
	}
	if got := consolidatedSeries(sc, []VoteRow{{IssuerName: "A", SeriesID: "S000000001"}, {IssuerName: "B"}}); got != "" {
		t.Fatalf("a resolved series anywhere must disable the stamp, got %q", got)
	}
	if got := consolidatedSeries([]SeriesClass{{SeriesID: "S000000001"}}, rows); got != "" {
		t.Fatalf("one declared series is the chassis's case, got %q", got)
	}
	if got := consolidatedSeries(sc, nil); got != "" {
		t.Fatalf("no rows, no stamp, got %q", got)
	}
}
