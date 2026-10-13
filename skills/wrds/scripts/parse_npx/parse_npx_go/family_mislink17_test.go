package main

import (
	"path/filepath"
	"testing"
)

// familyMislink17Dispatch runs the real dispatch on a family MISLINK17 fixture
// with the named dictionary rows loaded (dict "" means no dictionary at all)
// and asserts the fixture's own preconditions -- status and layout -- so a
// failure below is an assertion about the rows and never a broken fixture.
func familyMislink17Dispatch(t *testing.T, fixture, dict, layout string) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	if dict == "" {
		cikDict = nil
	} else {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink17", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink17", fixture), sink, make([]byte, headBytes))
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

// familyMislink17NoPromotedProposal asserts that no row carries the wrapped
// proposal line as its fund, and that every row of the section carries the
// banner the filing actually printed over it.
func familyMislink17NoPromotedProposal(t *testing.T, rows []VoteRow, promoted, promotedSeries, wantFund, wantSeries string) {
	t.Helper()
	for i, r := range rows {
		if r.FundName == promoted || (promotedSeries != "" && r.SeriesID == promotedSeries) {
			t.Errorf("row %d (issuer=%q item=%q): fund_name=%q series_id=%q -- %q is the wrapped tail of the preceding proposal, not a fund of this registrant; the section is headed %q (%q)",
				i+1, r.IssuerName, r.ItemSeq, r.FundName, r.SeriesID, promoted, wantFund, wantSeries)
		}
	}
	for i, r := range rows {
		if r.FundName != wantFund || r.SeriesID != wantSeries {
			t.Errorf("row %d (issuer=%q item=%q): fund_name=%q series_id=%q want %q / %q -- the enclosing `=`-ruled banner",
				i+1, r.IssuerName, r.ItemSeq, r.FundName, r.SeriesID, wantFund, wantSeries)
		}
	}
}

// 000110/1100663/0001193125-16-693665.txt (iSHARES TRUST, CIK 1100663, period
// 20160630, layout issnpx), 236,755 rows on the run73 full parse: verbatim
// source lines 1, 4-9, 12, 14-16, 22, 43-44, then seven `<SERIES>` blocks cut
// to their id and name (1925-1928/1934, 1935-1938/1944, 1945-1948/1954,
// 1955-1958/1964, 1965-1968/1974, 1975-1978/1984, 2275-2278/2284), the header
// close 2905-2913, the report banner 3385-3390, the fund banner and its first
// meeting 11716-11725, and 12245-12280.
//
// The filing's fund sections are `=`-ruled banners and its meetings are dashed
// blocks. A proposal whose text does not fit the column wraps onto an indented
// continuation line, and when the wrap is the LAST line of the block it is
// followed by a blank -- source lines 12251-12255 verbatim:
//
//	5     Participate in OECD Mediation for       Against   Against      Shareholder
//	      Human Rights Violations
//
//
//	--------------------------------------------------------------------------------
//
// `Human Rights Violations` is the tail of proposal 5. Nothing in the bytes
// marks it as a heading: it is indented to the Proposal column, it carries no
// rule of its own, and the fund section it sits in was opened 536 lines above
// by `======================= iShares Core Dividend Growth ETF =======================`
// (source line 11716) and is not closed until source line 22584.
//
// It becomes the fund anyway. layout_issnpx.go, parseISSNPX, the plain-heading
// branch at :631-653: a non-empty line whose next line is blank and which is
// not followed by an identity block is adopted as a section heading the moment
// `issPlainHeadingSeries` answers it. It answers here through
// issDistinctivePairDecl -- the adjacent ordered pair `human rights` occurs in
// exactly one of the registrant's declared names, `iShares Human Rights ETF`
// (S000037043, source line 1928), a fund whose own section of this filing says
// it "had not commenced operations as of June 30, 2016" and cast no votes at
// all. The pool floor issDistinctivePairMinPool = 6 is why the fixture carries
// seven declared series.
//
// Two defects follow, both measurable on this fixture:
//
//   - every row after the wrap carries fund_name `Human Rights Violations` and
//     series_id S000037043 until the next `=`-ruled banner. The AMERICAN
//     ELECTRIC POWER meeting below it is voted by iShares Core Dividend Growth
//     ETF (S000045648) and is stamped onto a fund that voted nothing. A wrong
//     series is worse than a blank one and is never guessed back.
//   - proposal 5 loses its own tail: vote_description comes out as
//     `Participate in OECD Mediation for`, with `Human Rights Violations`
//     consumed as the heading.
//
// Fix in layout_issnpx.go, parseISSNPX, the plain-heading branch at :631-653:
// a candidate that is INDENTED to the proposal column of the table still open
// above it, and whose upward walk over non-blank lines reaches a numbered
// proposal row of that same table without crossing a rule or a blank, is the
// wrap of that proposal and must never be offered as a heading -- the same
// evidence test layout_broadridge.go's brProposalContinuationSlot and
// brContinuationRunLine already apply to the other grammar. Resolving it is
// not evidence that it is a heading; the plain-heading branch currently treats
// it as though it were.
func TestFamilyMislink17ISharesProposalWrapBecomesFundBanner(t *testing.T) {
	rows := familyMislink17Dispatch(t, "ishares2016_human_rights_wrap.txt", "", "issnpx")
	familyMislink17NoPromotedProposal(t, rows, "Human Rights Violations", "S000037043",
		"iShares Core Dividend Growth ETF", "S000045648")

	want := "Participate in OECD Mediation for Human Rights Violations"
	found := false
	for _, r := range rows {
		if r.IssuerName == "3M COMPANY" && r.ItemSeq == "5" {
			found = true
			if r.VoteDescription != want {
				t.Errorf("item 5: vote_description=%q want %q -- the wrapped tail was taken as a fund heading instead of joined to the proposal", r.VoteDescription, want)
			}
		}
	}
	if !found {
		t.Errorf("no row for item 5 of the 3M meeting (of %d rows)", len(rows))
	}
}

// 000102/1027263/0001193125-21-260148.txt (EQ ADVISORS TRUST, CIK 1027263,
// period 20210630, layout issnpx), 189,154 rows on the run73 full parse:
// verbatim source lines 1, 4-9, 12, 14-16, 22, 43-44, then six `<SERIES>`
// blocks cut to their id and name (45-48/61, 62-65/78, 79-82/95, 96-99/112,
// 113-116/129, 623-626 with the closing `</SERIES>` of source line 656), the
// header close 1608-1616, the report banner 1659-1665, the fund banner and its
// first meeting 25957-25966, and 52406-52425.
//
// The same shape in a different registrant, and here the wrap is the tail of a
// proposal NAMING a security class -- source lines 52411-52415 verbatim:
//
//	5B    Authorize a New Class of Non-Voting     For       For          Management
//	      Common Stock
//
//
//	--------------------------------------------------------------------------------
//
// `Common Stock` is half of proposal 5B. The plain-heading branch
// (layout_issnpx.go:631-653) adopts it because issPlainHeadingSeries resolves
// it against the declared `EQ/Common Stock Index Portfolio` (S000010734,
// source line 626).
//
// The enclosing section is `========================= 1290 VT Micro Cap
// Portfolio ==========================` (source line 25957), a banner whose own
// name this filing's header does not declare, so its rows carry a BLANK series
// -- which is the honest reading and what the promoted rows must fall back to.
// Trading that blank for S000010734 is the defect: the votes below the wrap
// were cast by the 1290 VT Micro Cap Portfolio, not by the Common Stock Index
// Portfolio.
//
// Same fix location as the iShares case: layout_issnpx.go, parseISSNPX, the
// plain-heading branch at :631-653.
func TestFamilyMislink17EQAdvisorsProposalWrapBecomesFundBanner(t *testing.T) {
	rows := familyMislink17Dispatch(t, "eqadvisors2021_common_stock_wrap.txt", "", "issnpx")
	familyMislink17NoPromotedProposal(t, rows, "Common Stock", "S000010734",
		"1290 VT Micro Cap Portfolio", "")
}

// 000077/777535/0000930413-22-001535.txt (COLLEGE RETIREMENT EQUITIES FUND,
// CIK 777535, period 20220630, layout issnpx), 165,980 rows on the run73 full
// parse: verbatim source lines 1, 4-9, 12, 14-16, 22, then seven `<SERIES>`
// blocks cut to their id and name (39-44/65, 66-69/90, 91-94/115, 116-119/140,
// 141-144/165, 166-169/190, 191-194/215), the header close 241-248, the report
// banner 332-337, the fund banner and its first meeting 346-355, and
// 14378-14395.
//
// Source lines 14380-14384 verbatim:
//
//	4     Amend Non-Employee Director Omnibus     For       Against      Management
//	      Stock Plan
//
//
//	--------------------------------------------------------------------------------
//
// `Stock Plan` is the tail of proposal 4. This registrant declares its series
// under bare account names -- `Stock Account` is S000005080 (source line 44) --
// so `Stock Plan` reaches it through the shared chain, and the CREF Stock
// Account, which is not the fund whose section this is, takes every row below
// the wrap. The section was opened by
// `============================== CREF Equity Index ===============================`
// (source line 346), which resolves to the declared `Equity Index Account`,
// S000005083.
//
// Same fix location: layout_issnpx.go, parseISSNPX, the plain-heading branch at
// :631-653.
func TestFamilyMislink17CREFProposalWrapBecomesFundBanner(t *testing.T) {
	rows := familyMislink17Dispatch(t, "cref2022_stock_plan_wrap.txt", "", "issnpx")
	familyMislink17NoPromotedProposal(t, rows, "Stock Plan", "S000005080",
		"CREF Equity Index", "S000005083")

	want := "Amend Non-Employee Director Omnibus Stock Plan"
	found := false
	for _, r := range rows {
		if r.ItemSeq == "4" && r.IssuerName != "CLOUDERA, INC." {
			found = true
			if r.VoteDescription != want {
				t.Errorf("item 4: vote_description=%q want %q -- the wrapped tail was taken as a fund heading instead of joined to the proposal", r.VoteDescription, want)
			}
		}
	}
	if !found {
		t.Errorf("no row for item 4 of the first meeting (of %d rows)", len(rows))
	}
}
