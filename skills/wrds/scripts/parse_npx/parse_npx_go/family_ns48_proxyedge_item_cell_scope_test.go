package main

import (
	"path/filepath"
	"testing"
)

// CSOP ETF Trust, CIK 1617113, period 20160630, filing
// 000161/1617113/0001144204-16-119504.txt (28,944,020 bytes), verbatim bytes.
//
// Fixture = four line-range cuts of the source, spliced with nothing added and
// nothing paraphrased:
//
//	    1-591    SGML header (all three <SERIES-ID>/<SERIES-NAME> declarations),
//	             the `CSOP FTSE China A50 ETF` banner at 197, <TABLE> at 205 and
//	             table 1's first ballot
//	23935-24090  the filing's own `</TABLE>` closing table 1, the inter-section
//	             markup that carries the `CSOP China CSI 300 A-H Dynamic ETF`
//	             banner at 23949, `<table>` at 23957 and table 2's first ballot
//	   149606    the filing's own `</table>` closing table 2
//	320290-320294 the document's own trailing tags
//
// Dictionary: all four cik_series.tsv rows this CIK carries, copied verbatim.
// The dictionary is not load-bearing here -- the filing declares all three
// series in its own header, so a header-only run resolves identically -- but it
// is loaded because production always is, and because its 20150630 alias for
// S000051155 (`CSOP CSI 300 Smart ETF`) must not be the name that comes out.
//
// THE DEFECT: a fund heading is refused when the PREVIOUS SECTION's last cell
// was a share count.
//
// The filing prints three sleeves, each a centered bare <P> followed by its own
// vote table:
//
//	line    197  CSOP FTSE China A50 ETF                      S000047470   1,459 rows
//	line  23949  CSOP China CSI 300 A-H Dynamic ETF           S000051155   6,993 rows
//	line 149631  CSOP MSCI China A International Hedged ETF   S000051156  10,094 rows
//
// Measured at HEAD on the whole filing, all 18,546 rows carry S000047470.
// 17,087 of them (92.1%) belong to the other two sleeves. This is silent
// MIS-ATTRIBUTION, not a blank: it is invisible to the lost/blank metric, which
// counts it as a success.
//
// Root cause, layout_proxyedge.go:442:
//
//	if whole[i] && !peItemCell(lines, i-1, labels) && peFundName(line) {
//
// with peItemCell (layout_proxyedge.go:301) asking only two things: is a header
// band latched ANYWHERE in the document (`labels != nil`, a latch never
// cleared), and does the SINGLE immediately-preceding cell parse as a bare
// count. Neither is scoped to the current table or the current ballot.
//
// The last content cell of table 1 is the `Take No Action` share count of its
// final vote row -- the literal string `0` (source 23913-23921 strips to
// `1 / GUARANTEE FOR A COMPANY AND ITS SUBSIDIARIES / For / None / 25790 / 0 /
// 0 / 0`); the trailing all-&nbsp; spacer row contributes no cells. So when the
// scan reaches the heading at 23949 -- a different <P>, outside both tables,
// across a page break -- lines[i-1] is "0", labels is still table 1's band,
// peItemCell returns true, and the heading is discarded. fund/fundSeries stay
// on sleeve 1. The same thing happens again at the third heading. Heading 1
// survives only because labels == nil that early in the document.
//
// Single-variable proof (run on the real filing, HEAD 0bed2c26): inserting one
// extra non-numeric cell (`<P STYLE="margin: 0">ZZZSENTINELZZZ</P>`)
// immediately before headings 2 and 3, changing nothing else, restores the
// exact per-section split 1,459 / 6,993 / 10,094.
//
// Expected values here are not guessed. Section 2 handed to the parser alone
// (same fixture cuts, table 1 removed, same dictionary) emits
// [S000051155|CSOP China CSI 300 A-H Dynamic ETF|SICHUAN CHANGHONG ELECTRIC CO
// LTD] = 4, and that spelling is a verbatim case-insensitive match to the
// filing's own <SERIES-NAME> at source line 56.
//
// Blast radius: this is a proxyedge defect, not a CSOP one. Any proxyedge
// filing with more than one fund section whose preceding section ends in a
// share count -- the vendor's normal row shape -- stamps every later section
// with the first section's id.
//
// SHAPE OF THE FIX (not made here): peItemCell's guard must be scoped to the
// ballot it protects -- the preceding count must sit in the same table/row-run
// as the candidate heading, or the `labels` latch must clear at a table
// boundary. Do NOT relax peFundName and do NOT drop the guard: its stated
// purpose (a wrapped ballot description peVoteRow refused, immediately after an
// item-number cell) is real and is exercised by family NS38 on this same CIK.
//
// BOTH assertions below are required. A fix that merely stops latching -- e.g.
// returning false from peItemCell -- could satisfy the Sichuan half while
// wiping sleeve 1's correct rows, so the Shanghai half pins the direction the
// fix must NOT move.
func TestFamilyNS48ProxyEdgeItemCellGuardIsNotScopedToTheBallot(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns48", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	const fixture = "csop_second_section_heading_refused_after_count_cell.txt"
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns48", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" || meta.CIK != "0001617113" || meta.PeriodOfReport != "20160630" || len(rows) != 32 {
		t.Fatalf("fixture/dispatch precondition: status=%q layout=%q cik=%q period=%q rows=%d want ok/proxyedge/0001617113/20160630/32 error=%q",
			meta.ParseStatus, meta.Layout, meta.CIK, meta.PeriodOfReport, len(rows), meta.ErrorMsg)
	}

	// Section 1's ballot (28 rows) and section 2's ballot (4 rows), keyed by the
	// issuer each table actually votes, so neither half can be satisfied by the
	// other's rows.
	type want struct {
		series, fund string
		count        int
	}
	wants := map[string]want{
		// Sleeve 2, source heading at line 23949. THIS is the half HEAD fails:
		// the heading is refused because table 1's last cell was the count "0".
		"SICHUAN CHANGHONG ELECTRIC CO LTD": {"S000051155", "CSOP China CSI 300 A-H Dynamic ETF", 4},
		// Sleeve 1, source heading at line 197. THIS half HEAD gets right, and a
		// fix must not break it.
		"SHANGHAI PUDONG DEVELOPMENT BANK CO LTD, SHANGHAI": {"S000047470", "CSOP FTSE China A50 ETF", 28},
	}

	got := map[string]int{}
	reported := map[string]bool{}
	for _, r := range rows {
		w, ok := wants[r.IssuerName]
		if !ok {
			t.Errorf("unexpected issuer %q (series=%q fund=%q) -- the fixture holds exactly two ballots", r.IssuerName, r.SeriesID, r.FundName)
			continue
		}
		got[r.IssuerName]++
		if (r.SeriesID != w.series || r.FundName != w.fund) && !reported[r.IssuerName] {
			reported[r.IssuerName] = true
			t.Errorf("issuer %q: series=%q fund=%q, want series=%q fund=%q -- each vote table is preceded by its own centered <P> banner and must carry that banner's sleeve; peItemCell (layout_proxyedge.go:301) reads a count cell from the PREVIOUS table and a never-cleared `labels` latch, so the guard at layout_proxyedge.go:442 discards the second banner and every later section inherits section 1's id",
				r.IssuerName, r.SeriesID, r.FundName, w.series, w.fund)
		}
	}
	for issuer, w := range wants {
		if got[issuer] != w.count {
			t.Errorf("issuer %q: %d rows, want %d", issuer, got[issuer], w.count)
		}
	}
}
