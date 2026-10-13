package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// familyMislink11Dispatch runs the real dispatch on a family MISLINK11 fixture
// with the named dictionary rows loaded (dict == "" loads none, for a fixture
// whose own SGML header declares every series it needs), and asserts the
// fixture's own preconditions -- status, layout and row count -- so a failure
// below is an assertion about the series id and never a broken fixture.
func familyMislink11Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict = nil
	if dict != "" {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink11", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink11", fixture), sink, make([]byte, headBytes))
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

// ITEM 1 -- 000080/809593/0000809593-04-000019.txt (American AAdvantage Funds,
// period 20040630, `broadridge`).
//
// Fixture `aadvantage_prose_heading.txt`: verbatim source lines 1-29 (the SGML
// header through the registrant's fiscal year end), 54-60 (the header closer
// and the document opener through `<TEXT>`), 12883-12932 (the
// `AMERICAN AADVANTAGE INTERNATIONAL EQUITY INDEX FUND` ruled sandwich, the
// explanatory master-trust paragraph under it, the
// `AMERICAN AADVANTAGE LARGE CAP GROWTH FUND` ruled sandwich, the CBRL GROUP
// identity block and the whole proposal table under it through `</Table>`) and
// the filing's own last six lines (34113-34118). Every byte is verbatim, 92
// lines. Dispatches to `broadridge` (the precondition asserts it). Dictionary
// `american_aadvantage_dict.tsv`, all 76 rows for CIK 0000809593 verbatim from
// `cik_series.tsv`, so the whole declared family is in play and no
// single-series chassis fallback can mask the defect.
//
// THE SHAPE, IN THE BYTES. The filing names its eighteen funds in a three-line
// ruled sandwich -- a bare 79-column `=` rule, the fund alone on its own
// unruled line, a second bare rule. Source lines 12883-12897 verbatim:
//
//	===============================================================================
//	             AMERICAN AADVANTAGE INTERNATIONAL EQUITY INDEX FUND
//	===============================================================================
//	The American AAdvantage International Equity Index Fund invests all of its
//	investable assets in the Master International Index Series of the Quantitative
//	Master Series Trust.  The proxy voting record of the Quantitative Master Series
//	Trust for the year ended June 30, 2004 was filed on August 13, 2004 under CIK
//	0001025836 and 1940 Act File Number 811-07885.
//
//
//	<PAGE>
//
//	===============================================================================
//	                  AMERICAN AADVANTAGE LARGE CAP GROWTH FUND
//	===============================================================================
//
// `layout_broadridge.go` reads neither sandwich. What it reads instead is the
// FIRST LINE OF THE PROSE PARAGRAPH, and it holds that line as the fund heading
// straight through the next sandwich and into the vote table below it. Measured
// on the current tree over the whole filing with the full 41,139-row
// dictionary:
//
//	4049 S000001829 "The American AAdvantage International Equity Index Fund invests all of its"
//	1948 S000001823 "The American AAdvantage Municipal Money Market Fund invests all of its"
//	1536 ""         ""
//	  55 S000001821 "AMERICAN AADVANTAGE ENHANCED INCOME FUND"
//
// WHICH SECTION THE ROWS BELONG TO -- established from the bytes, not guessed.
// The International Equity Index section contains no vote table at all: the
// paragraph it prints says the fund invests all of its assets in another
// registrant's master series and that the proxy record was filed under CIK
// 0001025836. The first issuer of the 4,049 rows is CBRL GROUP, INC., meeting
// 20031125, printed at source line 12900 -- three lines under the
// `AMERICAN AADVANTAGE LARGE CAP GROWTH FUND` sandwich. So the rows belong to
// the LARGE CAP GROWTH section, and they carry a series that section's own
// banner does not name.
//
// WHAT THE ROWS SHOULD CARRY -- probed, not judged by eye. Against this
// filing's own 76 dictionary-backfilled declarations:
//
//	"AMERICAN AADVANTAGE LARGE CAP GROWTH FUND"           issResolveFund -> ""
//	"AMERICAN AADVANTAGE INTERNATIONAL EQUITY INDEX FUND" issResolveFund -> "S000001829"
//
// The 2004 `AAdvantage` spelling answers for the Index sleeve and refuses for
// the Large Cap Growth one (the brand-cut route answers only where the
// remainder is unique). So the enclosing banner resolves to nothing and the
// honest post-fix value for these rows is BLANK -- which is the point: a wrong
// series is worse than a blank one, and reading a prose sentence as a banner
// manufactures the wrong one out of a section that has no votes.
//
// Fix location: `layout_broadridge.go`, `parseBroadridge` -- the fund-heading
// reader. Two separable changes, in value order:
//
//  1. Give `broadridge` the same ruled-sandwich reader batch 123 gave `issnpx`
//     (`layout_issnpx.go`, the banner chain in `parseISSNPX` beside
//     `issOpenBanner`): a bare rule whose next non-blank line holds no `=` and
//     whose following non-blank line is another bare rule names that text as the
//     section fund. `brBannerAboveProse` (`layout_broadridge.go:551`) already
//     walks upward for a banner over prose, but it stops at the first
//     unindented line that does not resolve -- here that is the rule itself --
//     so the sandwich is never reached.
//  2. A prose guard, independent of the sandwich rule: a heading line that ends
//     in a lower-case word (`invests all of its`) is a sentence in flight and is
//     never a fund banner.
func TestFamilyMislink11AAdvantageProseSentenceHeading(t *testing.T) {
	rows := familyMislink11Dispatch(t, "aadvantage_prose_heading.txt", "american_aadvantage_dict.tsv", "broadridge", 14)
	for _, r := range rows {
		if strings.HasPrefix(r.FundName, "The American AAdvantage") || r.SeriesID != "" {
			t.Errorf("the first line of an explanatory prose paragraph was read as the fund banner, so rows of the enclosing AMERICAN AADVANTAGE LARGE CAP GROWTH FUND sandwich carry another sleeve's series: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want a non-prose fund and blank series",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}

// ITEM 2 -- 000133/1331971/0001438934-15-000380.txt (John Hancock Funds II,
// period 20150630, `broadridge`). This is MISLINK10 ITEM 1, whose fixture the
// previous stage could not cut inside its cap. It is cut here.
//
// Fixture `jhf2_proposal_continuation_heading.txt`: verbatim source lines 1-40
// (the SGML header through the registrant's fiscal year end), then all 97
// `<SERIES>` blocks of the header trimmed to their `<SERIES>` / `<OWNER-CIK>` /
// `<SERIES-ID>` / `<SERIES-NAME>` / `</SERIES>` lines (the NS24 and MISLINK10
// precedent for trimming a declaration block), then 3252-3262 (the header
// closer and the document opener through the first body lines),
// 406255-406266 (the CHINA COMMUNICATIONS SERVICES block opener and this
// grammar's column header), 406530-406541 (proposal 5.3 and the wrapped
// proposal 6.1 whose continuation lines carry the defect), 406583-406620 (the
// CHINA CONSTRUCTION BANK block that opens next, and the first proposals under
// it) and the filing's own last five lines. Every byte is verbatim.
//
// FIXTURE LINE COUNT: 603 lines, far above the ~120-line guide, and stated
// plainly rather than worked around. 485 of those lines are the trimmed
// 97-series declaration block, which the defect needs: the promoted line
// resolves only against the registrant's whole declared set. The body is 62
// lines.
//
// THE SHAPE, IN THE BYTES. Source lines 406532-406540, verbatim (the file
// indents the continuation lines; `stripHTML` removes the indentation before
// `parseBroadridge` sees them):
//
//	6.1    THAT THE GRANT OF A GENERAL MANDATE TO THE                Mgmt          Against                        Against
//	       BOARD TO ISSUE DEBENTURES DENOMINATED IN
//	       LOCAL OR FOREIGN CURRENCIES, IN ONE OR MORE
//	       TRANCHES IN THE PRC AND OVERSEAS, INCLUDING
//	       BUT NOT LIMITED TO, SHORT-TERM COMMERCIAL
//	       PAPER, MEDIUM TERM NOTE, COMPANY BOND AND
//	       CORPORATE DEBTS, WITH A MAXIMUM AGGREGATE
//	       OUTSTANDING REPAYMENT AMOUNT OF UP TO
//	       RMB6.0 BILLION BE CONSIDERED AND APPROVED
//
// There is no rule and no block opener anywhere in this run. Each continuation
// line reaches `parseBroadridge`'s free-standing-text branch, which sets
// `pendingIssuer = brIssuerName(line)`; on the NEXT such line the previous
// `pendingIssuer` is handed to `issResolveFund`, and
// `BUT NOT LIMITED TO, SHORT-TERM COMMERCIAL` resolves against the header's own
// declaration
//
//	<SERIES-ID>S000024676
//	<SERIES-NAME>Short Term Government Income Fund
//
// so S000024676 is stamped on every row from there on. Measured on the current
// tree over the whole filing with the full 41,139-row dictionary:
//
//	42761 S000024676 "BUT NOT LIMITED TO, SHORT-TERM COMMERCIAL"
//
// 42,761 rows carry a series named by a fragment of a Chinese debenture
// proposal.
//
// Fix location: `layout_broadridge.go`, `parseBroadridge`, the
// `if pendingIssuer != ""` block at lines 1651-1655. That block is
// unconditional apart from the resolution itself; none of the guard family
// (`brVoteRowSlot` / `brOpenProposalTail` / `brProposalContinuationSlot` /
// `brMeetingHeadingRun`) is consulted on this path. A `pendingIssuer` that is
// itself the middle of an unbroken indented continuation run under a numbered
// vote row of this grammar must be refused. One predicate, no new resolver
// rung, nothing guessed -- the section's real banner is printed on its own line
// elsewhere in the filing.
//
// The assertion is that the continuation line is never a heading: no row may
// carry it as its fund, and no row may carry the series it resolves to.
func TestFamilyMislink11JHF2ProposalContinuationHeading(t *testing.T) {
	rows := familyMislink11Dispatch(t, "jhf2_proposal_continuation_heading.txt", "", "broadridge", 5)
	for _, r := range rows {
		if r.FundName == "BUT NOT LIMITED TO, SHORT-TERM COMMERCIAL" || r.SeriesID == "S000024676" {
			t.Errorf("a wrapped proposal continuation line became pendingIssuer and resolved against the declared set: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want neither the continuation line as fund nor S000024676",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}

// ITEM 3 -- 000106/1062374/0000950129-05-008754.txt (VALIC Co II, period
// 20050630, `pvtext`). A HAZARD: 563 rows are blank today, and the only thing
// keeping them blank is an account token.
//
// THE SHAPE, IN THE BYTES. Source line 145, verbatim -- the only `VLA6` line in
// the whole filing:
//
//	Account Number: VLA6 3 Large Cap Growth Fund
//
// The registrant declares NO Large Cap Growth sleeve. Its eighteen declared
// names at CIK 0001062374 include `Large Cap Value Fund` (S000008030), and the
// style word is the discriminator this registrant uses across its own siblings:
// `Small Cap Growth Fund` (S000008021) beside `Small Cap Value Fund`
// (S000008022), `Mid Cap Growth Fund` (S000008031) beside `Mid Cap Value Fund`
// (S000008032).
//
// PROBED, through the pvtext layout's own heading entry point
// `pvTextResolveAccount`, on an index built exactly as `parsePVText` builds it
// (`issFilingIndex` over `cikDict.back`'s contemporaneous declarations for this
// CIK and period):
//
//	"VLA6 3 Large Cap Growth Fund"   -> ""                                (blank today)
//	"VLA6 Large Cap Growth Fund"     -> S000008030 "Large Cap Value Fund" (WRONG)
//	"Large Cap Growth Fund"          -> S000008030 "Large Cap Value Fund" (WRONG)
//	"VLA7 3 Large Cap Value Fund"    -> S000008030 "Large Cap Value Fund" (correct)
//	"VLA1 Small Cap Growth Fund"     -> S000008021 "Small Cap Growth Fund" (correct)
//
// So the 563 rows are blank only because the printed heading happens to carry
// the account token `3` between the code and the name. Drop that token -- which
// the same registrant does on `VLK1 Small Cap Value Fund` and
// `VLA8 Socially Responsible Fund`, both of which resolve -- and the heading
// lands on the wrong sleeve.
//
// WHICH RUNG DROPS THE STYLE WORD -- measured, not inferred. Every named rung
// was called directly on the normalized key `large cap growth fund`; exactly
// one answers:
//
//	issLeadingStemDecl -> S000008030 "Large Cap Value Fund"
//
// `issLeadingStemDecl` (`layout_issnpx.go:3793`) reads a heading that keeps a
// declared name's leading PAIR and replaces the descriptor after it. Here the
// pair is `large cap`, its second token `cap` leads five declared series so the
// family-word guard passes, and exactly one declared series leads with the pair
// -- `Large Cap Value Fund`. Every guard on the rung is satisfied and the swap
// it performs is Growth -> Value.
//
// WHY THERE IS NO BODY FIXTURE. The filing prints `VLA6 3 Large Cap Growth
// Fund` and nothing else; `grep -n VLA6` returns exactly that one line, so the
// form that exhibits the defect is NOT printed anywhere in the real bytes. Per
// the brief this is therefore a resolver-level test through the layout's own
// entry point, and it is stated as such rather than dressed up as a dispatch
// test. The dictionary fixture `valic_dict.tsv` is all 18 rows for CIK
// 0001062374 verbatim from `cik_series.tsv`.
//
// Fix location: `layout_issnpx.go`, `issLeadingStemDecl` -- when the token the
// heading swaps and the token the declaration carries are both STYLE words the
// registrant uses to separate its own declared siblings (Growth/Value,
// Income/Growth, Equity/Bond), the swap names a different fund and the rung
// must refuse. The existing family-word guard does not catch it: `cap` really
// is this registrant's family word, which is exactly why the rung fires.
func TestFamilyMislink11VALICStyleWordSwap(t *testing.T) {
	oldDict := cikDict
	t.Cleanup(func() { cikDict = oldDict })
	d, err := loadCIKSeries(filepath.Join("testdata", "family_mislink11", "valic_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	cikDict = d
	meta := FilingMeta{CIK: "0001062374", CompanyName: "VALIC CO II", PeriodOfReport: "20050630"}
	cikDict.back(&meta)
	if len(meta.SeriesDecls) != 18 {
		t.Fatalf("fixture precondition: decls=%d want 18", len(meta.SeriesDecls))
	}
	ix := issFilingIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName), meta.CIK, metaPeriod(meta))
	// Preconditions: the registrant declares the Value sleeve and no Growth one,
	// and the correctly-spelled sibling headings still resolve after any fix.
	if d, _ := lookupSeriesEntry(ix.byName, "Large Cap Value Fund"); d == nil || d.SeriesID != "S000008030" {
		t.Fatalf("fixture precondition: Large Cap Value Fund is not declared as S000008030")
	}
	if d, _ := lookupSeriesEntry(ix.byName, "Large Cap Growth Fund"); d != nil {
		t.Fatalf("fixture precondition: the registrant unexpectedly declares a Large Cap Growth sleeve (%s)", d.SeriesID)
	}
	for _, heading := range []string{"VLA6 Large Cap Growth Fund", "Large Cap Growth Fund"} {
		got := ""
		if d := pvTextResolveAccount(ix, heading); d != nil {
			got = d.SeriesID + " " + d.Name
		}
		if got != "" {
			t.Errorf("a heading differing from a declared sleeve only by the style word resolves to that sleeve: heading=%q -> %s; the registrant declares no Large Cap Growth sleeve and uses Growth/Value to separate its own siblings (S000008021/S000008022, S000008031/S000008032); want blank",
				heading, got)
		}
	}
	// Control: the correctly-spelled sibling headings must keep resolving.
	for heading, want := range map[string]string{
		"VLA7 3 Large Cap Value Fund": "S000008030",
		"VLA1 Small Cap Growth Fund":  "S000008021",
	} {
		d := pvTextResolveAccount(ix, heading)
		if d == nil || d.SeriesID != want {
			t.Errorf("control heading stopped resolving: heading=%q got=%v want %s", heading, d, want)
		}
	}
}
