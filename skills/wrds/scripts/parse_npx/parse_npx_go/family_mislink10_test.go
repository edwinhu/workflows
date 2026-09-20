package main

import (
	"path/filepath"
	"testing"
)

// familyMislink10Dispatch runs the real dispatch on a family MISLINK10 fixture
// with the named dictionary rows loaded (dict == "" loads none, for a fixture
// whose own SGML header declares every series it needs), and asserts the
// fixture's own preconditions -- status, layout and row count -- so a failure
// below is an assertion about the series id and never a broken fixture.
func familyMislink10Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict = nil
	if dict != "" {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink10", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink10", fixture), sink, make([]byte, headBytes))
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

// ITEM 2 -- 000133/1331971/0001438934-17-000312.txt (John Hancock Funds II,
// period 20170630, `broadridge`).
//
// Fixture `jhf2_us_strategic_equity_allocation.txt`: verbatim source lines 1-19
// (the SGML header through the registrant's fiscal year end), then all 102
// `<SERIES>` blocks of the header trimmed to their `<SERIES>` / `<OWNER-CIK>` /
// `<SERIES-ID>` / `<SERIES-NAME>` / `</SERIES>` lines (the NS24 precedent for
// trimming a declaration block), then 3402-3408 (the header closer and the
// document opener through `<TEXT>`), 889118-889144 (the
// `JHFII U.S. Strategic Equity Allocation` banner and the J. ALEXANDER'S
// HOLDINGS block under it), 1045829-1045860 (the bare
// `Strategic Equity Allocation Fund` banner and the COSCO SHIPPING PORTS block
// under it) and the filing's own last four lines. Every byte is verbatim.
// Dispatches to `broadridge` (the precondition asserts it).
//
// NOTE ON THE FIXTURE BUDGET: 598 lines, far above the ~120-line guide, and
// this is load-bearing rather than sloppy. The defect is a property of the
// WHOLE declared set, not of any one sibling. Measured by reduction on this
// filing's own header, all other bytes held fixed:
//
//	declared series in the fixture            series on the `U.S.` section
//	S000055171 only                           S000055171 (the chassis stamps a single-series filing)
//	S000055171 + S000036500 + S000055170      S000055171  -- correct
//	those three + S000028826                  S000055171  -- correct
//	all 102 (this fixture)                    ""          -- the defect
//
// A delta-debugging pass over the 102 blocks could not find a small subset that
// reproduces it other than by dropping to the single-series case, which is a
// different mechanism (the chassis, not the resolver). The trimmed-header
// fixture is the smallest faithful reproduction.
//
// THE SHAPE. The registrant declares three separate sleeves whose names differ
// only by a leading qualifier -- source lines 2365-2366, 3366-3367 and
// 3375-3376, verbatim:
//
//	<SERIES-ID>S000036500
//	<SERIES-NAME>Strategic Equity Allocation Fund
//	<SERIES-ID>S000055170
//	<SERIES-NAME>International Strategic Equity Allocation Fund
//	<SERIES-ID>S000055171
//	<SERIES-NAME>U.S. Strategic Equity Allocation Fund
//
// and the body prints all three banners separately, at source lines 746623,
// 889118 and 1045829:
//
//	3374 JHFII International Strategic Equity Allocation Fund
//	JHFII U.S. Strategic Equity Allocation
//	Strategic Equity Allocation Fund
//
// So the 889118 section is S000055171 and the 1045829 section is S000036500.
// Measured on the current tree over the whole filing with the full 41,139-row
// dictionary:
//
//	50834 S000036500 "Strategic Equity Allocation Fund"
//	23227 S000055170 "3374 JHFII International Strategic Equity Allocation Fund"
//	22387 ""         "JHFII U.S. Strategic Equity Allocation"
//
// The `U.S.` section carries NO series at all -- 22,387 rows. (The brief for
// this batch records it as stamped S000036500; on the current tree the
// wrong-series stamp is gone and the section is blank instead. Blank is the
// better of the two failures and the assertion below is unchanged: the section
// must carry the id the header declares for the name the banner prints.)
//
// Nothing is guessed by fixing it: after the `JHFII` brand cut the remainder is
// `U.S. Strategic Equity Allocation`, which names exactly one header-declared
// series once the `Fund` suffix is allowed, and the sibling that would
// otherwise absorb it -- the bare `Strategic Equity Allocation Fund` -- is
// printed as its own banner in this same filing and keeps its own 50,834 rows.
//
// Fix location: `layout_issnpx.go`, `issResolveFundUncached` -- the rung that
// matches a brand-cut heading remainder against the header declarations must
// not lose `U.S. Strategic Equity Allocation` when the declared set is large;
// the leading qualifier that distinguishes two declared siblings is part of the
// name and must neither be dropped (which stamps the shorter sibling) nor
// disqualify the heading (which is what happens here).
func TestFamilyMislink10JHF2USStrategicEquityAllocation(t *testing.T) {
	rows := familyMislink10Dispatch(t, "jhf2_us_strategic_equity_allocation.txt", "", "broadridge", 7)
	for _, r := range rows {
		want := "S000055171"
		if r.FundName == "Strategic Equity Allocation Fund" {
			want = "S000036500"
		}
		if r.SeriesID != want {
			t.Errorf("the declared name after the brand cut is not carried to the section: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want %s",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID, want)
		}
	}
}

// ITEM 3 -- 000092/920547/0001144204-05-027209.txt (Touchstone Variable Series
// Trust, period 20050630, `broadridge`).
//
// Fixture `touchstone_balanced_vintage.txt`: verbatim source lines 1-29 (the
// SGML header through the registrant's fiscal year end), 59-70 (the header
// closer and the document opener through `<body>`), 226-250 (the
// `<pre>Touchstone Balanced Fund` banner and the ACTUANT CORP. block under it),
// then the two closing tags `  </body>` / `</html>` and the filing's own last
// three lines. Every byte is verbatim. Dispatches to `broadridge` (the
// precondition asserts it).
//
// Measured on the current tree over the whole filing with the full 41,139-row
// dictionary:
//
//	655 S000059066 "Touchstone Balanced Fund"
//
// on a filing whose period of report is 20050630. `cik_series.tsv` at CIK
// 0000920547 carries two candidates:
//
//	0000920547	S000003148	Balanced Fund	20060630
//	0000920547	S000059066	Touchstone Balanced Fund	20180630
//
// S000059066 was first declared in 2018 and cannot have voted in 2005. The
// contemporaneous sleeve of this Variable Series trust is S000003148. The
// exact-name route reaches S000059066 first and wins.
//
// S000003148 IS REACHABLE WITHOUT A GUESS, and this was measured rather than
// asserted: re-running this same fixture with the S000059066 row deleted from
// the dictionary and every other byte held fixed gives
//
//	9 S000003148	Touchstone Balanced Fund
//
// so the registrant-brand-strip route already answers the heading with the
// contemporaneous id; it only loses because the future-vintage exact name is
// consulted first. Hence the assertion is S000003148, not blank.
//
// Fix location: `layout_issnpx.go`, the exact-name route reached first by
// `icrResolveFundShared` (`seriesByName`) -- an exact hit whose declaration
// date postdates the filing's period of report must yield to a non-exact hit
// whose declaration is contemporaneous, which is the vintage principle
// `dictContemporaneous` and the MISLINK3/MISLINK5 `crossCIK` guard already
// apply on their own routes.
func TestFamilyMislink10TouchstoneBalancedVintage(t *testing.T) {
	rows := familyMislink10Dispatch(t, "touchstone_balanced_vintage.txt", "touchstone_dict.tsv", "broadridge", 9)
	for _, r := range rows {
		if r.SeriesID != "S000003148" {
			t.Errorf("a 20050630 filing carries a series first declared in 2018 because the exact-name route outranks the contemporaneous one: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want S000003148",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}

// ITEM 4 -- 000001/19034/0000950129-04-006774.txt (AIM Funds Group/DE, period
// 20040630, `issnpx`).
//
// Fixture `aim_premier_equity_ii.txt`: verbatim source lines 1-29 (the SGML
// header through the registrant's fiscal year end), 146-152 (the `<PAGE>`
// break, the `FORM N-Px REPORT` banner, the ICA file number and the reporting
// period), 24372-24393 (the ruled `AIM PREMIER EQUITY FUND II` banner and the
// AFFILIATED COMPUTER SERVICES block under it) and the filing's own last five
// lines. Every byte is verbatim. Dispatches to `issnpx` (the precondition
// asserts it).
//
// Source line 24372, verbatim:
//
//	========================== AIM PREMIER EQUITY FUND II ==========================
//
// Measured on the current tree over the whole filing with the full 41,139-row
// dictionary:
//
//	1156 S000000216 "AIM PREMIER EQUITY FUND"
//	 114 S000000216 "AIM PREMIER EQUITY FUND II"
//
// `issDistinctivePairDecl` answers the ordinalled heading with S000000216,
// whose only declared name at this CIK at ANY vintage is `AIM Premier Equity
// Fund` -- the ordinal is dropped. The registrant declares no `II` sleeve, so
// 114 rows carry a series their heading does not name, folded into the
// non-ordinal sleeve that the filing separately prints and resolves (1,156
// rows).
//
// No declared name carries the ordinal, so there is nothing to resolve to and
// the heading must be refused: blank. A wrong series is worse than a blank one.
//
// Fix location: `layout_issnpx.go`, `issDistinctivePairDecl` -- a trailing
// ordinal on the HEADING may not be dropped to reach a declared name that does
// not carry it.
func TestFamilyMislink10AIMPremierEquityFundII(t *testing.T) {
	rows := familyMislink10Dispatch(t, "aim_premier_equity_ii.txt", "aim_dict.tsv", "issnpx", 9)
	for _, r := range rows {
		if r.SeriesID != "" {
			t.Errorf("a trailing ordinal was dropped from the heading to reach a declared name that does not carry it: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want blank",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}

// ITEM 5 -- 000006/67160/0001104659-04-026391.txt (MML Series Investment Fund,
// period 20040630, `htmltable`).
//
// Fixture `mml_small_cap_equity.txt`: verbatim source lines 1-29 (the SGML
// header through the registrant's fiscal year end), 57-63 (the header closer
// and the document opener through `<TEXT>`), 570450-570588 (the
// `MML SMALL CAP EQUITY FUND` centred banner, the ACTUANT CORP identity table
// and the first three proposal rows), then the two closing tags ` </tr>` /
// `</table>` and the filing's own last five lines. Every byte is verbatim
// except those two closing tags, which close the table the cut opened.
// Dispatches to `htmltable` (the precondition asserts it).
//
// 182 lines, above the ~120-line guide: `htmltable` does not claim a body until
// three vote rows have been read, and this vendor spends 18 lines of markup per
// row. Stated rather than worked around.
//
// Source line 570452, verbatim:
//
//	<p align="center" style="margin:0in 0in .0001pt;text-align:center;"><font size="2" face="Times New Roman" style="font-size:10.0pt;">MML SMALL CAP EQUITY FUND</font></p>
//
// Measured on the current tree over the whole filing with the full 41,139-row
// dictionary:
//
//	1106 S000003827 "MML SMALL CAP GROWTH EQUITY FUND"
//	 344 S000003827 "MML SMALL CAP EQUITY FUND"
//
// S000003827's declared name at this CIK is `MML Small Cap Growth Equity Fund`,
// and the filing prints THAT banner separately and resolves it exactly (1,106
// rows). `MML SMALL CAP EQUITY FUND` only reaches the same id by dropping the
// internal token `GROWTH`, while the registrant declares other small-cap
// sleeves at this CIK -- `MML Small Cap Value Fund` (S000011478) and
// `MML Small Cap Index Fund` (S000011479), both in the fixture's dictionary --
// so the dropped-token match is not unique-safe and the bytes nowhere say the
// two banners are the same sleeve. Refuse: blank.
//
// Fix location: `layout_htmltable.go`, `htmlRefuseInexactSiblingHeading` (the
// NS24 §4 guard, which already deletes exactly this shape for AMERICAN SKANDIA
// TRUST) -- it does not fire here, so the internal-token-drop route in the
// shared chain (`layout_issnpx.go`, `issDistinctiveStemDecl` /
// `issNearMissDecl`) reaches a sibling the same filing prints and resolves
// exactly.
func TestFamilyMislink10MMLSmallCapEquityDroppedToken(t *testing.T) {
	rows := familyMislink10Dispatch(t, "mml_small_cap_equity.txt", "mml_dict.tsv", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "" {
			t.Errorf("an internal token was dropped to fold this banner onto a sibling the same filing prints and resolves exactly: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want blank",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}

// ITEM 6 -- 000081/810271/0001193125-04-147190.txt (Smith Barney Investment
// Series, period 20040630, `issnpx`).
//
// Fixture `smithbarney_two_banners.txt`: verbatim source lines 1-28 (the SGML
// header through the registrant's fiscal year end), 58-135 (the header closer,
// the document opener, the cover page, the `FORM N-Px REPORT` banner, BOTH
// ruled fund banners, the ADC TELECOMMUNICATIONS block under the second and the
// rule that closes it) and the filing's own last six lines. Every byte is
// verbatim. Dispatches to `issnpx` (the precondition asserts it).
//
// Source lines 111-119, verbatim (the blank lines are the filing's own):
//
//	=========== SMITH BARNEY INVESTMENT SERIES - SB GOVERNMENT PORTFOLIO ===========
//
//
//
//
//	========== SMITH BARNEY INVESTMENT SERIES - SB GROWTH AND INCOME FUND ==========
//
//
//	ADC TELECOMMUNICATIONS, INC.
//
// Two complete ruled banners, five lines apart. The first opens a section with
// no vote table in it at all; the second opens the vote table. The reader joins
// them, and the joined string is what every row carries. Measured on the
// current tree over the whole filing with the full 41,139-row dictionary:
//
//	869 S000008986 "SMITH BARNEY INVESTMENT SERIES - SB GOVERNMENT PORTFOLIO SMITH BARNEY INVESTMENT SERIES - SB GROWTH AND INCOME FUND"
//
// WHICH RUNG ANSWERS THE GLUED FORM. The join resolves through the registrant
// prefix strip (`-issnpx-registrant-prefix-strip`, default true): the joined
// string begins, at a token boundary, with the filing's own COMPANY CONFORMED
// NAME `SMITH BARNEY INVESTMENT SERIES`, so the lookup is retried on the
// remainder, and the FIRST banner's tail (`- SB GOVERNMENT PORTFOLIO`) is what
// survives the retry -- it reaches S000008986, the declared
// `Legg Mason Partners Variable Government Portfolio`. Batch 107's
// `issBannerWrapVisible` guard does not refuse this join because it refuses
// HEAD-ONLY prefix joins, and this is not head-only: both halves are complete
// ruled banners, each with its own `====` rule on both sides.
//
// The 869 rows belong to the SECOND banner. The first sleeve's section is
// empty. Stamping S000008986 on them is a wrong series, and a wrong series is
// worse than a blank one -- so the assertion is that the join is refused and
// the rows carry the second banner's own resolution or, failing that, nothing.
// Nothing is guessed: both banners are printed whole, on their own lines,
// between their own rules.
//
// Fix location: `layout_issnpx.go`, the banner reader that accumulates a
// wrapped banner across blank lines and the `issBannerWrapVisible` guard beside
// it -- a line that is ITSELF a complete ruled banner closes the previous
// banner rather than continuing it, whether or not the previous banner looked
// truncated.
func TestFamilyMislink10SmithBarneyTwoRuledBanners(t *testing.T) {
	rows := familyMislink10Dispatch(t, "smithbarney_two_banners.txt", "smithbarney_dict.tsv", "issnpx", 7)
	for _, r := range rows {
		if r.SeriesID == "S000008986" {
			t.Errorf("two complete ruled banners were joined and the rows took the first, empty sleeve's resolution: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want the second banner's own resolution or blank",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
