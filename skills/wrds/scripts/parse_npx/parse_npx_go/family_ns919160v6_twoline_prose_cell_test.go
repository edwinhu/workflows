package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 000091/919160/0000894189-09-002552.txt: verbatim source lines 1-142 (the SGML
// header with all six `<SERIES>` declarations, `<TEXT>`, `<html>`, `<head>` and
// `<body>`), 11870-11898 (the `<table>` that opens the Asia Focus section and
// the section banner's own `<tr>` -- the banner cell is source lines 11873-11874,
// `Guinness Atkinson Asia Focus` / `Fund`, one `<div>` the vendor hard-wrapped
// across two physical lines), 13360 (the `<table>` that opens that section's
// ballots) and 20757-21167 (the YANZHOU COAL MNG CO LTD 23-Dec-2008 EGM -- its
// issuer banner row, its `Cusip/Sedol:` identity block, its `Item | Proposal |
// Recommendation | For | Against | Abstain | Take No Action` band, and the item
// rows through item 5, among them item 4 at source lines 21060-21114 whose
// `Proposal` cell the vendor prints as sixteen sibling `<div>`s inside one
// `<td>`). Two added `</table>` lines close the cuts' own tables and the last
// four lines close markup the cut opened; every other byte is a line range of
// the source.
//
// GUINNESS ATKINSON FUNDS, CIK 919160, period 20090630, N-PX, dispatched
// `proxyedge` (the precondition below re-asserts it on the cut).
//
// THE DEFECT. The hard-wrapped-banner arm at the end of `parseProxyEdge` reads a
// TWO-LINE cell as a fund banner: `run[i] == i && cellEnd == i+1 && !summary[i]
// && !wrapped[i] && !peItemCell(...) && peFundName(cell)`. It exists because
// `peWholeCells` marks neither half of a banner the vendor wrapped inside one
// container, so the whole-cell arm above it cannot fire on either half.
//
// Its only prose guard is `!wrapped[i]`, and that guard is VACUOUS here by
// construction: `peWrappedProse` opens a run only at a line for which `whole[i]`
// is true, so it can mark nothing that is not a single-line cell -- while this
// arm fires only on cells that are NOT single-line. Every two-line cell reaches
// the arm with `wrapped[i] == false` whatever stands around it.
//
// That is what item 4's `Proposal` cell is. The vendor wrapped the resolution
// across sixteen sibling `<div>`s, and the second of them is a two-line `<div>`
// reading `Insurance Fund Administrative` / `Services Agreement`. `peCellAt`
// joins it to `Insurance Fund Administrative Services Agreement`, `peFundName`
// finds FUND standing as a word inside it, the arm fires, `fund` becomes the
// middle of a sentence and `fundSeries` is cleared -- for every row after it,
// until the next real banner. Its own neighbours say outright that it is prose:
// the `<div>` before it ends on the bare word `of` with no punctuation at all,
// and the one after it opens lower-case on `between`. Neither fact is available
// to a test defined only over whole cells.
//
// WHY THIS IS NOT EITHER PRIOR NS-919160 HYPOTHESIS. The two fixes tried before
// on this CIK both aimed at the whole-cell bare-heading arm one branch above --
// `peBallotProse` rejection, and the `Item | Proposal | Proposed by | Vote |
// For/Against Management` band plus the colon-less identity labels (commit
// 3ef12f29). Neither can reach this cell: it is not a whole cell, so the arm
// they guard never sees it. The cause here is one commit newer than both --
// 37c075b7, `family NS-1342947-bbh-subadviser-banner-wrapped-cell`, which added
// the two-line arm -- and on this CIK that commit's effect is measured, not
// inferred. Built at 9d9e4e51 (the commit before it) this filing parses 2,075
// rows with 40 blank series; built at 37c075b7 or at HEAD it parses 2,457 with
// 1,288. The arm is a real gain -- before it, every one of this filing's six
// sections was attributed to Asia Focus, the first banner, because no later
// banner was read at all -- and this test is the hole in it, not an argument
// against it.
//
// THE ASSERTION. Items 1-3 stand before the prose cell and items 4-5 after it;
// all five ballots belong to the same Asia Focus section, whose banner the cut
// carries. Every row the cut emits must name that banner. Today the cut's last
// two rows -- the ones standing after the prose cell -- do not.
func TestFamilyNS919160V6TwoLineProseCellIsNotAFundBanner(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })

	const dir = "family_ns919160v6_twoline_prose_cell"
	var err error
	// The real corpus rows for this CIK, verbatim from the reconcile corpus's
	// cik_series.tsv. The filing's own SGML header already declares every
	// series, so the dictionary is not what makes the banner resolvable -- it is
	// here so the defect cannot be read as a missing-dictionary miss.
	cikDict, err = loadCIKSeries(filepath.Join("testdata", dir, "guinness_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	const fixture = "guinness_yanzhou_insurance_fund_prose_2009.txt"
	path := filepath.Join("testdata", dir, fixture)

	ch := make(chan *ParseResult, 8192)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, path, sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" || len(rows) != 4 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want ok/proxyedge/4 error=%s",
			meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	const (
		banner = "Guinness Atkinson Asia Focus Fund"
		series = "S000005893"
		// The join `peCellAt` returns for the two-line `<div>` at source lines
		// 21068-21069, which is the middle of item 4's resolution.
		proseCell = "Insurance Fund Administrative Services Agreement"
	)

	// Every row of this cut is a YANZHOU ballot of the Asia Focus section, whose
	// banner the cut carries at source lines 11873-11874. None may name anything
	// else.
	for i, r := range rows {
		if r.FundName != banner || r.SeriesID != series {
			t.Errorf("row %d (vote_description=%q how_voted=%q): fund_name=%q series_id=%q want %q / %q\n\tthe hard-wrapped-banner arm fired on a two-line <div> of item 4's resolution and overwrote the section's open fund",
				i, truncate(r.VoteDescription, 70), r.HowVoted, r.FundName, r.SeriesID, banner, series)
		}
		if r.FundName == proseCell {
			t.Errorf("row %d carries item 4's resolution text for a fund name (%q) -- this is the middle of a sentence, not a fund the vendor printed",
				i, r.FundName)
		}
	}

	// The arm's own condition, read on the cut's two two-line cells: the real
	// banner, which must keep firing it, and the prose `<div>`, which must not.
	// A guard that silenced the prose by refusing every two-line cell would undo
	// 37c075b7 and put this filing back to one fund for six sections.
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines, run, tbl := peCellLines(string(stripHTMLCells(raw)))
	whole := peWholeCells(run)
	summary := peSummaryBody(lines, run, tbl)
	wrapped := peWrappedProse(lines, tbl, whole)
	labels := []string{"Item", "Proposal", "Recommendation", "For", "Against", "Abstain", "Take No Action"}

	// twoLineBanner reports the arm's own condition, verbatim from the last
	// branch of parseProxyEdge.
	twoLineBanner := func(i int) bool {
		cell, cellEnd := peCellAt(lines, run, i)
		return run[i] == i && cellEnd == i+1 && !summary[i] && !wrapped[i] &&
			!peItemCell(lines, tbl, i-1, i, labels) && peFundName(cell)
	}

	bannerLine, proseLine := -1, -1
	for i := range lines {
		if run[i] != i {
			continue
		}
		cell, cellEnd := peCellAt(lines, run, i)
		if cellEnd != i+1 {
			continue
		}
		switch cell {
		case banner:
			if bannerLine < 0 {
				bannerLine = i
			}
		case proseCell:
			if proseLine < 0 {
				proseLine = i
			}
		}
	}
	if bannerLine < 0 || proseLine < 0 {
		t.Fatalf("fixture guard: cut lost one of its two-line cells: banner=%d prose=%d", bannerLine, proseLine)
	}

	if !twoLineBanner(bannerLine) {
		t.Errorf("the real section banner at cut line %d (%q / %q, source lines 11873-11874) stopped firing the hard-wrapped-banner arm: summary=%v wrapped=%v itemCell=%v fundName=%v",
			bannerLine, lines[bannerLine], lines[bannerLine+1],
			summary[bannerLine], wrapped[bannerLine],
			peItemCell(lines, tbl, bannerLine-1, bannerLine, labels), peFundName(banner))
	}

	if twoLineBanner(proseLine) {
		t.Errorf("item 4's resolution fragment at cut line %d (%q / %q, source lines 21068-21069) fires the hard-wrapped-banner arm: summary=%v wrapped=%v itemCell=%v fundName=%v\n\tthe <div> before it ends on the bare word %q and the one after it opens lower-case on %q, so this is the middle of a paragraph the vendor wrapped across sixteen sibling <div>s inside one <td>\n\t`wrapped` cannot say so: peWrappedProse opens a run only where whole[i] is true, and this arm fires only where it is false, so its !wrapped[i] guard is vacuous for every cell it ever judges",
			proseLine, lines[proseLine], lines[proseLine+1],
			summary[proseLine], wrapped[proseLine],
			peItemCell(lines, tbl, proseLine-1, proseLine, labels), peFundName(proseCell),
			lines[proseLine-1], lines[proseLine+2])
	}
}
