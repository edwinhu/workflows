package main

import (
	"path/filepath"
	"testing"
)

// familyGGG3Dispatch runs the real dispatch on a family GGG3 fixture, loading
// the registrant's own cik_series.tsv rows as the dictionary when one is named.
func familyGGG3Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ggg3", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ggg3", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000091/911637/0000950135-04-004248.txt: 12-13, 15-18, 25-26, 54-60, 105-118,
// 3118-3153. MFS Series Trust XI's 2004 N-PX declares no series in its header;
// the dictionary holds three rows for CIK 0000911637 over two ids, including
//
//	0000911637	S000002500	MFS Union Standard Equity Fund	20060630
//
// The filing opens on the ISS `=`-ruled banner grammar and is dispatched to
// issnpx on it. The precondition of this test is that FIVE rows are emitted:
// one from the `MFS MID-CAP VALUE FUND` banner section that is in the cut to
// hold the dispatch on issnpx, plus the four printed items of the Broadridge
// tail below. On a tree that does not read the tail only the first of those is
// emitted, so the precondition itself is red before the fix.
//
// At line 3120 the filer agent switches grammars mid-document to a bare,
// unruled fund line over Broadridge meeting blocks:
//
//	MFS Union Standard Equity Fund
//
//	<TABLE>
//	3M COMPANY                                                           MMM                   ANNUAL MEETING DATE: 05/11/2004
//	ISSUER: 88579Y101     CITY:                                                                HOLDINGS RECONCILIATION DATE: 03/12/2004
//
// 52 issuers follow. A full-file dispatch on the current tree emits 1,108 rows
// -- 975 under `MFS MID-CAP VALUE FUND` (S000002499) and 133 under
// `VERTEX INTERNATIONAL FUND` (blank) -- and not one row carries S000002500 or
// names 3M. The tail is not mis-attributed; it is absent.
//
// The tail's proposal table is the Broadridge family's shape with a column
// header this parser does not claim, and the header is the whole defect:
//
//	                                           Mgt
//	Proposal Number          Vote Cast         Rec    Proposal
//
// TWO things are wrong with reading that by POSITION. First, its item column
// opens with the word `Proposal`, which brItemFirstWords (layout_broadridge.go)
// deliberately does not carry, so brColumnHeader returns false and
// matchBroadridge never claims the shape. Second, and the reason a positional
// reader must not simply be widened to admit it: this header TRANSPOSES the two
// vote columns relative to every spelling brColumnHeader does claim. The
// canonical Broadridge order is
//
//	Prop.#  Proposal  Proposal Type  Proposal Vote  For/Against Management
//
// -- proposal text, then type, then the fund's vote. Here the fund's vote
// (`Vote Cast`) comes FIRST, the management recommendation (`Mgt`/`Rec`, spilled
// over two physical lines) SECOND, and the proposal text LAST. A reader keyed on
// column position would emit every row of this tail with how_voted and
// management_recommendation swapped, which is strictly worse than the blank the
// filing gets today: item 03 votes `Against` a recommendation of `For`, and item
// 04 votes `For` against a recommendation of `Against`, so the swap silently
// inverts the two rows that carry the whole signal of the section.
//
// The assertion below is therefore on the VALUES the header's own cell text
// selects, not on an ordinal: how_voted is whatever sits under the cell that
// reads `Vote Cast`, verbatim.
//
//	01                                   For    ELECTION OF DIRECTORS
//	                   Withheld                 EDWARD A. BRENNAN
//	02                    For            For    RATIFY APPOINTMENT OF INDEPENDENT AUDITORS
//	03                  Against          For    APPROVE AUTHORIZED COMMON STOCK INCREASE
//	04                    For          Against  S/H PROPOSAL - CORPORATE GOVERNANCE
//
// Fix in layout_broadridge.go: brColumnHeader must admit the bare `Proposal
// Number` item column, and brPeelColumns must be driven by a COLUMN MAP built
// from the header's cell TEXT -- `Vote Cast` -> how_voted, `Mgt Rec` (including
// the `Mgt` spill line above `Rec`) -> management_recommendation, `Proposal` ->
// the description -- rather than by the fixed right-to-left peel order the
// canonical spellings happen to share. parseISSNPX (layout_issnpx.go) must hand
// the remainder of the body to parseBroadridge at the grammar switch for that
// reader to ever see these bytes.
func TestFamilyGGG3MFSUnionStandardTailTransposedVoteColumns(t *testing.T) {
	rows := familyGGG3Dispatch(t, "mfs_union_standard_tail.txt", "mfs_dict.tsv", "issnpx", 5)
	// item -> the value the header's `Vote Cast` column prints, verbatim.
	want := map[string]string{"02": "For", "03": "Against", "04": "For"}
	got := map[string]string{}
	for _, r := range rows {
		if r.SeriesID == "S000002500" {
			got[r.ItemSeq] = r.HowVoted
		}
	}
	for item, howVoted := range want {
		if got[item] != howVoted {
			t.Errorf("`MFS Union Standard Equity Fund` Broadridge tail, item %s: series=S000002500 how_voted=%q want %q (of %d emitted rows, %d carry S000002500)", item, got[item], howVoted, len(rows), len(got))
		}
	}
}
