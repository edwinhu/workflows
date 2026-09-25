package main

import (
	"path/filepath"
	"testing"
)

// 000091/919160/0001398344-12-003055.txt: verbatim source lines 1-54 (the SGML
// header down to `<EXISTING-SERIES-AND-CLASSES-CONTRACTS>`), 85-104 (the TWO
// `<SERIES>` declarations this fixture needs -- S000005896 is the fund under
// test, declared at source lines 85-94 as `Guinness Atkinson Global Energy
// Fund`; S000009156 `Guinness Atkinson Alternative Energy Fund` is present only
// so the single-declared-series fallback does not fill `series_id` behind the
// defect), 135-150 (the header's close, `<TEXT>` and `<body>`), 62052-62346 (the
// `Guinness Atkinson Global Energy Fund` banner at source line 62056, its first
// issuer `COASTAL ENERGY COMPANY, GEORGETOWN` and that ballot's items 2-8) and
// 65717-66259 (the `CANADIAN NATURAL RESOURCES LTD, CALGARY AB` ballot, whose
// item 18 carries the wrapped description that defects). Every byte of the first
// 928 lines is a line-range cut of the source; the seven closing lines
// `</tr></table>`, `</div>`, `</body>`, `</html>`, `</TEXT>`, `</DOCUMENT>` and
// `</SEC-DOCUMENT>` are the only added ones, and they close markup the cut
// opened.
//
// GUINNESS ATKINSON FUNDS, CIK 919160, period 20120630, N-PX/A, dispatched
// `proxyedge` (the precondition below re-asserts it on the cut). On the whole
// real filing, current worktree code, `-cik-series` ON: 2,673 rows, 584 with
// `series_id` blank, all in the Global Energy section, the first at output row
// 1,814.
//
// THE BRIEF THIS TEST WAS WRITTEN FROM WAS WRONG ON TWO POINTS, AND BOTH ARE
// SETTLED IN THE BYTES.
//
//   - The series id is S000005896, not S000009156. The filing declares
//     `Guinness Atkinson Global Energy Fund` as S000005896 (source line 87-88)
//     and `Guinness Atkinson Alternative Energy Fund` as S000009156 (source line
//     97-98); the corpus dictionary agrees on both. The Alternative Energy
//     section is the filing's FIRST and resolves correctly (output rows 1-249).
//   - There is no page break. The clearing line is not downstream of one: source
//     lines 62053 (`<table>`) and the section's close are the only table
//     boundaries in the whole Global Energy section, and the defect fires at
//     source line 66211, 4,158 lines inside that single table, with no `<PRE>`
//     page, no header repeat and no rule anywhere near it.
//
// WHAT ACTUALLY CARRIES IT -- measured, at the one line that does. The vendor
// prints each logical column as one `<td>`, and wraps a long proposal's text by
// emitting one `<div>` PER PHYSICAL LINE inside that single `<td>`. Canadian
// Natural's item 18 is seven such `<div>`s in one cell (source lines 66203-66217):
//
//	The special resolution amending the corporation's articles to
//	change the provisions of the currently authorized class of
//	preferred shares to a class of preferred shares issuable in a
//	series, and authorizing the board of directors to fix the
//	number of shares in each series and to determine the
//	designation, rights, privileges, restrictions and conditions
//	attaching to the shares of each series at the time the shares
//	are issued as described in the information circular
//
// `removeMarkup` emits `cellMark` at EVERY block boundary (`html.go:194-206`),
// and `<div>` is a block tag, so `peCellLines` parts those seven lines into
// seven separate cells and `peWholeCells` reports every one of them a cell
// ENTIRE. The protection `peCellLines`' own doc claims -- "a hard-wrapped cell
// and a run of whole cells look alike ... A blank line INSIDE a container is
// therefore part of its cell and does not end it" -- only covers a `<BR>`-or-
// newline wrap inside ONE `<div>`. It does not reach a cell the vendor wrapped
// as several `<div>`s, because each of those IS a container.
//
// So `whole[i]` is true on the continuation lines, and two of them carry a fund
// word: `series,` on source line 66209 and `series` on source line 66211, which
// `peFundWord` accepts as the word `SERIES` -- correctly, by its own contract
// ("The plural is the same word", and a comma is a word break). The bare-heading
// arm at `layout_proxyedge.go:571-578` therefore fires on them, assigns
// `fund = line`, and `icrResolveFundShared` / `htmlDictionaryFund` both return ""
// for a proposal fragment, so `fundSeries` goes empty and STAYS empty for every
// row after it -- 584 rows on the real filing.
//
// The lines reach that arm at all only because `peVoteRow` refuses item 18: it
// reads len(labels)=7 consecutive CELLS positionally (`Item`, `Proposal`,
// `Recommendation`, `For`, `Against`, `Abstain`, `Take No Action`, source lines
// 65798-65816), and with the description split over seven cells the cell in the
// `For` position is a sentence rather than a count, so `peCount` fails. The loop
// then advances one line at a time, which walks the heading scan straight across
// the fragments. That mis-slide is visible in the surviving rows too (row 21
// below carries `audit committee of the board of directors of the corporation`
// as its item number) and is a SEPARATE defect of the same cell-splitting cause;
// this test asserts only `series_id`, which is recoverable regardless: the fund
// the banner at source line 62056 opened is still open, and nothing between it
// and these rows names another one.
//
// The same shape recurs twice more in this section on the real filing, on
// `funds` rather than `series`: source line 81504 onward (`RMB200 million. The
// above funds can scroll use, the time`) and the OAO Gazprom interested-party
// proposals from source line 74609 onward (`receipt by OAO Gazprom of funds with
// a maximum amount`), which the brief named.
//
// Fix location: the bare-heading arm of `parseProxyEdge`,
// `layout_proxyedge.go:571-578`, and/or the cell accounting it rests on --
// `peCellLines` / `peWholeCells`, `layout_proxyedge.go:126-188`, which cannot
// currently tell a `<td>` boundary from a `<div>` boundary because
// `removeMarkup` marks both the same.
func TestFamilyNS919160GuinnessWrappedDescriptionClearsFund(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })

	const dir = "family_ns919160_gazprom_pagebreak"
	var err error
	// The real corpus rows for this CIK's two energy funds, verbatim from
	// /scratch/nyu/eddyhu/npx-reconcile-corpus/cik_series.tsv. The filing's own
	// SGML header already declares both, so the dictionary is not what makes
	// these rows resolvable -- it is here so the defect cannot be read as a
	// missing-dictionary miss.
	cikDict, err = loadCIKSeries(filepath.Join("testdata", dir, "guinness_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	const fixture = "guinness_global_energy_wrapped_description_2012.txt"
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", dir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" || len(rows) != 24 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want ok/proxyedge/24 error=%s",
			meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	const (
		wantSeries = "S000005896"
		wantFund   = "Guinness Atkinson Global Energy Fund"
	)

	// Row 7 opens the Canadian Natural ballot (source line 65719) and row 21 is
	// the last row read BEFORE item 18's fragments; both must still carry the
	// banner's fund, or the cut is broken rather than the grammar.
	if rows[0].IssuerName != "COASTAL ENERGY COMPANY, GEORGETOWN" || rows[7].IssuerName != "CANADIAN NATURAL RESOURCES LTD, CALGARY AB" {
		t.Fatalf("fixture guard: rows 0 and 7 should open the two ballots, got %q and %q",
			rows[0].IssuerName, rows[7].IssuerName)
	}
	for i, r := range rows[:22] {
		if r.SeriesID != wantSeries || r.FundName != wantFund {
			t.Fatalf("fixture guard: a row upstream of item 18 stopped resolving at row %d: issuer=%q item=%q series=%q fund=%q",
				i, r.IssuerName, r.ItemSeq, r.SeriesID, r.FundName)
		}
	}

	for i, r := range rows[22:] {
		if r.SeriesID != wantSeries || r.FundName != wantFund {
			t.Errorf("row %d, downstream of Canadian Natural's item 18 (source lines 66200-66217), lost the open fund: issuer=%q item=%q desc=%q how_voted=%q series=%q fund=%q want %s / %q -- item 18's description is seven `<div>`s in ONE `<td>`, so `peWholeCells` reports each continuation line a whole cell and the bare-heading arm reads `number of shares in each series and to determine the` (source line 66211) as a fund banner, clearing the fund the banner at source line 62056 opened",
				i+22, r.IssuerName, r.ItemSeq, r.VoteDescription, r.HowVoted, r.SeriesID, r.FundName, wantSeries, wantFund)
		}
	}
}
