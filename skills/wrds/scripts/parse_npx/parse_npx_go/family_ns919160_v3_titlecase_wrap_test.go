package main

import (
	"path/filepath"
	"testing"
)

// 000091/919160/0001398344-12-003055.txt: verbatim source lines 1-150 (the SGML
// header, including all eight `<SERIES>` declarations, down through `<TEXT>`,
// `<html>` and `<body>`), 62052-62058 (the `Guinness Atkinson Global Energy
// Fund` section banner at source line 62056 and the `<table>` that opens its
// grid at source line 62053) and 74180-76595 (the `GAZPROM OAO, MOSCOW`
// 29-Jun-2012 AGM ballot -- its banner row at source line 74180, its identity
// block, its header band at source lines 74261-74279 and its items 1 through
// 45). Every byte of the first 2,573 lines is a line-range cut of the source;
// the seven closing lines `</tr></table>`, `</div>`, `</body>`, `</html>`,
// `</TEXT>`, `</DOCUMENT>` and `</SEC-DOCUMENT>` are the only added ones, and
// they close markup the cut opened.
//
// GUINNESS ATKINSON FUNDS, CIK 919160, period 20120630, N-PX/A, dispatched
// `proxyedge` (the precondition below re-asserts it on the cut). On the whole
// real filing, current worktree code, `-cik-series` and `-series-map` as
// production `residue.sh` passes them: 2,673 rows, 451 with `series_id` blank,
// every one of them in the Global Energy section, with `fund_name` showing
// `Gazprom of funds with a maximum amount of one billion` on 366 of them and
// `RMB200 million. The above funds can scroll use, the time` on 84. On this cut:
// 44 rows, 37 blank, the first at row 7.
//
// THIRD VARIANT OF THE SAME ARM, AND NEITHER SHIPPED GUARD REACHES IT. Commit
// a5a47454 (`peWrappedProse`) covers a continuation that opens LOWER-CASE;
// commit 1153d687 widened `peWrapContinues` to cover one that opens on
// punctuation, and to admit an UPPER-CASE opener when the line is both long and
// carries clause punctuation (`peWrapClause`, `;:()"`). What defects here is a
// continuation that opens on a single Title-Case proper noun and carries no
// clause punctuation at all -- so `peWrapClause` refuses it -- while still being
// a mid-sentence fragment of the cell above it.
//
// Two lines in this ballot do it, and each one clears the fund:
//
//   - Source line 74507, item 9. Its run starts at source line 74495 and
//     survives four continuations, then source line 74505 `Gazprom and
//     Gazprombank (Open Joint Stock Company)` IS admitted -- upper-case, 49
//     runes, and the parentheses satisfy `peWrapClause`. That line ends on `)`,
//     and `peWrapContinues` (`layout_proxyedge.go:273-275`) refuses any
//     successor to a line ending on a word break other than `, ; - '`. So the
//     run stops there and source line 74507 `regarding receipt by OAO Gazprom of
//     funds with a` becomes a run's FIRST line, which `peWrappedProse` never
//     marks by design (`layout_proxyedge.go:235`). It carries `funds`, which
//     `peFundWord` accepts as the word `FUNDS`, so the bare-heading arm fires on
//     it. Lower-case opener, and still not reached: the guard is indexed on the
//     run, not on the line.
//   - Source line 74557, item 10. `Gazprom of funds with a maximum amount of one
//     billion` -- 52 runes, opens Title-Case on `Gazprom`, and carries no
//     `;:()"` anywhere, so `peWrapClause` fails and the line neither continues
//     the run above it (broken one line earlier at source line 74555 `Gazprom
//     and OAO Bank VTB regarding receipt by OAO`, refused for exactly the same
//     reason) nor reaches `peWrapRun` = 3 as a run of its own. It carries
//     `funds`, the arm fires, and THIS is the string that stands as `fund_name`
//     for every blank row after it -- 366 rows on the real filing, rows 8-43 on
//     this cut.
//
// In both cases `fund = line`, `icrResolveFundShared` and `htmlDictionaryFund`
// both return "" for a proposal fragment, so `fundSeries` goes empty and STAYS
// empty for every row after it. Nothing between the banner at source line 62056
// and these rows names another fund, so the open fund is recoverable throughout.
//
// The fragments reach the heading scan at all only because `peVoteRow` refuses
// the rows they sit in: the band is `Item | Proposal | Recommendation | For |
// Against | Abstain | Take No Action` (7 columns, source lines 74261-74279), and
// with a description the vendor split into one `<div>` per physical line inside
// a single `<td>`, the cell standing in the `For` position is a sentence rather
// than a count, so `peCount` fails and the loop advances one line at a time
// across the fragments. That mis-slide is visible in the rows that DO survive
// (row 1 below carries `profit and loss report of the Company based on the
// results` as its item number) and is a separate defect of the same
// cell-splitting cause, measured but deliberately not asserted here.
//
// Fix location: `peWrapContinues` / `peWrapClause`,
// `layout_proxyedge.go:269-293`, and/or the run indexing in `peWrappedProse`,
// `layout_proxyedge.go:223-242`, and/or the bare-heading arm they guard.
func TestFamilyNS919160V3TitleCaseWrappedProposalClearsFund(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })

	const dir = "family_ns919160_v3_titlecase_wrap"
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

	const fixture = "guinness_gazprom_titlecase_wrapped_2012.txt"
	ch := make(chan *ParseResult, 8192)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", dir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" || len(rows) != 44 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want ok/proxyedge/44 error=%s",
			meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	const (
		wantSeries = "S000005896"
		wantFund   = "Guinness Atkinson Global Energy Fund"
	)

	// Rows 0-6 are items 2 through 8, all upstream of item 9's wrapped
	// description, and must still carry the banner's fund -- if they do not, the
	// cut is broken rather than the grammar.
	for i, r := range rows[:7] {
		if r.IssuerName != "GAZPROM OAO, MOSCOW" || r.SeriesID != wantSeries || r.FundName != wantFund {
			t.Fatalf("fixture guard: a row upstream of item 9's wrapped description stopped resolving at row %d: issuer=%q item=%q series=%q fund=%q",
				i, r.IssuerName, r.ItemSeq, r.SeriesID, r.FundName)
		}
	}

	for i, r := range rows[7:] {
		if r.SeriesID != wantSeries || r.FundName != wantFund {
			t.Errorf("row %d, downstream of the Title-Case wrapped continuations at source lines 74507 and 74557, lost the open fund: item=%q desc=%q how_voted=%q series=%q fund=%q want %s / %q -- `regarding receipt by OAO Gazprom of funds with a` and `Gazprom of funds with a maximum amount of one billion` are mid-sentence fragments of the cell above them, but neither opens lower-case nor carries the `;:()\"` that `peWrapClause` demands of an upper-case opener, so `peWrapContinues` refuses them as continuations and the bare-heading arm reads them as fund banners, clearing the fund the banner at source line 62056 opened",
				i+7, r.ItemSeq, r.VoteDescription, r.HowVoted, r.SeriesID, r.FundName, wantSeries, wantFund)
		}
	}
}
