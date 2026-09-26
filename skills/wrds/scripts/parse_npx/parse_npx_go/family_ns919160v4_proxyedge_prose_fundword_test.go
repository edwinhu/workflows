package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 000091/919160/0001398344-17-011006.txt: verbatim source lines 1-602 (the SGML
// header with all nine `<SERIES>` declarations, `<TEXT>`, `<html>`, `<body>`,
// the cover page and the FIRST counted ballot of the Alternative Energy section
// -- its `Item | Proposal | Recommendation | Default Vote | For | Against |
// Abstain | Take No Action` band and two of its rows), 38581-38593 (the
// `Guinness Atkinson Asia Pacific Dividend Builder Fund` section banner at
// source line 38583), 40086 (the `<table>` that opens that section's ballots)
// and 45048-45396 (the `CAPITALAND MALL TRUST, SINGAPORE` 12-Apr-2017 AGM --
// its banner row, its identity block, its `Item | Proposal | Proposed by | Vote
// | For/Against Management` band, items 1 through 4, the two unlabelled
// resolution-continuation `<tr>`s at source lines 45293 and 45312, and the item
// rows after them). Two added `</table>` lines close the cuts' own tables and
// the last seven lines close markup the cut opened; every other byte is a line
// range of the source.
//
// GUINNESS ATKINSON FUNDS, CIK 919160, period 20170630, N-PX, dispatched
// `proxyedge` (the precondition below re-asserts it on the cut).
//
// THE DEFECT. The bare-heading arm at `layout_proxyedge.go:775` reads ANY whole,
// un-wrapped, non-summary, non-item cell as a fund banner the moment
// `peFundName` finds FUND, PORTFOLIO, TRUST, ETF or SERIES standing as a WORD
// anywhere inside it. A ballot's own resolution text is such a cell whenever the
// vendor prints its continuation as a `<tr>` carrying one wide `<td>` and
// nothing else, which is exactly how this filing prints the CMT general mandate:
// source line 45312 is one 2,459-byte whole cell of prose, and the words `TRUST
// DEED DATED 29 OCTOBER 2001` inside it satisfy `peFundWord(up, "TRUST")`. The
// arm fires, `fund` becomes the resolution text, `icrResolveFundShared` and
// `htmlDictionaryFund` both return "" for it, and `fundSeries` is cleared. On
// the whole real filing eleven such cells fire -- the CMT and Ascendas REIT
// unitholder resolutions and the Aberdeen Asset Management director-slate text
// at source lines 92207-92352, whose `MANAGING THE FUND STICHTING DEPOSITARY`
// trips the same word test.
//
// WHAT THIS TEST DOES NOT ASSERT, AND WHY. No row of the real filing carries the
// corrupted name, so the row-level assertion (`rows after the paragraph keep the
// banner's fund`) is NOT constructible here and is deliberately absent: from the
// Asia Focus section onward this filing's bands are `Item | Proposal | Proposed
// by | Vote | For/Against Management`, which names no disposition column, so
// `peHeaderAt` (`layout_proxyedge.go:404-407`, two dispositions minimum) returns
// nil, `labels` keeps the eight-column band the Alternative Energy section left
// behind, `peVoteRow` refuses every row against it, and the parser emits 337
// rows for the whole 7.5 MB filing -- all of them upstream of every false
// heading, in the one section whose ballots print share counts. That unread band
// is a separate defect of a separate cause; it is what currently HIDES this one.
// The assertion below is therefore on the arm's own guard composition, which is
// where the fix goes and which is decidable today.
func TestFamilyNS919160V4ProseFundWordIsNotAFundHeading(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })

	const dir = "family_ns919160v4_proxyedge_prose_fundword"
	var err error
	// The real corpus rows for this CIK, verbatim from
	// /scratch/nyu/eddyhu/npx-reconcile-corpus/cik_series.tsv. The filing's own
	// SGML header already declares every series, so the dictionary is not what
	// makes the banner resolvable -- it is here so the defect cannot be read as
	// a missing-dictionary miss.
	cikDict, err = loadCIKSeries(filepath.Join("testdata", dir, "guinness_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	const fixture = "guinness_capitaland_trustdeed_prose_2017.txt"
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

	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" || len(rows) != 2 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want ok/proxyedge/2 error=%s",
			meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}
	// The two rows the cut emits are the Alternative Energy section's, upstream
	// of every heading below -- they say the cut parses, not that the fund
	// resolves. The CMT ballot emits none, for the band reason in the comment.
	for i, r := range rows {
		if r.IssuerName != "CHINA LONGYUAN POWER GROUP CORPORATION LTD" {
			t.Fatalf("fixture guard: row %d is not the Alternative Energy ballot the cut opens with: issuer=%q item=%q",
				i, r.IssuerName, r.ItemSeq)
		}
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines, run, tbl := peCellLines(string(stripHTMLCells(raw)))
	whole := peWholeCells(run)
	summary := peSummaryBody(lines, run, tbl)
	wrapped := peWrappedProse(lines, tbl, whole)
	// The band open when the CMT ballot is read: the eight-column one the
	// Alternative Energy section left behind, which is what `labels` holds there
	// in the real filing and what `peItemCell` is asked about below.
	labels := []string{"Item", "Proposal", "Recommendation", "Default Vote", "For", "Against", "Abstain", "Take No Action"}

	// heading reports the bare-heading arm's own condition, verbatim from
	// layout_proxyedge.go:775.
	heading := func(i int) bool {
		return whole[i] && !summary[i] && !wrapped[i] &&
			!peItemCell(lines, tbl, i-1, i, labels) && peFundName(lines[i])
	}

	const (
		banner = "Guinness Atkinson Asia Pacific Dividend Builder Fund"
		// The distinguishing words of source line 45312's resolution cell.
		proseMark = "TRUST DEED DATED 29 OCTOBER 2001"
	)

	prose, bannerLine := -1, -1
	for i := range lines {
		if prose < 0 && strings.Contains(lines[i], proseMark) {
			prose = i
		}
		// The LAST occurrence before the prose cell: the name stands twice in
		// the header's own `<SERIES-NAME>` / `<CLASS-CONTRACT-NAME>` pair before
		// it is ever printed in the body, and neither of those is a cell.
		if prose < 0 && strings.TrimSpace(lines[i]) == banner {
			bannerLine = i
		}
	}
	if prose < 0 || bannerLine < 0 {
		t.Fatalf("fixture guard: cut lost its own lines: prose=%d banner=%d", prose, bannerLine)
	}

	// The real banner must stay a heading: a guard that silences the prose by
	// refusing every bare heading would blank the series on the sections that do
	// resolve today.
	if !heading(bannerLine) {
		t.Errorf("the real section banner at cut line %d (%q, source line 38583) stopped being read as a fund heading: whole=%v summary=%v wrapped=%v itemCell=%v fundName=%v",
			bannerLine, lines[bannerLine], whole[bannerLine], summary[bannerLine], wrapped[bannerLine],
			peItemCell(lines, tbl, bannerLine-1, bannerLine, labels), peFundName(lines[bannerLine]))
	}

	if heading(prose) {
		excerpt := lines[prose]
		if len(excerpt) > 180 {
			excerpt = excerpt[:180] + "..."
		}
		t.Errorf("the ballot's own resolution text at cut line %d (source line 45312, %d bytes) is read as a new fund-section heading: whole=%v summary=%v wrapped=%v itemCell=%v fundName=%v\n\t%s\n\tit is item 3's general-mandate continuation, not a fund the vendor printed -- `THE TRUST DEED DATED 29 OCTOBER 2001` makes `peFundWord(up, \"TRUST\")` true, so the arm at layout_proxyedge.go:775 overwrites `fund` with this paragraph and clears `fundSeries` for every row after it, blanking the series the banner at source line 38583 resolved",
			prose, len(lines[prose]), whole[prose], summary[prose], wrapped[prose],
			peItemCell(lines, tbl, prose-1, prose, labels), peFundName(lines[prose]), excerpt)
	}
}
