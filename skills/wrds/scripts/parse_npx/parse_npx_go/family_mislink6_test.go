package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// familyMislink6Dispatch runs the real dispatch on a family MISLINK6 fixture
// with the named dictionary rows loaded (dict "" means no dictionary at all)
// and asserts the fixture's own preconditions -- status and layout -- so a
// failure below is an assertion about the rows and never a broken fixture. The
// row COUNT is deliberately not a precondition: both defects below are defects
// of WHICH rows exist, so pinning the count would turn the fix into a fixture
// error.
func familyMislink6Dispatch(t *testing.T, fixture, dict, layout string) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	if dict == "" {
		cikDict = nil
	} else {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink6", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink6", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}
	return rows
}

// 000110/1105128/0000948221-04-000353.txt (UMB Scout Funds, CIK 1105128,
// period 20040630): verbatim source lines 11-29, 51-56, 86-118, 124-145 and
// 12421-12452, then one `</TABLE>` copied verbatim from source line 13138 to
// close the table the line-range cut opened (the only bytes in the fixture that
// do not stand where the source prints them), then the filing's own last four
// lines. Source lines 119-123 and 146-149 (the two Equity Index blocks' `Account
// Name` / `Custodian Account` sub-tables) and 12453-12456 (the Helen of Troy
// block's) are the only bytes dropped from inside those ranges: the layout
// emits them as furniture rows whose how_voted reads `Shares` and a share
// count, which TestHowVotedVocabularyInvariant rightly refuses in testdata.
//
// The filing opens FOUR `Selected Accounts:` sections -- source lines 94
// (`Scout Equity Index`), 12427 (`Scout Small Cap Fund`), 13144 (`Scout Tech
// Fund`) and 13823 (`Scout Energy`) -- and the real dispatch on the whole
// filing emits THREE funds and 3,867 rows:
//
//	3486 fund="Scout Equity Index"  rows 0-3485
//	 188 fund="Scout Tech Fund"     rows 3486-3673
//	 193 fund="Scout Energy"        rows 3674-3866
//
// Row 3485 is WELLPOINT HEALTH NETWORKS INC. `APPROVE MERGER AGREEMENT`, which
// is the LAST block of section 1 (source lines 12404-12419), and row 3486 is
// the first block of section 3. The `Scout Small Cap Fund` section -- source
// lines 12429-13138, 710 lines carrying at least 57 printed proposal lines --
// therefore emits NOTHING AT ALL. It is not mis-stamped onto another fund: it
// is dropped.
//
// WHY, measured on the bytes. `Selected Accounts: Scout Small Cap Fund` IS read
// -- spReadContext (layout_splittable.go:940) folds it into ctx.fund like every
// other section banner. What fails is one table down. Source lines 12440-12443,
// verbatim:
//
//	VOTE GROUP: GLOBAL
//	<S>    <C>                         <C>                     <C>           <C>           <C>
//	Proposal                                                     Proposal        Vote        Against
//	Number  Proposal                                             Type            Cast         Mgmt.
//
// There is no blank line between the SGML `<S> <C>` type line and the stacked
// column labels. spTrailingBlock (layout_splittable.go:980) cuts the label
// block at a BLANK line and nothing else, so it hands spHeaderSpans all four
// lines instead of the two label lines, the `<C>` runs merge into the label
// spans, and spLabels returns columns that carry the type line's text:
//
//	col0 "VOTE GROUP: GLOBAL <S> <C> PROPOSAL NUMBER PROPOSAL" role=""
//	col1 "<C>"                                                role=""
//	col2 "<C> PROPOSAL TYPE"                                  role=""
//	col3 "<C>"                                                role=""
//	col4 "VOTE CAST"                                          role="vote"
//	col5 "<C> AGAINST MGMT."                                  role=""
//
// spHasVote is satisfied by col4, so the table OPENS on those labels -- and
// from that point the whole `<TABLE>`, which runs to source line 13138 and
// carries every later issuer block of the section as body, is read on a
// geometry with no item and no description column. spGroupRows returns zero
// rows for it. The same section read with a blank line in that position
// (section 3, source lines 13157-13160) yields the clean four-column geometry
// `PROPOSAL NUMBER / PROPOSAL / PROPOSAL TYPE / VOTE CAST` and emits its rows.
//
// Fix in layout_splittable.go, spTrailingBlock (or the plain-rule branch of
// parseSplitTableRaw that calls it, layout_splittable.go:391): the label block
// must end at the SGML type line -- spTypeLine already recognises it as
// furniture, but only AFTER haveRule -- and at a `Vote Group:` line, not only
// at a blank line.
//
// Rows affected: every row of the section. 0 emitted against a 710-line section
// printing at least 57 proposal lines; the comparable 671-line Tech section
// emits 188.
func TestFamilyMislink6ScoutSmallCapSectionDropped(t *testing.T) {
	rows := familyMislink6Dispatch(t, "umb_scout_small_cap_section.txt", "umb_scout_dict.tsv", "splittable")
	// The Equity Index section's own rows are the stable half of the fixture.
	var equity int
	for _, r := range rows {
		if r.FundName == "Scout Equity Index" {
			equity++
		}
	}
	if equity != 9 {
		t.Fatalf("fixture precondition: Scout Equity Index rows=%d want 9 (rows=%d)", equity, len(rows))
	}
	// The Helen of Troy block, source lines 12445-12451, under the section
	// banner `Selected Accounts: Scout Small Cap Fund` (source line 12427).
	want := []string{
		"ELECTION OF DIRECTORS",
		"AMEND OMNIBUS STOCK OPTION PLAN",
		"AMEND OMNIBUS STOCK OPTION PLAN",
		"RATIFY APPOINTMENT OF INDEPENDENT AUDITORS",
	}
	var got []string
	for _, r := range rows {
		if r.FundName != "Scout Small Cap Fund" {
			continue
		}
		got = append(got, r.VoteDescription)
		if r.SeriesID != "S000007704" {
			t.Errorf("Small Cap row carries series %q, want S000007704 (the registrant's own `UMB SCOUT SMALL CAP FUND` / `Scout Small Cap Fund` rows): desc=%.40q", r.SeriesID, r.VoteDescription)
		}
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("the whole `Selected Accounts: Scout Small Cap Fund` section is dropped: rows under fund=\"Scout Small Cap Fund\" = %q, want %q (the Helen of Troy block, source lines 12445-12451). The section's <TABLE> opens on a label block that swallowed the `<S> <C>` type line, so it carries no item and no description column and spGroupRows returns nothing for it", got, want)
	}
}

// 000008/88051/0000088053-05-000935.txt (Value Equity Trust, CIK 88051, period
// 20050630): verbatim source lines 11-28, 61-67 and 130-187, then one
// `</TABLE>` copied verbatim from source line 6986 to close the table the
// line-range cut opened (the only bytes in the fixture that do not stand where
// the source prints them), then the filing's own last four lines. No
// dictionary is loaded: the assertions below are about the issuer and the
// meeting date, which the filing prints itself and no dictionary touches.
//
// Every issuer block after the first is read as TABLE BODY. The block
// delimiter is a rule line, the issuer name, `Issuer:` / `ISIN:` / `SEDOL:`,
// and a second rule line, with NO `<TABLE>` between blocks -- source lines
// 166-176, verbatim:
//
//   - ------------------------------------------------------------------ ... ---
//     CONAGRA FOODS, INC.                            CAG      Annual Meeting Date: 09/23/2004
//     Issuer: 205887                          ISIN:
//     SEDOL:
//
//   - ------------------------------------------------------------------ ... ---
//
//     Vote Group: UNASSIGNED
//
//     Proposal                                             Proposal        Vote          Against
//     Number   Proposal                                      Type          Cast           Mgmt.
//
//   - ------------------------------------------------------------------ ... ---
//
// On the whole filing that costs 2,679 of the 2,680 rows their identity: every
// row carries the FIRST block's issuer `SUNTRUST BANKS, INC.` and its meeting
// date 20040915. On this fixture the four ConAgra proposals (source lines
// 178-186) come out as rows 4-7 carrying SunTrust, and the ConAgra block's own
// `Proposal / Number` header lines come out as two furniture rows whose
// how_voted reads `Vote` and `Cast`.
//
// TestHowVotedVocabularyInvariant IS RED ON THIS FIXTURE, for exactly that
// second reason, and that is the same defect: the furniture rows are produced
// by the swallowed block header. The invariant must not be loosened and the
// fixture must not be excluded from it -- both go green together when the
// block framing is fixed.
//
// Fix in layout_splittable.go, the ProxyEdge block reader -- spReadContext /
// spReadProxyEdgeHeading and the body/header split in parseSplitTableRaw: a
// rule / `<ISSUER NAME> ... Meeting Date:` / `Issuer:` / `ISIN:` / `SEDOL:` /
// rule quintuple inside an open `<TABLE>` must close the current block and open
// a new one.
//
// Rows affected: 2,679 on this filing.
func TestFamilyMislink6ConAgraBlockReadAsTableBody(t *testing.T) {
	rows := familyMislink6Dispatch(t, "value_equity_trust_issuer_blocks.txt", "", "splittable")
	if len(rows) == 0 {
		t.Fatalf("fixture precondition: no rows")
	}
	conagra := map[string]bool{
		"DIRECTOR": true,
		"RATIFY THE APPOINTMENT OF INDEPENDENT AUDITORS": true,
	}
	var seen int
	for _, r := range rows {
		if r.HowVoted == "Vote" || r.HowVoted == "Cast" {
			t.Errorf("a swallowed block header became a vote row: how_voted=%q item=%.40q desc=%.60q", r.HowVoted, r.ItemSeq, r.VoteDescription)
		}
		if !conagra[r.VoteDescription] && !strings.HasPrefix(r.VoteDescription, "APPROVE THE CONAGRA FOODS") {
			continue
		}
		seen++
		if r.IssuerName != "CONAGRA FOODS, INC." || r.MeetingDate != "20040923" {
			t.Errorf("a ConAgra proposal carries the previous block's identity: desc=%.45q issuer=%q date=%q, want issuer=\"CONAGRA FOODS, INC.\" date=\"20040923\" (source lines 167 and 178-186)", r.VoteDescription, r.IssuerName, r.MeetingDate)
		}
	}
	if seen == 0 {
		t.Fatalf("fixture precondition: no ConAgra proposal row found among %d rows", len(rows))
	}
}
