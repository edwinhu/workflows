package main

import (
	"path/filepath"
	"testing"
)

// familyNS7bDispatch runs the real dispatch on a family NS7b fixture and
// asserts the layout and row count as a precondition, so a fixture that stopped
// reproducing the shape fails loudly instead of passing vacuously.
func familyNS7bDispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns7b", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	return rows
}

// 000005/53192/0001193125-09-183914.txt: 11-101, 242-254, 278-366, 81684-81781,
// 212088-212093. Nomura Partners Funds, Inc., 2009, layout `htmltable`. 3,430 of
// this filing's 8,215 rows carry no series, and every one of them has an EMPTY
// fund_name: they are the 94 pages of the Japan Fund.
//
// The heading each of those pages prints (source line 283 verbatim):
//
//	FACE="Times New Roman" SIZE="2"><B>NPF - THE JAPAN FUND </B></FONT></P> ...
//
// and the header declares that fund WITH a corporate suffix (lines 59-60):
//
//	<SERIES-ID>S000009778
//	<SERIES-NAME>THE JAPAN FUND, INC.
//
// The `NPF - ` registrant-prefix strip is not what fails: it is what stamps
// every sibling page in this filing, including the ASIA PACIFIC EX JAPAN FUND
// page this fixture carries as its control. What refuses is the declared name's
// trailing `, INC.` — the heading is `THE JAPAN FUND` after the strip, no rung
// matches the declared `THE JAPAN FUND, INC.` exactly, and the loose fallback on
// the stripped form lands on `ASIA PACIFIC EX JAPAN FUND` (S000024534), a
// substring collision the chain correctly refuses to emit. That collision is
// why the fix must be a suffix elision on the DECLARED side accepting only an
// exact hit on the remainder, and not a widened loose rung.
//
// Rows reached: 3,430 in this filing; the family's four siblings
// (-13-348137 3,335, -12-369387 3,249, -14-320785 3,151, -10-199355 3,129) are
// the same filer agent and the same Japan-Fund grammar = 16,294 family-wide.
//
// Fix in layout_issnpx.go, issResolveFundUncached: compare a heading against a
// declared name with a trailing corporate suffix (`, Inc.`, `, Inc`, `Inc.`)
// elided on the declared side, accepting only an exact hit on the remainder.
func TestFamilyNS7bNomuraDeclaredCorporateSuffixRefusesTheJapanFundHeading(t *testing.T) {
	rows := familyNS7bDispatch(t, "nomura_japan_fund_suffix.txt", "htmltable", 2)

	// Control: the sibling page whose declared name carries no corporate suffix
	// resolves through the same `NPF - ` strip and is stamped today.
	if got := rows[1].SeriesID; got != "S000024534" {
		t.Fatalf("control row lost its series: issuer=%q fund=%q series=%q want S000024534", rows[1].IssuerName, rows[1].FundName, got)
	}

	if got := rows[0].SeriesID; got != "S000009778" {
		t.Errorf("the declared name's trailing corporate suffix refused the page heading: fund=%q issuer=%q cusip=%q desc=%.40q series=%q want S000009778", rows[0].FundName, rows[0].IssuerName, rows[0].CUSIP, rows[0].VoteDescription, got)
	}
}
