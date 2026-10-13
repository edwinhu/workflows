package main

import (
	"path/filepath"
	"testing"
)

// familyMislink22Dispatch runs the real dispatch on a family MISLINK22 fixture
// with the named dictionary rows loaded (dict "" means no dictionary at all)
// and asserts the fixture's own preconditions -- status and layout -- so a
// failure below is an assertion about the rows and never a broken fixture.
func familyMislink22Dispatch(t *testing.T, fixture, dict, layout string) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	if dict == "" {
		cikDict = nil
	} else {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink22", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink22", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}
	if meta.CIK != "0000756913" || meta.PeriodOfReport != "20140630" {
		t.Fatalf("fixture/dispatch precondition: cik=%s period=%s", meta.CIK, meta.PeriodOfReport)
	}
	return rows
}

// familyMislink22BannerHolds asserts that no row carries the promoted comment
// line as its fund or its series, and that every row keeps the banner the
// filing actually printed over the section.
func familyMislink22BannerHolds(t *testing.T, rows []VoteRow, promoted, promotedSeries, wantFund, wantSeries string) {
	t.Helper()
	for i, r := range rows {
		if r.FundName == promoted || (promotedSeries != "" && r.SeriesID == promotedSeries) {
			t.Errorf("row %d (issuer=%q item=%q): fund_name=%q series_id=%q -- %q is the wrapped tail of a CMMT comment row, not a fund of this registrant; the section is headed %q (%q)",
				i+1, r.IssuerName, r.ItemSeq, r.FundName, r.SeriesID, promoted, wantFund, wantSeries)
		}
	}
	for i, r := range rows {
		if r.FundName != wantFund || r.SeriesID != wantSeries {
			t.Errorf("row %d (issuer=%q item=%q): fund_name=%q series_id=%q want %q / %q -- the enclosing fund banner",
				i+1, r.IssuerName, r.ItemSeq, r.FundName, r.SeriesID, wantFund, wantSeries)
		}
	}
}

// 000075/756913/0001438934-14-000466.txt (JOHN HANCOCK VARIABLE INSURANCE
// TRUST, CIK 756913, period 20140630, layout broadridge): verbatim source lines
// 1-1481 (the SGML header through the `<TABLE>`/`<S>` line), 210614-210652 (the
// fund banner, the whole of TAKAOKA TOKO's 27-Jun-2014 AGM and the four blanks
// that close it) and 212026-212138 (ACERINOX SA's 09-Jun-2014 OGM, ending on
// the CMMT row whose text wraps, the four blanks under it, the rule, and the
// whole of ACHILLES CORPORATION's 27-Jun-2014 AGM), closed with the document's
// own `</TABLE>` / `</TEXT>` / `</DOCUMENT>` / `</SEC-DOCUMENT>` tail. The
// eighty-two `<SERIES>` blocks are the filing's own, cut to
// `<SERIES-ID>`/`<SERIES-NAME>`: the declared set is the evidence the resolver
// reads, so a two-name header would change the answer rather than shorten the
// fixture. `Mutual Shares Trust` is the ONLY one of the eighty-two carrying the
// word `Shares`, which is the whole of why this defect resolves where it does.
//
// A FOURTH shape, and the one the MISLINK19 guards were not built for. The
// section is opened at source line 210614 by the banner this vendor prints at
// column 0 directly above a block rule:
//
//	2A57 International Small Company Trust
//
// which resolves to the declared `International Small Company Trust`,
// S000008301, and the meetings under it -- TAKAOKA TOKO, then a long run of
// foreign small-cap issuers -- are stamped correctly. Source lines 212091-212092
// are the LAST row of the ACERINOX meeting, and it is not a proposal at all:
//
//	CMMT   PLEASE NOTE MINIMUM QUANTITY FOR ATTENDANCE               Non-Voting
//	       1000 SHARES
//
// a two-line COMMENT row of item type `CMMT`, proposal type `Non-Voting`, with
// no vote cast and no For/Against Management cell. Four blank lines and the
// block rule follow, so collapseSpaces (html.go) shrinks the blanks and
// `1000 SHARES` arrives at brHeadingSlot's blank-crossed slot
// (layout_broadridge.go:490) looking exactly like a fund banner. It resolves --
// against the registrant's OWN declared `Mutual Shares Trust`, S000017253, the
// single declared name containing the token `Shares` -- and is adopted. Every
// row from there through the next real banner (source line 726215, `2CIV Mutual
// Shares Trust`) comes out under a US large-cap value fund that cast none of
// them: ACHILLES CORPORATION, ACINO HOLDING, and 1,994 further foreign issuers.
//
// None of the three existing guards fires on this shape, and the reason is the
// same in each case -- they are all written around a numbered Mgmt/Shr PROPOSAL
// row, and the anchor here is a Non-Voting comment.
//
//   - brProposalContinuationSlot (layout_broadridge.go:672) repeats
//     brHeadingSlot's blank walk, confirms the slot, and then climbs the unbroken
//     run above it -- the climb MISLINK19 added (commit 7b38e08d) for the
//     three-line INTER-BANK BOND MARKET wrap. The climb works: it reaches the
//     anchor `CMMT   PLEASE NOTE MINIMUM QUANTITY FOR ATTENDANCE   Non-Voting` on
//     its first step, and brSplitItem reads a non-empty item from it, because
//     brIsItemToken (:2003) returns true for the literal token `CMMT` (:2007). So
//     the walk STOPS there and hands its verdict to brVoteRowSlot -- which is
//     where it fails, below.
//
//   - brVoteRowSlot (:709) requires a proposal-type token (`mgmt`, `mgt`,
//     `management`, `shareholder`, `shr`, `shrholdr`) IMMEDIATELY FOLLOWED by a
//     vote token (`for`, `against`, `abstain`, `withheld`, `withhold`, `none`,
//     `split`). The anchor row carries neither: its type cell is `Non-Voting`,
//     which is not in that vocabulary, and no vote cell follows it at all --
//     brPeelColumns leaves how_voted blank on precisely these rows (:2042). The
//     guard therefore reports a complete, well-formed CMMT row as ordinary prose,
//     and `1000 SHARES` is handed to the blank-crossed branch. Adding `Shr` to
//     the vocabulary, which is what MISLINK19's second test bought, cannot help:
//     the missing half is the VOTE cell, which a Non-Voting row never prints.
//
//   - brContinuationRunLine (:614) would recognise the run, but it requires the
//     line to be the MIDDLE of it (`i+1` non-blank, :615). `1000 SHARES` is the
//     run's LAST line -- four blanks follow -- and it is refused by design,
//     because the run's last line is exactly where a real banner can stand.
//     brOpenProposalTail (:639) compares the slot against the open row's last
//     text line, and the CMMT row has already been closed by the time the rule
//     is read.
//
// Measured on the whole filing (real dispatch, cik_series.tsv loaded): 23,866
// rows across 1,996 distinct foreign issuers carry
// fund_name=`1000 SHARES` / series_id=S000017253. A wrong series is worse than
// a blank one, and these are implausible holdings for a US large-cap value fund.
//
// Recommended fix, layout_broadridge.go, brVoteRowSlot (:709) or a sibling of
// it: the grammar's signature for a COMMENT row is the item token `CMMT` (or a
// `Non-Voting` type cell) rather than a type/vote pair, so the anchor test
// brProposalContinuationSlot performs must accept a Non-Voting comment row as an
// anchor exactly as it accepts a numbered vote row. The tail of a CMMT row is
// never a fund banner.
func TestFamilyMislink22JHVITCMMTTailPromotedToFund(t *testing.T) {
	rows := familyMislink22Dispatch(t, "jhvit2014_cmmt_1000shares_wrap.txt", "", "broadridge")
	familyMislink22BannerHolds(t, rows,
		"1000 SHARES", "S000017253",
		"2A57 International Small Company Trust", "S000008301")
}
