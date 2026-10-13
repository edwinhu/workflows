package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// familyGGG4Dispatch runs the real dispatch on a family GGG4 fixture, loading
// the registrant's own cik_series.tsv rows as the dictionary. The precondition
// is only that the filing parses, is claimed by the named layout, and reaches
// the Broadridge tail at all -- the row COUNT is deliberately not pinned,
// because the nominee lines this test also asserts change it.
func familyGGG4Dispatch(t *testing.T, fixture, dict, layout, tailSeries string) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ggg4", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ggg4", fixture), sink, make([]byte, headBytes))
	tail := 0
	for _, r := range sink.buf {
		if r.SeriesID == tailSeries {
			tail++
		}
	}
	if meta.ParseStatus != "ok" || meta.Layout != layout || tail < 4 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d tail(%s)=%d want>=4 error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), tailSeries, tail, meta.ErrorMsg)
	}
	return sink.buf
}

// 000091/911637/0000950135-04-004248.txt: 12-13, 15-18, 25-26, 54-60, 105-118,
// 3118-3153, verbatim. MFS Series Trust XI's 2004 N-PX opens on the ISS
// `=`-ruled banner grammar and is dispatched to issnpx on it; at line 3120 the
// filer agent switches to a bare fund line over Broadridge meeting blocks, and
// parseISSNPX hands the remainder to parseBroadridge (family GGG3). This test is
// about the IDENTITY of the meeting that tail reports, which the hand-over route
// reads from the wrong line.
//
// Every field the meeting block prints is in the bytes, in a block framed by two
// dashed rules above the proposal table:
//
//   - -------------------------------------------------------------…
//     3M COMPANY                                       MMM             ANNUAL MEETING DATE: 05/11/2004
//     ISSUER: 88579Y101     CITY:                                      HOLDINGS RECONCILIATION DATE: 03/12/2004
//     ISIN:                 COUNTRY: UNITED STATES                     VOTE DEADLINE DATE: 05/11/2004
//   - -------------------------------------------------------------…
//
// Measured on the current tree, none of it reaches a row: all four tail items
// carry `issuer_name = "VOTE GROUP: GLOBAL"` with an empty cusip, ticker and
// meeting date. That name is the free-standing line BELOW the block:
//
//	VOTE GROUP: GLOBAL
//	AGENDA: 932124186 -MANAGEMENT
//
// The three lines of the block each miss the identity reader for a different
// reason, all in layout_broadridge.go:
//
//   - `3M COMPANY … MMM … ANNUAL MEETING DATE: 05/11/2004` -- brFindLabels
//     returns nil for it. `MEETING DATE` is its only label hit and it does not
//     open the line, and the rule that a label BLOCK begins with a label
//     requires TWO colon-terminated labels before it will accept a leading
//     name. The line therefore falls to the item-outside-a-table branch
//     (brSplitItem reads `3M` as an item token) and becomes pendingIssuer --
//     name, ticker and meeting date all discarded together.
//   - `ISSUER: 88579Y101  CITY: …` -- the security id is printed under the label
//     word `ISSUER`, which is not in brLabels at all, so the only hit is `CITY`
//     at a non-zero offset and brFindLabels again returns nil. The CUSIP is
//     dropped even though `SECURITY ID`/`CUSIP` handling exists one switch away.
//   - `ISIN: … COUNTRY: …` -- two labels, one leading, so this line DOES open a
//     block; it promotes pendingIssuer into issuer and sets an empty ISIN.
//
// The `AGENDA: 932124186 -MANAGEMENT` line then opens a block of its own, and
// the pendingIssuer it promotes (parseBroadridge, the brFindLabels branch) is by
// then the free-standing `VOTE GROUP: GLOBAL`. So the rows do not merely lose
// the issuer: they carry a vote-group label in the issuer slot, which is worse
// than a blank, and no key at all for the meeting.
//
// The nominee lines under item 01 ARE printed as vote rows -- each carries a
// vote of its own in the `Vote Cast` column and a name in the `Proposal`
// column -- so they are asserted here as rows:
//
//	01                                   For    ELECTION OF DIRECTORS
//	                   Withheld                 EDWARD A. BRENNAN
//	                      For                   MICHAEL L. ESKEW
//
// Fix in layout_broadridge.go, parseBroadridge: read this vintage's rule-framed
// identity block as a unit (a recogniser beside brIdentityColumnHeader), taking
// the issuer name, ticker and `<QUALIFIER> MEETING DATE:` from its first line
// and routing an `ISSUER:` value that brLooksLikeSecurityID accepts to the cusip
// rather than the issuer name, and clearing pendingIssuer when it fires so the
// `AGENDA:` line below cannot promote `VOTE GROUP: GLOBAL` into the issuer slot.
func TestFamilyGGG4MFSUnionStandard3MIdentityBlock(t *testing.T) {
	rows := familyGGG4Dispatch(t, "mfs_union_standard_3m_block.txt", "mfs_dict.tsv", "issnpx", "S000002500")

	for _, r := range rows {
		up := strings.ToUpper(r.IssuerName)
		if strings.Contains(up, "VOTE GROUP") || strings.Contains(up, "AGENDA") {
			t.Errorf("item %s: issuer_name=%q is the filing's vote-group/agenda furniture, not an issuer", r.ItemSeq, r.IssuerName)
		}
	}

	for _, r := range rows {
		if r.SeriesID != "S000002500" {
			continue
		}
		if r.IssuerName != "3M COMPANY" {
			t.Errorf("item %s: issuer_name=%q want %q (printed above the proposal table)", r.ItemSeq, r.IssuerName, "3M COMPANY")
		}
		if r.CUSIP != "88579Y101" {
			t.Errorf("item %s: cusip=%q want %q (printed as `ISSUER: 88579Y101`)", r.ItemSeq, r.CUSIP, "88579Y101")
		}
		if r.MeetingDate != "20040511" {
			t.Errorf("item %s: meeting_date=%q want %q (printed as `ANNUAL MEETING DATE: 05/11/2004`)", r.ItemSeq, r.MeetingDate, "20040511")
		}
	}

	// The four nominees of item 01's slate, each printed with its own vote.
	nominees := map[string]string{
		"EDWARD A. BRENNAN":      "Withheld",
		"MICHAEL L. ESKEW":       "For",
		"W. JAMES MCNERNEY, JR.": "For",
		"KEVIN W. SHARER":        "Withheld",
	}
	for name, vote := range nominees {
		found := false
		for _, r := range rows {
			if strings.Contains(strings.ToUpper(r.VoteDescription), name) {
				found = true
				if r.HowVoted != vote {
					t.Errorf("nominee %q: how_voted=%q want %q", name, r.HowVoted, vote)
				}
			}
		}
		if !found {
			t.Errorf("nominee %q: no row emitted; the bytes print it as a vote row under item 01 (of %d rows emitted)", name, len(rows))
		}
	}
}
