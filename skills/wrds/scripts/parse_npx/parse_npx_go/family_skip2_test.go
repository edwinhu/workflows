package main

import (
	"path/filepath"
	"testing"
)

// familySkip2Dispatch runs the real dispatch on a family SKIP2 fixture and
// returns the rows with the manifest row, asserting no precondition: the defect
// under test IS the empty result, so a precondition on it would turn each of
// these into a fixture error rather than a failed assertion.
//
// Family SKIP2 is the residue of family SKIP. Batch 72 landed proxyedge, agenda,
// twoband, the `#` strip in htmlCanonLabel and the splittable stacked-header
// join; 396 of the 1,394 large skipped filings now emit rows. The 997 that still
// skip reach that skip the same way every SKIP member did -- no named layout
// claims the body, htmltable offers itself to everything
// (matchHTMLTable returns true unconditionally, text_parser.go:103), reads the
// body, emits nothing and returns errLayoutDeclined (layout_htmltable.go:724).
// What differs is WHICH grammar the filing is written in, and that is what each
// test below names.
func familySkip2Dispatch(t *testing.T, fixture string) ([]VoteRow, FilingMeta) {
	t.Helper()
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_skip2", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	return rows, meta
}

// 000110/1109957/0001144204-17-045558.txt: 13-16, 193-199, 282, 288-290,
// 293-295, 298-300, 307-337, 354-374, and the filing's own last three lines.
// Cullen Funds Trust 2017 (CIK 1109957, 4.7 MB) is the SAME Broadridge ProxyEdge
// ballot-detail grid layout_proxyedge.go was written for -- one <td> per logical
// column, so after stripHTML the whole grid arrives one cell per line -- with ONE
// extra column in the ballot header:
//
//	Item / Proposal / Recommendation / Default Vote / For / Against / Abstain / Take No Action
//	1 / Election of Directors (Majority Voting) / For / None / 309700 / 0 / 0 / 0
//
// `Default Vote` is what the broker would have cast absent an instruction. It is
// a real column of the vendor's later template and it is not in peVocabulary
// (layout_proxyedge.go:29-53), so peHeaderAt's band -- a RUN of consecutive lines
// EVERY one of which is in the vocabulary (layout_proxyedge.go:102-114) -- breaks
// at `Default` before it has seen a single disposition column. dispositions is 0,
// the `dispositions < 2` test at layout_proxyedge.go:115 returns nil, and
// matchProxyEdge never fires. Nothing else in the registry claims the body and
// htmltable declines it, exactly as it declined the Guinness Atkinson 2011 filing
// before batch 72.
//
// The same break happens to every sibling in this pool, and on two filers the
// label itself WRAPS across two physical cells (`Default` / `Vote`,
// `Take No` / `Action` -- World Funds Trust 2016, Two Roads Shared Trust 2021),
// which is the second way the run is cut.
//
// Fix in layout_proxyedge.go, in peVocabulary and peHeaderAt. Add DEFAULT VOTE
// (the broker's standing instruction, which is neither the management
// recommendation nor the fund's ballot, so it needs a role of its own that
// peVoteRow reads into no field) and let peHeaderAt tolerate a label the vendor
// wrapped onto a second line by joining a non-vocabulary line with the one before
// it when the join IS in the vocabulary. The disposition reader beneath it needs
// no change: the count columns are spelled exactly as they were.
func TestFamilySkip2CullenProxyEdgeDefaultVoteColumn(t *testing.T) {
	rows, meta := familySkip2Dispatch(t, "cullen_proxyedge_default_vote.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 1 3M COMPANY proposal (ticker MMM, security 88579Y101, meeting 09-May-2017, item 1 Election of Directors (Majority Voting), 309700 shares cast For) for Cullen High Dividend Equity Fund",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "3M COMPANY" {
			continue
		}
		seen++
		if r.FundName != "Cullen High Dividend Equity Fund" {
			t.Errorf("fund: got %q want %q", r.FundName, "Cullen High Dividend Equity Fund")
		}
		if r.Ticker != "MMM" {
			t.Errorf("ticker: got %q want %q", r.Ticker, "MMM")
		}
		if r.CUSIP != "88579Y101" {
			t.Errorf("cusip: got %q want %q", r.CUSIP, "88579Y101")
		}
		if r.MeetingDate != "20170509" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20170509")
		}
		if r.VoteDescription != "Election of Directors (Majority Voting)" {
			t.Errorf("description: got %q want %q", r.VoteDescription, "Election of Directors (Majority Voting)")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q -- 309700 shares sit in the For column", r.HowVoted, "For")
		}
		if r.ManagementRecommendation != "For" {
			t.Errorf("management recommendation: got %q want %q", r.ManagementRecommendation, "For")
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 3M COMPANY proposal in %d parsed", seen, len(rows))
	}
}

// 000108/1081402/0001081400-10-000103.txt: 23-26, 153-160, 268-296, and the
// filing's own last four lines. Wells Fargo Variable Trust 2010 (CIK 1081402,
// 12.7 MB) prints the ISS `# / Proposal / Mgt Rec / Vote Cast / Sponsor` report
// with NO TABLE AT ALL: each logical line of the report is one <div>, and the
// filer's own source file hard-wraps inside that <div>, so every logical line
// arrives broken across two or three physical lines with a blank line only
// between DIVS:
//
//	#     Proposal                                Mgt
//	Rec   Vote Cast    Sponsor
//
//	1.1   Elect
//	Director F. Duane
//	Ackerman        For       For          Management
//
// The identity is wrapped the same way -- `Ticker:   ALL   Security` /
// `ID:  020002101`, and `Meeting` / `Date: MAY 18, 2010   Meeting Type: Annual`.
//
// labelvalue is the layout for exactly this grammar, but every one of its
// predicates is over ONE PHYSICAL LINE: lvColumnHeader wants a line whose first
// gap-separated cell is `#` and which also carries `Proposal` and `Vote Cast`
// (layout_labelvalue.go:55-69), and here `Vote Cast` is on the line after the
// one carrying `#` and `Proposal`. The row reader has the same problem: the item
// number, the description and the three vote cells are spread over three lines,
// so no line carries a complete row. htmltable finds no </tr> in the body at all
// -- there is no table -- and returns errLayoutDeclined at
// layout_htmltable.go:107.
//
// Fix in layout_labelvalue.go: unwrap before matching. stripHTML leaves exactly
// one blank line between <div>s and none inside one, so a RUN of consecutive
// non-blank lines is one logical line of the report and joining the run with a
// single space reconstructs it -- no vocabulary, no column arithmetic, and the
// existing lvColumnHeader / lvPairs / lvVoteRow then read the filing unchanged.
func TestFamilySkip2WellsFargoVTHardWrappedDivs(t *testing.T) {
	rows, meta := familySkip2Dispatch(t, "wells_fargo_vt_hardwrapped_divs.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 1 ALLSTATE CORPORATION, THE proposal (ticker ALL, security ID 020002101, meeting MAY 18, 2010, item 1.1 Elect Director F. Duane Ackerman, Vote Cast For) for Wells Fargo Advantage VT C&B Large Cap Value Fund",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "ALLSTATE CORPORATION, THE" {
			continue
		}
		seen++
		if r.FundName != "Wells Fargo Advantage VT C&B Large Cap Value Fund" {
			t.Errorf("fund: got %q want %q", r.FundName, "Wells Fargo Advantage VT C&B Large Cap Value Fund")
		}
		if r.Ticker != "ALL" {
			t.Errorf("ticker: got %q want %q", r.Ticker, "ALL")
		}
		if r.CUSIP != "020002101" {
			t.Errorf("cusip: got %q want %q", r.CUSIP, "020002101")
		}
		if r.MeetingDate != "20100518" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20100518")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q (desc=%q)", r.HowVoted, "For", r.VoteDescription)
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 ALLSTATE proposal in %d parsed", seen, len(rows))
	}
}

// 000090/906619/0000088053-04-000666.txt: 23-26, 55-62, 137-163, and the
// filing's own last four lines. Scudder Investment Portfolios 2004 (CIK 906619,
// 5.8 MB) files the FIXED-WIDTH ProxyEdge "Investment Company Report" -- the
// plain-text sibling of the HTML ProxyEdge grid layout_proxyedge.go reads:
//
//	ProxyEdge -  Investment Company Report        Report Date: 07/22/2004
//	Meeting Date Range: 07/01/2003 to 06/30/2004
//	Selected Accounts: Asset Mgmt Port II
//
//	- ------------------------------------------------------------------
//	NVIDIA CORPORATION                   NVDA        Annual Meeting Date: 07/10/2003
//	Issuer: 67066G                       ISIN:
//	- ------------------------------------------------------------------
//	 Proposal                            Proposal     Vote      Against
//	 Number   Proposal                   Type         Cast       Mgmt.
//	- ------------------------------------------------------------------
//	   01     DIRECTOR                   Management   For        No
//
// The fund is the `Selected Accounts:` line, the issuer/ticker/meeting-date line
// is the block heading, and the column header is STACKED over two physical lines
// (`Proposal`/`Number`, `Vote`/`Cast`, `Against`/`Mgmt.`) above a dashed rule
// that draws the exact spans.
//
// splittable is the layout whose machinery fits this -- rule-cut spans and, since
// batch 72, a column-wise join of the header lines above the rule -- but it never
// sees the body: matchSplitTable is `containsAnyFolded(head, spSignatures)` and
// spSignatures is exactly {"institutional account name", "institutional account
// id"} (layout_splittable.go:99,120). This vendor prints neither phrase anywhere,
// so the matcher returns false before any of that machinery runs. icr wants the
// proponent first, labelvalue wants a `#` header line, pvtext wants
// `ISSUER NAME TICKER CUSIP MTG DATE`, and fixedwidth is the strict Glass Lewis
// shape. htmltable then declines a body with no </tr> in it at all.
//
// Fix in layout_splittable.go, in spSignatures/matchSplitTable and spRoles: admit
// the `ProxyEdge -` + `Investment Company Report` banner as a second signature
// for this family, add PROPOSAL TYPE and AGAINST MGMT. to spRoles (PROPOSAL
// NUMBER, PROPOSAL and VOTE CAST are already there), and let spReadContext take
// the block identity from the heading line between the two rules -- issuer at
// column 0, ticker and `<type> Meeting Date: <date>` to its right -- plus the
// fund from `Selected Accounts:`.
func TestFamilySkip2ScudderProxyEdgeTextReport(t *testing.T) {
	rows, meta := familySkip2Dispatch(t, "scudder_proxyedge_text_report.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 2 NVIDIA CORPORATION proposals (ticker NVDA, meeting 07/10/2003, items 01 DIRECTOR and 02 TO RATIFY THE SELECTION OF KPMG LLP, both Vote Cast For) for the Asset Mgmt Port II account",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "NVIDIA CORPORATION" {
			continue
		}
		seen++
		if r.FundName != "Asset Mgmt Port II" {
			t.Errorf("fund: got %q want %q", r.FundName, "Asset Mgmt Port II")
		}
		if r.Ticker != "NVDA" {
			t.Errorf("ticker: got %q want %q", r.Ticker, "NVDA")
		}
		if r.MeetingDate != "20030710" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20030710")
		}
		if r.HowVoted != "For" {
			t.Errorf("item %q how_voted: got %q want %q (desc=%q)", r.ItemSeq, r.HowVoted, "For", r.VoteDescription)
		}
	}
	if seen != 2 {
		t.Fatalf("found %d of the 2 NVIDIA proposals in %d parsed", seen, len(rows))
	}
}

// 000093/939934/0001135428-09-000428.txt: 23-26, 197-203, 259-271, and the
// filing's own last four lines. SEI Institutional Investments Trust 2009
// (CIK 939934, 11.5 MB) is the largest coherent family left in this pool: 50 of
// the 997 were filed through agent 0001135428 in this one grammar, a fixed-width
// report inside an EDGAR text <TABLE> with NO rule line and a ONE-LINE header:
//
//	                              CORE FIXED INCOME FUND
//	 PROPOSAL                            PROPOSED BY MGT. POSITION     REGISTRANT VOTED
//	<S>                                         <C>         <C>               <C>
//	EVERGREEN FUNDS
//	 CUSIP: 300250602
//	 Meeting Date: 3/12/2009  Meeting Type: Special
//	 1. Approve Investment Advisory Agreement    Management     For          Voted - For
//
// The header's four labels are `PROPOSAL`, `PROPOSED BY`, `MGT. POSITION` and
// `REGISTRANT VOTED`, and the last three are separated from each other by ONE
// SPACE -- on most pages of the filing all three are glued
// (`PROPOSED BY MGT. POSITION REGISTRANT VOTED`, e.g. line 298). A gap-split on
// runs of two or more spaces therefore yields TWO cells, not four, however the
// line is cut; only the data rows' own column offsets reveal where the
// boundaries are, and the <C> line above them is the only other witness.
//
// Nothing in the registry claims it. labelvalue wants a line whose first cell is
// `#` carrying `Proposal` and `Vote Cast` (layout_labelvalue.go:55-69); this
// header's first cell is `PROPOSAL` and `Vote Cast` is spelled
// `REGISTRANT VOTED`. icr wants six gap-separated columns with the proponent
// FIRST (layout_icr.go:36-47); here the proponent is second of four. pvtext wants
// `ISSUER NAME TICKER CUSIP MTG DATE` (layout_pvtext.go:423-429). splittable
// needs `institutional account name` (layout_splittable.go:99) and this filer
// prints no such phrase; it also has no dashed rule for spRuleSpans to cut on.
// htmltable then reads a body with no <td> in it and returns errLayoutDeclined.
//
// Fix in layout_pvtext.go, in pvTextHeaderLinesAt and the row reader it feeds:
// this is pvtext's two-part shape -- an identity block then a fixed-width
// proposal table -- with a header the vendor spells differently and glues
// together. Accept a header line whose first cell is `PROPOSAL` and whose
// remainder names a proponent, a management position and a registrant vote, cut
// the columns from the `<S> <C> <C> <C>` alignment line beneath it rather than
// from the header's own gaps, and let the existing `CUSIP:` / `TICKER:` /
// `Meeting Date:` / `Meeting Type:` label reader supply the identity under the
// bare issuer heading. how_voted is `Voted - For` verbatim, not `For`.
func TestFamilySkip2SEIInstitutionalSingleSpaceHeader(t *testing.T) {
	rows, meta := familySkip2Dispatch(t, "sei_institutional_single_space_header.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 1 EVERGREEN FUNDS proposal (CUSIP 300250602, meeting 3/12/2009, item 1 Approve Investment Advisory Agreement, REGISTRANT VOTED \"Voted - For\") for the CORE FIXED INCOME FUND",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "EVERGREEN FUNDS" {
			continue
		}
		seen++
		if r.FundName != "CORE FIXED INCOME FUND" {
			t.Errorf("fund: got %q want %q", r.FundName, "CORE FIXED INCOME FUND")
		}
		if r.CUSIP != "300250602" {
			t.Errorf("cusip: got %q want %q", r.CUSIP, "300250602")
		}
		if r.MeetingDate != "20090312" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20090312")
		}
		if r.VoteDescription != "Approve Investment Advisory Agreement" {
			t.Errorf("description: got %q want %q", r.VoteDescription, "Approve Investment Advisory Agreement")
		}
		if r.HowVoted != "Voted - For" {
			t.Errorf("how_voted: got %q want %q", r.HowVoted, "Voted - For")
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 EVERGREEN FUNDS proposal in %d parsed", seen, len(rows))
	}
}

// 000089/897111/0000894189-20-006966.txt: 15, 531-537, 704-769, 638, and the
// filing's own last four lines. Carillon Series Trust 2020 (CIK 897111, 13.9 MB)
// prints a perfectly ordinary flat HTML table -- one <td> per column, one <tr>
// per vote -- whose COLUMN LABELS ARE THE FORM N-PX ITEM 1 QUESTIONS rather than
// column names:
//
//	Fund Name | CUSIP | Symbol | Issuer/Company Name | Meeting Date | Issue |
//	Was this a Shareholder, Mgmt, or Issuer proposal? | Did the Fund Vote? |
//	How the Fund cast its vote |
//	Was the Fund vote "with" or "against" Management recommendation
//
//	Carillon / ClariVest Capital Appreciation Fund | 981558109 | WP |
//	Worldpay, Inc. | 24-Jul-19 | Approve Merger Agreement | Management | Yes |
//	For | With
//
// htmltable reads the cells correctly and then refuses the header: htmlMapFields
// canonicalises each label and looks it up in htmlSynonyms, and the vote column
// here is spelled `HOW THE FUND CAST ITS VOTE`, which is in none of the
// htmlFieldVote entries (layout_htmltable.go:2238-2249 -- `VOTE CAST`,
// `REGISTRANT VOTED`, `HOW VOTED`, plus two of the SEC's OTHER Item 1(e)
// sentences already listed verbatim for ETFis and Van Wagoner). With no cell
// mapping htmlFieldVote, htmlHeaderShape refuses the row
// (layout_htmltable.go:1767), no mapping is adopted, and parseHTMLTableRaw
// returns errLayoutDeclined at layout_htmltable.go:724.
//
// Fix in layout_htmltable.go, in htmlSynonyms: this is the same defect those two
// sentences were added for, one sentence later. Add `HOW THE FUND CAST ITS VOTE`
// to htmlFieldVote, `ISSUE` to htmlFieldDesc, `ISSUER/COMPANY NAME` to
// htmlFieldIssuer, `WAS THIS A SHAREHOLDER, MGMT, OR ISSUER PROPOSAL?` to
// htmlFieldBy and `DID THE FUND VOTE?` to htmlFieldVotedFlag -- the `DID `
// prefix already has a guard at layout_htmltable.go:2460, so the voted-flag
// column will not be mistaken for the vote.
func TestFamilySkip2CarillonItem1SentenceHeaders(t *testing.T) {
	rows, meta := familySkip2Dispatch(t, "carillon_item1_sentence_headers.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 1 Worldpay, Inc. proposal (CUSIP 981558109, symbol WP, meeting 24-Jul-19, Approve Merger Agreement, cast For) for Carillon / ClariVest Capital Appreciation Fund",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "Worldpay, Inc." {
			continue
		}
		seen++
		if r.FundName != "Carillon / ClariVest Capital Appreciation Fund" {
			t.Errorf("fund: got %q want %q", r.FundName, "Carillon / ClariVest Capital Appreciation Fund")
		}
		if r.CUSIP != "981558109" {
			t.Errorf("cusip: got %q want %q", r.CUSIP, "981558109")
		}
		if r.Ticker != "WP" {
			t.Errorf("ticker: got %q want %q", r.Ticker, "WP")
		}
		if r.MeetingDate != "20190724" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20190724")
		}
		if r.VoteDescription != "Approve Merger Agreement" {
			t.Errorf("description: got %q want %q", r.VoteDescription, "Approve Merger Agreement")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q", r.HowVoted, "For")
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 Worldpay proposal in %d parsed", seen, len(rows))
	}
}
