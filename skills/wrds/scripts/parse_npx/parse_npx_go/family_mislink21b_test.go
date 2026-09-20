package main

import (
	"path/filepath"
	"testing"
)

// familyMislink21bDispatch runs the real dispatch on a family MISLINK21b fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the fund banner and the proposal text, never a broken fixture.
func familyMislink21bDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink21b", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink21b", fixture), sink, make([]byte, headBytes))
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

// 000108/1084380/0000930413-20-002030.txt: verbatim source lines 1-2, 4-7,
// 15-16, 42-44, 410-416, 2075-2084, 359159-359161, 475846-475852, 475886-475890
// and 475925-475935. Every byte is a line-range cut of the source. Dispatches to
// `icr` (the precondition asserts it).
//
// TIAA-CREF FUNDS, CIK 1084380, period 20200630, layout `icr`. The group
// (filing, S000005377) carries 34,908 rows and FOUR fund names on the current
// tree, only one of which the filing prints as a banner:
//
//	19,034 rows  fund_name = 2020
//	13,246 rows  fund_name = (2020-2022)
//	 2,508 rows  fund_name = 2020-2022
//	   120 rows  fund_name = TIAA-CREF Lifecycle 2020 Fund   <- the only real banner
//
// Across the whole filing 42,179 of its 161,032 rows carry a fund_name the
// filing prints nowhere as a banner, and every one of the six such strings is a
// wrapped continuation: `2020`, `(2020-2022)`, `2020-2022`, `2010` (S000005375),
// `Bond` (S000005372) and `Equity` (S000008805). Measured on the whole filing
// through the real dispatch against the 71 `=====` banners it prints.
//
// THE BYTES. Source line 359159, the banner, verbatim:
//
//	======================== TIAA-CREF Lifecycle 2020 Fund ========================
//
// and source lines 475888-475890, the WRAPPED CONTINUATION of proposal 24,
// verbatim (the leading spaces are the filing's own):
//
//	24         Personnel Option Plan    Mgmt       For        For        For
//	            2020
//
// and source lines 83120-83122, the tail of proposal 26 `Shareholder Return Plan
// (2020-2022)`:
//
//	26         Shareholder Return       Mgmt       For        For        For
//	            Plan
//	            (2020-2022)
//
// TWO DEFECTS, ONE SHAPE. A continuation line that is nothing but a year is read
// as a fund heading and as an item number, and is therefore neither appended to
// the proposal it continues nor kept out of the banner:
//
//  1. `parseICR` (`layout_icr.go:527`) takes the line above a rule of
//     underscores as the fund name whenever it resolves. Between issuer blocks
//     this filing prints that rule as a DIVIDER, and when the block it closes
//     ends on a wrapped continuation the line above the rule is `2020`, which
//     `icrResolveFundShared` answers with S000005377 `TIAA-CREF Lifecycle 2020
//     Fund`. Every block after it is stamped `fund_name = 2020`. The adjacency
//     is the filing's own: source lines 22090-22092 print `2020`, a blank and
//     the rule, and 71 banners' worth of sections downstream of such a block
//     carry the fragment.
//  2. `icrItem` (`layout_icr.go:234`) accepts a bare `2020` as an item number, so
//     the continuation rule at `layout_icr.go:677` -- which requires
//     `!icrItem(cells[0])` -- refuses it, the inverted-wrap branch at
//     `layout_icr.go:650` finds no value columns under it and gives up, and the
//     proposal keeps `Personnel Option Plan` with its `2020` tail dropped.
//     broadridge and issnpx join such a wrap with a single space.
//
// WHAT ANSWERS `2020`, MEASURED. The dictionary fixture carries the four corpus
// spellings of S000005377 and exactly one of them is load-bearing: loaded alone,
//
//	0001084380	S000005377	2020 Fund	20060630	000108/1084380/0001144204-06-035817.txt
//
// reproduces the promotion, and each of `Lifecycle 2020 Fund`,
// `TIAA-CREF Lifecycle 2020 Fund` and `Nuveen Lifecycle 2020 Fund` loaded alone
// does not. With the filing's own header declaration and no dictionary at all
// the fragment resolves to nothing and the banner stands -- so, as in family
// MISLINK18 and MISLINK21, RESOLUTION is what decides that this line is a
// heading, which is the thing that cannot be allowed to decide it.
//
// THE CUT. The fixture keeps proposals 23-24 of the first Atlas Copco block and
// then jumps to that block's closing rule, so the `2020` tail sits a blank line
// above the rule. That adjacency is the filing's own and is not an artefact of
// the cut: source lines 22090-22092 print `2020`, a blank line and the rule,
// verbatim, which is how the 42,179 rows below arise in the whole filing.
//
// The SERIES stamp is not wrong here: these rows really are inside the Lifecycle
// 2020 Fund's section, and S000005377 is that fund. This is a `fund_name` and
// `vote_description` defect, not a wrong link key.
//
// Fix location: `layout_icr.go`, `parseICR`. The underscore-rule branch at :527
// must refuse a line that is a continuation of the open proposal row -- the row
// the reader is still holding (`lastRow >= 0` and the line is `lastLine+1`, or a
// further continuation of it) -- before it is ever offered to the resolver, the
// same way family MISLINK18 refused an identity line as a banner in
// `layout_labelvalue.go`. The text must stay appended to the proposal instead,
// which means the continuation rule at :677 can no longer be gated on
// `!icrItem(cells[0])` alone: a single-cell line directly under the open row
// that the inverted-wrap branch could not turn into a row of its own is the
// row's tail, not a new item.
//
// This test asserts what the bytes say: every row of this fixture belongs to the
// banner the filing printed, and proposal 24 carries its full description.
func TestFamilyMislink21bICRWrappedProposalPromotedToFundBanner(t *testing.T) {
	rows := familyMislink21bDispatch(t, "tiaa_lifecycle2020_wrapped_proposal.txt", "tiaa_dict.tsv", "icr", 4)
	for _, r := range rows {
		if r.IssuerName != "Atlas Copco AB" {
			t.Fatalf("fixture issuer not read as printed: issuer=%q", r.IssuerName)
		}
		if r.FundName != "TIAA-CREF Lifecycle 2020 Fund" || r.SeriesID != "S000005377" {
			t.Errorf("a wrapped proposal continuation was promoted to the fund banner: fund=%q series=%q issuer=%q cusip=%q date=%q item=%q desc=%q want fund `TIAA-CREF Lifecycle 2020 Fund` and series S000005377, the banner this filing prints at source line 359159 and the series it declares at source lines 412-413; `2020` is the tail of proposal 24, printed at source line 475889",
				r.FundName, r.SeriesID, r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq, r.VoteDescription)
		}
		if r.ItemSeq == "24" && r.VoteDescription != "Personnel Option Plan 2020" {
			t.Errorf("a wrapped proposal lost its tail: item=%q desc=%q want `Personnel Option Plan 2020`, the two lines the filing prints at source 475888-475890 joined by a single space, as broadridge and issnpx join a wrap",
				r.ItemSeq, r.VoteDescription)
		}
	}
}
