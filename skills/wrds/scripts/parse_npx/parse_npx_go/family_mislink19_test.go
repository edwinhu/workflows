package main

import (
	"path/filepath"
	"testing"
)

// familyMislink19Dispatch runs the real dispatch on a family MISLINK19 fixture
// with the named dictionary rows loaded (dict "" means no dictionary at all)
// and asserts the fixture's own preconditions -- status and layout -- so a
// failure below is an assertion about the rows and never a broken fixture.
func familyMislink19Dispatch(t *testing.T, fixture, dict, layout string) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	if dict == "" {
		cikDict = nil
	} else {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink19", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink19", fixture), sink, make([]byte, headBytes))
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

// familyMislink19BannerHolds asserts that no row carries the promoted proposal
// line as its fund or its series, and that every row keeps the banner the
// filing actually printed over the section.
func familyMislink19BannerHolds(t *testing.T, rows []VoteRow, promoted, promotedSeries, wantFund, wantSeries string) {
	t.Helper()
	for i, r := range rows {
		if r.FundName == promoted || (promotedSeries != "" && r.SeriesID == promotedSeries) {
			t.Errorf("row %d (issuer=%q item=%q): fund_name=%q series_id=%q -- %q is proposal text, not a fund of this registrant; the section is headed %q (%q)",
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

// 000075/756913/0001438934-23-000262.txt (JOHN HANCOCK VARIABLE INSURANCE
// TRUST, CIK 756913, period 20230630, layout broadridge, 237,965 rows):
// verbatim source lines 546573-546588 (the fund banner and the head of its
// first block), 554752-554792 (the whole of ANGANG STEEL's 14-Jul-2022 EGM,
// ending on the wrapped tail of proposal 4, the four blanks under it and the
// rule) and 554793-554816 (the head of ANGANG's next meeting). The twenty-one
// `<SERIES>` blocks are the filing's own, cut to `<SERIES-ID>`/`<SERIES-NAME>`:
// the declared set is the evidence the resolver reads, so a two-name header
// would change the answer rather than shorten the fixture.
//
// The section is opened at source line 546573 by the banner this vendor prints
// at column 0 directly above a block rule:
//
//	3363 JHVIT Emerging Markets Value Trust
//
// which resolves to the declared `Emerging Markets Value Trust`, S000017255
// (source lines 837-838). Source lines 554785-554787 are one numbered proposal
// whose text wraps over three lines:
//
//	4      TO CONSIDER AND APPROVE THE PROPOSED                      Mgmt          For                            For
//	       ISSUANCE OF MEDIUM-TERM NOTES OF THE
//	       COMPANY IN THE INTER-BANK BOND MARKET
//
// collapseSpaces (html.go:457) shrinks the four blank lines under the tail to
// one and drops the leading indentation, so `COMPANY IN THE INTER-BANK BOND
// MARKET` arrives at brHeadingSlot's blank-crossed slot (layout_broadridge.go
// :490) looking exactly like a fund banner. issResolveFund answers it with the
// declared `Total Bond Market Trust`, S000008214 (source lines 57-58), and
// layout_broadridge.go:1488-1501 adopts it. Every row after it -- ANGANG's own
// next meeting included -- comes out under a BOND fund that cast none of them.
//
// Neither existing guard sees it. brProposalContinuationSlot
// (layout_broadridge.go:663) tests exactly ONE line above the slot for a
// numbered row carrying this grammar's vote cells; here that line is
// `ISSUANCE OF MEDIUM-TERM NOTES OF THE`, itself a wrapped continuation, and
// the numbered row is two lines further up. brOpenProposalTail (:639) compares
// the slot against the open row's last text line, and the row has already been
// closed by the time the rule is read.
//
// Measured on the whole filing (real dispatch, cik_series.tsv loaded), three
// promoted proposal tails each take the remainder of their section:
//
//	COMPANY IN THE INTER-BANK BOND MARKET         S000008214   5,553 rows
//	CLAUSES OF THE FINANCIAL SERVICES AGREEMENT   S000008229  11,022 rows
//	FINANCIAL SERVICES TO RELATED PARTIES         S000008229  41,728 rows
//
// against 986 rows left to `3363 JHVIT Emerging Markets Value Trust`
// (S000017255) and 7,094 to `3367 JHVIT International Equity Index Trust`
// (S000008297), the two sections those tails stand in. A wrong series is worse
// than a blank one.
//
// The same shape, same layout, same registrant family, on two siblings the
// detector flags: `THE GLOBAL EQUITY PLAN` at source line 764108 of
// 0001438934-20-000335.txt (13,327 rows, S000017253) and 836568 of
// 0001438934-20-000319.txt (17,793 rows, S000040959), whose anchor line is
// likewise a wrapped continuation (`MR JOHN ALEXANDER ('SKANDER') MALCOLM
// UNDER`).
//
// Recommended fix, layout_broadridge.go, brProposalContinuationSlot (:663): the
// anchor walk must climb the whole unbroken run of non-blank, unruled lines
// above the slot to the numbered row that opened it -- the bounded upward walk
// issProposalWrapLine (layout_issnpx.go:7501) already performs for the other
// grammar -- rather than testing lines[j-1] alone.
func TestFamilyMislink19JHVITProposalTailPromotedToFund(t *testing.T) {
	rows := familyMislink19Dispatch(t, "jhvit2023_interbank_bond_market_wrap.txt", "", "broadridge")
	familyMislink19BannerHolds(t, rows,
		"COMPANY IN THE INTER-BANK BOND MARKET", "S000008214",
		"3363 JHVIT Emerging Markets Value Trust", "S000017255")
}

// 000133/1331971/0001438934-16-000950.txt (John Hancock Funds II, CIK 1331971,
// period 20160630, layout broadridge, 190,668 rows): verbatim source lines
// 53983-53999 (the fund banner and the head of its first block), 57893-57910
// (the tail of the 3M COMPANY meeting, ending on the wrapped tail of proposal
// 5, the four blanks under it and the rule) and 57911-57935 (the head of the
// EDWARDS LIFESCIENCES meeting). The twenty-one `<SERIES>` blocks are the
// filing's own, cut to `<SERIES-ID>`/`<SERIES-NAME>`.
//
// A second, distinct shape in the same layout. The section is opened at source
// line 53983 by `2DAF JHFII U.S. Equity Fund`, which resolves to the declared
// `U.S. Equity Fund (FKA U.S. Multi Sector Fund)`, S000003401 (source lines
// 738-739). Source lines 57904-57905 are the LAST proposal of the 3M meeting:
//
//  5. STOCKHOLDER PROPOSAL REGARDING GENDER PAY               Shr           For                            Against
//     EQUITY.
//
// Here the line immediately above the slot IS the numbered vote row that opened
// it -- the anchor brProposalContinuationSlot (layout_broadridge.go:663) looks
// for -- so the walk is not the problem. brVoteRowSlot (:687) is: it accepts a
// proposal-type cell spelled `mgmt`, `mgt`, `management` or `shareholder`, and
// this vendor abbreviates the shareholder proposal to `Shr`. The guard
// therefore reports the anchor row as ordinary prose and `EQUITY.` is handed to
// the blank-crossed branch.
//
// It does not resolve to anything this registrant declares. It resolves through
// the DICTIONARY to a bare `EQUITY` row of a DIFFERENT registrant -- CIK 88525,
// S000008805, period 20060630 (the fixture's dict carries exactly that row) --
// so 39,356 rows of a John Hancock fund come out under another filer's series.
// Measured on the whole filing: `EQUITY.` 37,240 rows and `EQUITY` 2,116, both
// S000008805, against 1,001 rows left to `2DAF JHFII U.S. Equity Fund`.
//
// Recommended fix, layout_broadridge.go, brVoteRowSlot (:687): the
// proposal-type vocabulary must carry this grammar's own abbreviations --
// `shr` beside `shareholder`, as the sibling readers already do -- so that a
// complete proposal row is never a heading candidate. The dictionary escape
// above it is a second, separable defect: a heading that matches no name the
// registrant itself declares or files under should not be allowed to take
// another CIK's series id.
func TestFamilyMislink19JHFIIShrProposalRowPromotedToFund(t *testing.T) {
	rows := familyMislink19Dispatch(t, "jhfii2016_gender_pay_equity_tail.txt", "jhfii_equity_dict.tsv", "broadridge")
	familyMislink19BannerHolds(t, rows,
		"EQUITY.", "S000008805",
		"2DAF JHFII U.S. Equity Fund", "S000003401")
}

// 000141/1413032/0001104659-11-049118.txt (Columbia Funds Variable Series Trust
// II, CIK 1413032, period 20110630, layout issnpx, 52,929 rows): verbatim
// source lines 1151-1162 (the `=`-ruled fund banner and the head of its first
// meeting), 3086-3095 (the head of the RIO TINTO PLC meeting) and 3115-3145
// (its last proposals, the blanks, the rule and the head of the SCHLUMBERGER
// LIMITED meeting). The twenty-one `<SERIES>` blocks are the filing's own, cut
// to `<SERIES-ID>`/`<SERIES-NAME>`; `columbia_cash_management_dict.tsv` is the
// three cik_series rows of S000019849.
//
// A third shape, in the OTHER layout. The section is opened at source line 1151
// by
//
//	================= COLUMBIA VARIABLE PORTFOLIO - BALANCED FUND ==================
//
// which resolves to the declared `Columbia Variable Portfolio - Balanced Fund`,
// S000019838. Source lines 3121-3123 close the RIO TINTO meeting:
//
//	21    Authorise Market Purchase               For       For          Management
//	22    Authorise the Company to Call EGM with  For       Against      Management
//	      Two Weeks' Notice
//
// and source line 3126 is the block rule. `21 Authorise Market Purchase For For
// Management` is a COMPLETE proposal row of this grammar -- item number, Mgt
// Rec, Vote Cast and Sponsor cells -- and it is nonetheless offered as a fund
// banner and adopted. issProposalWrapLine (layout_issnpx.go:7501) is the guard
// MISLINK17 added, and it is aimed at the wrapped TAIL of a proposal, not at
// the numbered row itself; layout_broadridge.go has brVoteRowSlot (:687) for
// exactly this case and layout_issnpx.go has no counterpart.
//
// The resolution comes from the dictionary: the sponsor cell `Management`
// carries the line to `Columbia Variable Portfolio - Cash Management Fund`,
// S000019849. That is a money-market fund, and measured on the whole filing it
// collects 28,414 rows of other portfolios' equity votes under five spellings
// of the same promoted row:
//
//	Authorise Market Purchase For For Management             18,695
//	Authorize Market Purchase For For Management              4,158
//	Authorise Shares for Market Purchase For For Management   3,165
//	Authorize Open-Market Purchases of For For Management     2,100
//	Authorise Off-Market Purchase For For Management            296
//
// The 2012 sibling 0001104659-12-060236.txt is the same shape: 30,836 rows in
// flagged groups, all S000019849.
//
// Recommended fix, layout_issnpx.go, the bare-paragraph branch at :631-656: a
// candidate that issSplitItem reads as a numbered item AND issPeelColumns reads
// this grammar's trailing Vote Cast / Sponsor cells out of is a proposal row,
// never a heading -- the same test brVoteRowSlot applies in the other grammar
// -- and must be refused before issPlainHeadingSeries is consulted.
func TestFamilyMislink19ColumbiaProposalRowPromotedToFund(t *testing.T) {
	rows := familyMislink19Dispatch(t, "columbia2011_authorise_market_purchase.txt", "columbia_cash_management_dict.tsv", "issnpx")
	familyMislink19BannerHolds(t, rows,
		"Authorise Market Purchase For For Management", "S000019849",
		"COLUMBIA VARIABLE PORTFOLIO - BALANCED FUND", "S000019838")
}
