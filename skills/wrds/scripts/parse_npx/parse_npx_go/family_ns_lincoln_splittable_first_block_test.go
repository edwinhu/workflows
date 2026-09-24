package main

import (
	"path/filepath"
	"testing"
)

// 000091/914036/0001193125-22-231315.txt: verbatim source lines 1-52 and
// 1503-1511 (the SGML header down to `<TEXT>`), 943-955 (the ONE `<SERIES>`
// declaration this fixture needs, S000042336), and 1719-1797 (the fund banner,
// the first issuer's two-panel block under it, the page break, and the second
// issuer's block after the break). Every byte is a line-range cut of the source;
// the four closing lines `</PRE>`, ` </DIV>`, `</TEXT>` and `</DOCUMENT>` are the
// only added ones, and they close markup the cut opened.
//
// LINCOLN VARIABLE INSURANCE PRODUCTS TRUST, CIK 914036, period 20220630. The
// filing is 50 MB of the SEC's own Form N-PX template printed as fixed-width
// text inside `<PRE>`, one fund per section, and it dispatches to `splittable`
// (`run73` manifest, and the precondition below re-asserts it on the cut).
// `parseSplitTableRaw` finds no `<TABLE>` tag in it, so every row comes from
// `spInstitutionalPreRows` (`layout_splittable.go:536`).
//
// THE GRAMMAR. A section opens with a bare banner line naming the fund -- source
// line 1721, `LVIP American Century Select Mid Cap Managed Volatility Fund`,
// declared as S000042336 at source lines 945-946 -- and the page under it prints
// the ballots as TWO PANELS separated by nothing but a label stack:
//
//	------------------ --------  ---------- ------------  ------------------------ ------------  -------------------
//	Healthcare Trust                                      Elect Director Scott D.
//	of America, Inc.     HTA     42225P501   07-Jul-21    Peters                   Management           Yes
//	... eight more ...
//	                   Fund's Vote For or
//	...
//	------------------ --------------------  ------------
//	Healthcare Trust
//	of America, Inc.         For                 No
//
// The main panel carries issuer, ticker, CUSIP, meeting date, matter and
// proponent; the spill panel carries the VOTE, keyed on the issuer alone and
// joined to the main panel BY LINE POSITION. Then a page break, and the same
// section's next issuer (Chewy, source line 1785) prints all of those columns
// inline on one line, which is the geometry `spJoinSpill` exists to name.
//
// WHAT ACTUALLY HAPPENS -- measured on this cut through the real dispatch:
// SIX rows, all six Chewy, all six correctly S000042336. The first issuer's TEN
// votes produce NO ROWS AT ALL. They are not blank-attributed; they are dropped.
//
// WHY. `spInstitutionalPreRows` has no positional join across the two panels,
// only across pages. At `layout_splittable.go:614` the main panel is recognised
// (`spIsMainPanel`: it has an issuer and a description) but carries no vote
// column -- `WHETHER FUND CAST VOTE ON MATTER` is deliberately absent from
// `spSECFormRoles` (`layout_splittable.go:1174`) because it holds Yes/No -- so it
// is parked in `pendLabels` and its ballots fall to the header buffer. When the
// spill panel's rule arrives, `layout_splittable.go:602-611` takes its LABELS,
// joins them to the pending main panel, and clears the header buffer. That
// `header = nil` at line 610 is where the main panel's ten ballots go, and the
// spill panel's own ten lines are then refused as restatements (line 604-608).
// The joined geometry is kept for the pages AFTER the break, which is why Chewy
// resolves and the block the banner sits directly on top of does not.
//
// The vote is recoverable from the bytes: the two panels print the same ten
// ballots in the same order under the same issuer, which is exactly the
// positional join `spGroupRows` already performs when this family's tables are
// tagged `<TABLE>` (`parseSplitTableRaw`'s group path, `layout_splittable.go:314`).
//
// SCOPE. Measured over the whole filing: 46 pages print the stacked header, and
// 42 of them carry a banner above a two-panel block -- this test's shape, one
// dropped first page per fund section. That is NOT the 6,969 blank-series rows
// LOST_BASE records for this filing. Those blanks are a different defect in the
// same function: `layout_splittable.go:598` sets `ctx.bare` UNCONDITIONALLY from
// the current page's banner, so a mid-section page that reprints the stacked
// header with NO banner above it clears the fund for every remaining page of the
// section. The filing prints two such pages (source lines 43225 and 50218) and
// they account for the first two of the three runs of blank rows.
//
// Fix location for THIS test: the spill arm of `spInstitutionalPreRows`,
// `layout_splittable.go:600-621`.
func TestFamilyNSLincolnSplittableFirstBlock(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	const fixture = "lincoln_splittable_first_block.txt"
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture,
		filepath.Join("testdata", "family_ns_lincoln_splittable_first_block", fixture),
		sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" || meta.Layout != "splittable" {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s want ok/splittable error=%s",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}

	chewy, hta := 0, 0
	for _, r := range rows {
		switch r.IssuerName {
		case "Chewy, Inc.":
			chewy++
			// The block AFTER the page break, which resolves today. It guards the
			// fixture: the banner at source line 1721 is what gives it S000042336,
			// so if this goes blank the cut is broken, not the grammar.
			if r.SeriesID != "S000042336" {
				t.Fatalf("fixture guard: the block after the page break stopped resolving: series=%q fund=%q", r.SeriesID, r.FundName)
			}
		case "Healthcare Trust of America, Inc.":
			hta++
			if r.SeriesID != "S000042336" ||
				r.FundName != "LVIP American Century Select Mid Cap Managed Volatility Fund" {
				t.Errorf("the block printed directly under the fund banner carries no fund: series=%q fund=%q cusip=%q date=%q desc=%q how_voted=%q want S000042336 / `LVIP American Century Select Mid Cap Managed Volatility Fund`, the banner this filing prints at source line 1721 and declares at source lines 945-946",
					r.SeriesID, r.FundName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.HowVoted)
			}
		default:
			t.Fatalf("fixture guard: unexpected issuer %q", r.IssuerName)
		}
	}
	if chewy != 6 {
		t.Fatalf("fixture guard: read %d rows of the Chewy block, want 6", chewy)
	}
	if hta != 10 {
		t.Errorf("the ten ballots the two-panel block under the banner prints (source lines 1729-1750, votes at 1757-1778) produced %d rows: the main panel's ballots are cleared with the header buffer at layout_splittable.go:610 and the spill panel's are refused as restatements, so no row of the banner's own first block is emitted at all",
			hta)
	}
}
