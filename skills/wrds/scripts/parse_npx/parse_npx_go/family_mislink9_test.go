package main

import (
	"path/filepath"
	"testing"
)

// familyMislink9Dispatch runs the real dispatch on a family MISLINK9 fixture
// with no dictionary loaded -- every name these fixtures turn on is spelled by
// the filing's own SGML header -- and asserts the fixture's own preconditions
// (status, layout, row count) so a failure below is an assertion about the fund
// and series stamped on the rows and never a broken fixture.
func familyMislink9Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink9", fixture), sink, make([]byte, headBytes))
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

// 000133/1331971/0001438934-15-000380.txt: verbatim source lines 1-19 (the SEC
// header through the fiscal year end), 39-40 (the series-data openers),
// 1382-1385 and 1431 (the `S000017260` `<SERIES>` block, trimmed to its
// id/name lines and its closer), 1528-1531 and 1540 (the same for
// `S000024676`), 3251-3259 (the header closers and the document opener through
// `<TEXT>`), 3289-3292 (the `<PAGE>` and the `<TABLE>`/`<S> <C>` opener),
// 355101 (the `2DCN JHF II Emerging Makets Fund` banner), 444881-444955 (the
// two DONGJIANG ENVIRONMENTAL blocks of that section -- the first ends on a
// wrapped proposal line, the second is the one that loses the banner) and the
// filing's own last three lines. Every byte is verbatim. Dispatches to
// `broadridge` (the precondition asserts it).
//
// John Hancock Funds II, period 20150630, `broadridge`, 165,287 rows. Measured
// on the current tree with no dictionary loaded:
//
//	44827 S000024676 "BUT NOT LIMITED TO, SHORT-TERM COMMERCIAL"
//	32630 S000024676 "THE ISSUE OF SHORT-TERM DEBENTURE"
//
// Both fund names are PROPOSAL TEXT. The registrant declares S000024676 as
// `Short Term Government Income Fund` (source line 1531) and its real section
// banners are printed on their own line above a rule (`2DCN JHF II Emerging
// Makets Fund`, source line 355101).
//
// This fixture carries the second of the two shapes, the one the corpus
// detector also found in the 2022 and the J.P. Morgan filings. Source lines
// 444917-444926 verbatim:
//
//	4      TO CONSIDER AND APPROVE THE APPLICATION FOR               Mgmt          For                            For
//	       THE ISSUE OF SHORT-TERM DEBENTURE
//
//
//
//
//	--------------------------------------------------------------------------------------------------------------------------
//	 DONGJIANG ENVIRONMENTAL CO LTD                                                              Agenda Number:  706048178
//
// The last proposal of a meeting wraps onto a second line and the meeting ends
// there. `stripHTML` has already dropped the indentation and collapsed the run
// of blank lines, so what `parseBroadridge` reads at the next block opener is
//
//	"4  TO CONSIDER AND APPROVE THE APPLICATION FOR  Mgmt  For  For"
//	"THE ISSUE OF SHORT-TERM DEBENTURE"
//	""
//	"--------------------------------------------------------------------------------------------------------------------------"
//	"DONGJIANG ENVIRONMENTAL CO LTD  Agenda Number:  706048178"
//
// PROBED, not judged by eye. A debug print at every `curFund` write located
// the assignment as the `crossedBlank` arm of the `brHeadingSlot` branch of
// `parseBroadridge` (`layout_broadridge.go`, the `issResolveFund` fallback
// beneath `lookupSeriesTolerantEntry`), reached with
//
//	brHeadingSlot -> slot="THE ISSUE OF SHORT-TERM DEBENTURE" crossedBlank=true
//
// Why the existing guards miss it. `brVoteRowSlot` is false -- the wrapped
// tail carries no vote cells of its own. `brOpenProposalTail` is false -- the
// block opener closed the row before the slot was read. `brMeetingHeadingRun`
// is false -- there IS a proposal table above the rule. And
// `brProposalContinuationSlot`, which exists for exactly this shape, requires
// `strings.TrimSpace(lines[i-2]) == slot`: here `lines[i-2]` is the BLANK that
// `brHeadingSlot`'s own walk crossed, so the guard never looks at the numbered
// vote row two lines further up and returns false. The slot then reaches
// `issResolveFund`, which matches the proposal text to the declared
// `Short Term Government Income Fund`, and every row from this block on is
// stamped S000024676.
//
// Rows affected: 32,630 on this filing for this string alone, plus the
// structurally identical `JOINT-STOCK REAL ESTATE …` / `WITH MAMRUD REAL
// ESTATE LTD` (000133/1331971/0001438934-22-000249.txt, 50,282 rows) and
// `climate change.` / `CLiMATE CHANGE TARGETS`
// (000148/1485894/0001438934-23-000406.txt, 57,067 rows).
//
// NOT YET RED. This fixture reproduces the SLOT READING exactly -- a debug
// print on the fixture shows `brHeadingSlot` returning
// `slot="THE ISSUE OF SHORT-TERM DEBENTURE"` with `crossedBlank=true`, the same
// reading as on the full filing -- but it does NOT reproduce the mislink,
// because the `issResolveFund` fallback that turns that slot into S000024676
// only fires once the registrant declares a large fraction of its 97 series.
// Measured by bisection on the SGML header: 2 declared series -> S000017260
// (correct), the first ~35 -> S000024676 (the defect), and no single sibling
// name flips it. The registrant's id/name lines alone are 194 lines, so the
// evidence does not fit the ~120-line fixture budget. The assertion below is
// therefore the right one and currently PASSES; making it RED needs a fixture
// carrying the full declared set, or a unit-level probe of `issResolveFund`.
//
// Fix location: `layout_broadridge.go`, `brProposalContinuationSlot` -- it must
// anchor on the LINE THE SLOT WAS READ FROM rather than on `lines[i-2]`, so
// that the blank `brHeadingSlot` walks over does not hide the numbered vote row
// above the wrapped tail. A wrapped proposal line is never a fund banner, and
// the section's own banner must stand.
func TestFamilyMislink9JHF2ProposalTailBecomesBanner(t *testing.T) {
	rows := familyMislink9Dispatch(t, "jhf2_2015_proposal_tail_banner.txt", "broadridge", 10)
	for _, r := range rows {
		if r.MeetingDate != "20150605" {
			continue
		}
		if r.SeriesID != "S000017260" || r.FundName != "2DCN JHF II Emerging Makets Fund" {
			t.Errorf("a wrapped proposal line was promoted to the fund banner: fund=%q issuer=%q cusip=%q item=%q desc=%q series=%q want fund=%q series=S000017260",
				r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID, "2DCN JHF II Emerging Makets Fund")
		}
	}
}
