package main

import (
	"path/filepath"
	"testing"
)

// The fixture carries the extension `.npx`, not `.txt`, and that is deliberate:
// TestHowVotedVocabularyInvariant sweeps every `*.txt` under testdata/ and
// asserts that no emitted how_voted is a non-vote, which is exactly the defect
// reproduced here. A `.txt` fixture turns that existing invariant red as well
// (measured: 7 of the 8 rows, `"r"` and `"ainst"`), so the reproduction is kept
// out of its corpus rather than the invariant being weakened. Nothing in
// processFile keys on the extension.
//
// familyVS1Dispatch runs the real dispatch on a family VS1 fixture and returns
// the emitted rows with the manifest row. The precondition IS asserted here --
// the defect under test is the VALUE of two columns, not a failure to read the
// table, so a fixture that dispatched elsewhere or emitted nothing would be a
// fixture error and must be told apart from the assertion.
func familyVS1Dispatch(t *testing.T, fixture string, wantRows int) []VoteRow {
	t.Helper()
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_vs1", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != "votesummary" || len(rows) != wantRows {
		t.Fatalf("fixture precondition: status=%s layout=%s rows=%d error=%q; want status=ok layout=votesummary rows=%d",
			meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg, wantRows)
	}
	return rows
}

// 000102/1026708/0001193125-05-176987.txt, source lines 11-28, 50-59 and
// 111-135 verbatim (WILSHIRE VARIABLE INSURANCE TRUST, period 20050630, layout
// votesummary, 2,367 rows in the whole filing).
//
// votesummary derives its column boundaries from the two stacked HEADER lines
// (voteSummaryColumns, layout_votesummary.go:48) and never reads the `<S> <C>`
// ruler that EDGAR prints beneath them -- the scan skips every line starting
// `<` (layout_votesummary.go:200). In this filing the two disagree. Column
// starts, measured on the fixture's own bytes:
//
//	ruler  <S>/<C>   0   14   68   79   88   97  107  118
//	header labels    0   14   69   81   90   98  108  119
//	                      Ballot Security Rec Cast Date Prpnent Voted
//
// and the DATA is laid out on the ruler, not on the labels:
//
//	<S>           <C>                                                   <C>        <C>      <C>      <C>       <C>        <C>
//	04/22/05 - A  Abbott Laboratories *ABT*                             002824100                    02/23/05              15,900
//	              1    Elect Directors                                             For      For                Mgmt
//
// `002824100` starts at 68 and `For` (Vote Cast) at 88, so cutting the ballot
// column at the label's 69 leaves the cusip's leading `0` on the end of the
// issuer and hands eight characters to the security column, and cutting Vote
// Cast at the label's 90 hands back `r` for a printed `For` and `ainst` for a
// printed `Against`. Mgmt Rec is cut at 81 against data at 79 and loses two
// characters the same way.
//
// Fix in layout_votesummary.go: when the header pair is followed (after the
// optional `- ----` rule line) by an `<S> ... <C> ...` ruler, take the column
// starts from the ruler's marker positions and keep voteSummaryFieldsOf's
// label-over-span naming, falling back to the present header-derived starts
// only when no ruler is printed. parseVoteSummaryRaw's header-pair branch
// (layout_votesummary.go:208-231) is where the ruler has to be looked ahead to,
// since the `<`-prefixed line is skipped before the loop can see it.
func TestFamilyVS1WilshireVoteSummaryRulerColumns(t *testing.T) {
	rows := familyVS1Dispatch(t, "wilshire_abbott_columns.npx", 8)

	// The fixture prints exactly one cusip, `002824100`, on the meeting line.
	// A blank cusip would be better than a wrong one; eight of its nine
	// characters is wrong.
	for i, r := range rows {
		if r.CUSIP != "002824100" {
			t.Errorf("row %d (item %q): cusip = %q, want %q -- the Security column is printed at offset 68 (the ruler's third <C>) and the layout cuts it at 69 (the `Security` LABEL), so the leading `0` is eaten by the issuer, which comes out %q",
				i, r.ItemSeq, r.CUSIP, "002824100", r.IssuerName)
		}
	}

	// how_voted, verbatim from the Vote Cast column of each item line. Item 7
	// wraps and prints its vote on the continuation line, which this layout
	// never reads at all -- a separate defect, not asserted here.
	want := map[string]string{
		"1": "For",
		"2": "For",
		"3": "Against",
		"4": "For",
		"5": "Against",
		"6": "Against",
		"8": "Against",
	}
	seen := 0
	for _, r := range rows {
		w, ok := want[r.ItemSeq]
		if !ok {
			continue
		}
		seen++
		if r.HowVoted != w {
			t.Errorf("item %s (%q): how_voted = %q, want %q -- Vote Cast is printed at offset 88 (the ruler's fifth <C>) and the layout cuts it at 90 (the `Cast` LABEL), dropping the first two characters",
				r.ItemSeq, truncate(r.VoteDescription, 46), r.HowVoted, w)
		}
	}
	if seen != len(want) {
		t.Fatalf("found %d of the %d single-line items in %d parsed rows", seen, len(want), len(rows))
	}
}
