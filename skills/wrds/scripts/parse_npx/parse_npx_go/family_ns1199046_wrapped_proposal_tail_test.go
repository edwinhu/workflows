package main

import (
	"path/filepath"
	"strings"
	"testing"
)

const ns1199046WrappedTailDir = "family_ns1199046_wrapped_proposal_tail_banner"

// ns1199046WrappedTailDispatch runs the real dispatch on a fixture in this
// family's testdata dir under PRODUCTION resolution -- the corpus dictionary and
// series overlay are left exactly as the binary holds them, not nilled out, so
// the series id asserted below is whatever production would emit for this file.
// The filing's own <SERIES-AND-CLASSES-CONTRACTS-DATA> header dictionary is read
// by processFile regardless and is separate from either overlay. Same mechanism
// as ns1342947MondrianDispatch, pointed at its own testdata dir.
func ns1199046WrappedTailDispatch(t *testing.T, fixture, layout string) (FilingMeta, []VoteRow) {
	t.Helper()
	ch := make(chan *ParseResult, 8192)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1199046WrappedTailDir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s want status=ok layout=%s error=%s", meta.ParseStatus, meta.Layout, layout, meta.ErrorMsg)
	}
	return meta, rows
}

// ns1199046DukeAgenda is the DUKE ENERGY CORP. annual-meeting director slate this
// filing prints under the same masthead as the CANETIC block, item text verbatim
// off the fixture, in printed order. This block already reads correctly on HEAD
// and is asserted below only as a regression guard.
var ns1199046DukeAgenda = []string{
	"Elect Director William Barnet, III",
	"Elect Director G. Alex Bernhardt, Sr.",
	"Elect Director Michael G. Browning",
	"Elect Director Daniel R. DiMicco",
	"Elect Director Ann Maynard Gray",
}

// UNIFIED SERIES TRUST, CIK 1199046, period 20080630, filing
// 000119/1199046/0001035449-08-000455.txt (`htmltable`). The top-ranked open
// family in the current no-series-id residue ranking (386 known-registrant
// no_series rows).
//
// MEASURED on this fixture through the real dispatch on HEAD, production
// resolution: status=ok layout=htmltable rows=5 -- and all five are DUKE ENERGY
// CORP. The CANETIC RESOURCES TRUST meeting's single ballot row is emitted
// nowhere at all; it is DROPPED, not corrupted.
//
// THE SHAPE. The fixture carries ONE fund masthead ("Quarterly Report of Proxy
// Voting Record Fund/Fund Family Name: IMS Strategic Income Fund", source line
// 421) covering TWO issuer/meeting blocks. The first is CANETIC RESOURCES TRUST
// (Ticker CNE.U, Security ID 137513107, Meeting Date JAN 9, 2008, Meeting Type
// Special, Record Date NOV 30, 2007) with exactly ONE proposal, and that
// proposal's description is SPLIT ACROSS TWO SEPARATE <table> ELEMENTS:
//
//   - the first table (source lines 519-541) holds the whole ballot row -- `1` |
//     `Approve Plan of Arrangement Penn West` | Mgt Rec `For` | Vote Cast `For` |
//     Sponsor `Management`
//   - that table then CLOSES, and a second, standalone one-column table (source
//     lines 545-555) holds only `Energy Trust` -- the wrapped TAIL of the same
//     proposal description, carrying no vote, no sponsor and no item number
//
// The full proposal is `Approve Plan of Arrangement Penn West Energy Trust`. The
// EDGAR Ease Plus generator that produced this document laid each printed line of
// a wrapped cell out as its own <table>, so the continuation is a sibling
// element rather than a sibling row inside the ballot's own table.
//
// THE DEFECT is that the CANETIC block produces no row whatsoever. The second
// block, DUKE ENERGY CORP. (Ticker DUK, Security ID 26441C105, Meeting Date MAY
// 8, 2008, five director-election ballots, none wrapped), is a plain
// one-table-per-ballot shape and reads correctly on HEAD -- issuer, cusip,
// meeting date, vote and series all right. So the fix is confined to whatever
// makes a ballot table followed by a bare continuation table unreadable; it must
// not reach the ordinary shape.
//
// ON THE SERIES ID. The filing's own header declares
// `<SERIES-ID>S000000524` / `<SERIES-NAME>IMS STRATEGIC INCOME FUND` at source
// lines 79-88, sitting between S000000523 (IMS STRATEGIC ALLOCATION FUND) and
// S000000525 (MARATHON VALUE PORTFOLIO). The masthead names that fund exactly,
// and the DUKE rows already carry S000000524 on HEAD -- so the CANETIC row must
// carry it too. Series resolution is NOT part of this defect and a fix that
// changes it has broken something else.
//
// ON THE VOTE DESCRIPTION. The assertion is deliberately a Contains pair rather
// than an exact string: whether the recovered text reads `Approve Plan of
// Arrangement Penn West Energy Trust` (space-joined) or carries some other join
// of the two printed lines is a choice the fix gets to make, but BOTH halves
// must survive. A row that keeps only `Approve Plan of Arrangement Penn West`
// has silently truncated the proposal.
//
// FIXTURE PROVENANCE. unified_canetic_penn_west_energy_trust_2008.txt is real SEC
// EDGAR bytes, accession 0001035449-08-000455, CIK 1199046, period 20080630 --
// extracted by a prior iteration of this family and not created here.
//
// No production code is changed here.
func TestFamilyNS1199046WrappedProposalTailBanner(t *testing.T) {
	// OBSERVED ON HEAD (production resolution, no dict/overlay nilling): status=ok
	// layout=htmltable rows=5, all five DUKE ENERGY CORP. -- the CANETIC/Penn West
	// row is dropped entirely, not emitted with a corrupted issuer/proposal/fund.
	_, rows := ns1199046WrappedTailDispatch(t, "unified_canetic_penn_west_energy_trust_2008.txt", "htmltable")

	const (
		canSeries = "S000000524"
		canIssuer = "CANETIC RESOURCES TRUST"
		canCUSIP  = "137513107"
		canDate   = "20080109"
		canHead   = "Penn West"
		canTail   = "Energy Trust"
	)

	// The claim. The CANETIC RESOURCES TRUST meeting's one ballot must be emitted,
	// with the identity the filing prints for it and with BOTH printed lines of its
	// wrapped proposal description.
	var canetic []VoteRow
	for _, r := range rows {
		if r.IssuerName == canIssuer {
			canetic = append(canetic, r)
		}
	}
	if len(canetic) != 1 {
		t.Errorf("the CANETIC RESOURCES TRUST block emitted %d rows, want exactly 1: its single ballot's proposal description is split across two sibling <table> elements (source lines 519-541 and 545-555) and the block produces no row at all on HEAD",
			len(canetic))
	}
	for i, r := range canetic {
		if r.MeetingDate != canDate {
			t.Errorf("canetic row %d: meeting date=%q want %q, the `Meeting Date: JAN 9, 2008` this filing prints at source line 468",
				i+1, r.MeetingDate, canDate)
		}
		if r.CUSIP != canCUSIP {
			t.Errorf("canetic row %d: cusip=%q want %q, the `Security ID: 137513107` this filing prints at source line 458",
				i+1, r.CUSIP, canCUSIP)
		}
		if !strings.Contains(r.VoteDescription, canHead) || !strings.Contains(r.VoteDescription, canTail) {
			t.Errorf("canetic row %d: the wrapped proposal tail was not joined to its own ballot row: desc=%q must contain both %q (source line 526) and %q (source line 552) -- the full proposal is `Approve Plan of Arrangement Penn West Energy Trust`",
				i+1, r.VoteDescription, canHead, canTail)
		}
		if r.HowVoted != "For" {
			t.Errorf("canetic row %d: how_voted=%q want %q, the Vote Cast cell this filing prints at source line 534",
				i+1, r.HowVoted, "For")
		}
		if r.SeriesID != canSeries {
			t.Errorf("canetic row %d: series=%q fund=%q want series %q -- the masthead at source line 421 names IMS Strategic Income Fund, which this filing's own header declares as S000000524 at source lines 81-82",
				i+1, r.SeriesID, r.FundName, canSeries)
		}
	}

	// Regression guard. The DUKE ENERGY CORP. block already reads correctly on HEAD
	// -- a fix that recovers the CANETIC row by disturbing the ordinary
	// one-table-per-ballot shape has traded one defect for another.
	seen := map[string]int{}
	for i, r := range rows {
		if r.IssuerName != "DUKE ENERGY CORP." {
			continue
		}
		seen[r.VoteDescription]++
		if r.CUSIP != "26441C105" || r.MeetingDate != "20080508" || r.HowVoted != "For" || r.SeriesID != canSeries {
			t.Errorf("row %d: the DUKE ENERGY CORP. block regressed: issuer=%q cusip=%q date=%q vote=%q series=%q desc=%q; want cusip=26441C105 date=20080508 vote=For series=%s",
				i+1, r.IssuerName, r.CUSIP, r.MeetingDate, r.HowVoted, r.SeriesID, r.VoteDescription, canSeries)
		}
	}
	for _, item := range ns1199046DukeAgenda {
		if seen[item] != 1 {
			t.Errorf("the DUKE ENERGY CORP. block regressed: item %q emitted %d rows, want exactly 1", item, seen[item])
		}
	}
	if len(seen) != len(ns1199046DukeAgenda) {
		t.Errorf("the DUKE ENERGY CORP. block regressed: %d of its %d printed items emitted a row", len(seen), len(ns1199046DukeAgenda))
	}
}
