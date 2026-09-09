package main

import (
	"path/filepath"
	"testing"
)

// familyPP2Dispatch runs the real dispatch on a family PP.2 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyPP2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_pp2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_pp2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000077/770540/0001438934-11-000459.txt: 15-16 + 53-54 + 80-143 + 244-245 + 21706-21740. The broadridge
// section heading names a declared series and then the SLEEVE its votes were
// cast by:
//
//	Natixis Income Diversified Portfolio - Active
//
// for a declared "Natixis Income Diversified Portfolio" (S000006657). Nothing
// removes a trailing " - <sub-adviser>" tail before the lookup, so all three
// sleeve sections of this fund miss: 1,361 rows under "- Active", 464 under
// "- AEW" and 34 under "- Loomis (Multi Sector)", 1,859 of the filing's 9,321
// rows with a fund name and no series.
func TestFamilyPP2NatixisIncomeSleeveSuffix(t *testing.T) {
	rows := familyPP2Dispatch(t, "natixis_income_sleeve_suffix.txt", "broadridge", 11)
	for _, r := range rows {
		if r.SeriesID != "S000006657" {
			t.Errorf("Natixis Income Diversified Portfolio - Active: fund=%q series=%q want S000006657", r.FundName, r.SeriesID)
		}
	}
}

// 000077/770540/0001438934-11-000459.txt: 15-16 + 53-54 + 80-143 + 244-245 + 38656-38685. The same filing
// appends the sub-adviser to the fund name with NO separator at all, and
// respells the declared "Natixis U.S. Multi-Cap Equity Fund" (S000006658) four
// different ways while doing it:
//
//	Natixis U.S. Multi-cap Equity Fund Blackrock
//	Natixis U.S Multi-Cap Equity Fund Loomis Sm Cap
//	Natixis US Multi Cap Equity Fund  Loomis (Mid Cap)
//	Natixis U.S. Multi-cap Equity Fund Harris
//
// so both the trailing sleeve token and the dotted/hyphenated "U.S. Multi-Cap"
// have to be normalised away. 2,872 rows carry these four headings and no
// series.
func TestFamilyPP2NatixisMultiCapSubAdviserTail(t *testing.T) {
	rows := familyPP2Dispatch(t, "natixis_multicap_subadviser_tail.txt", "broadridge", 6)
	for _, r := range rows {
		if r.SeriesID != "S000006658" {
			t.Errorf("Natixis U.S. Multi-cap Equity Fund Blackrock: fund=%q series=%q want S000006658", r.FundName, r.SeriesID)
		}
	}
}

// 000077/770540/0001438934-11-000459.txt: 15-16 + 53-54 + 80-143 + 244-245 + 3785-3796 + 10430-10465. The
// last WRAPPED line of a proposal is taken for the next section's heading. The
// Hansberger section (line 3785, S000006656) runs uninterrupted until a
// proposal whose text wraps onto a short final line immediately above a block
// rule:
//
//	IIG    TO SUBSTANTIALLY REVIEW AND AMEND THE PROVISIONS          Mgmt          For                            For
//	       OF THE BY-LAWS: OTHER NECESSARY ADAPTATIONS
//	       AND IMPROVEMENTS.
//	--------------------------------------------------------------------------
//	 GAFISA S.A.                                            Agenda Number:  933332861
//
// "AND IMPROVEMENTS." becomes the heading of every block after it, and 1,430
// rows of the Hansberger section are emitted with fund_name="AND IMPROVEMENTS."
// and no series.
func TestFamilyPP2NatixisWrappedProposalHeading(t *testing.T) {
	rows := familyPP2Dispatch(t, "natixis_wrapped_proposal_heading.txt", "broadridge", 2)
	for _, r := range rows {
		if r.SeriesID != "S000006656" {
			t.Errorf("wrapped proposal heading: fund=%q series=%q want S000006656", r.FundName, r.SeriesID)
		}
	}
}

// 000137/1377031/0000910472-12-002409.txt: 15-16 + 39-122 + 124-131 + 228-324
// + 26480-26620. The
// Epiphany cover table prints the label and the fund in SEPARATE CELLS of a row
// that also carries an exhibit cell:
//
//	<TD ...><P ...><B>Registrant:<U> </U></B></P>
//	</TD><TD ... colspan="5">
//		<P style="margin:0px" align=left>EPIPHANY FUNDS - Epiphany FFV Fund</P>
//	</TD>... <P style="margin:0px" align=right>Item 1, Exhibit A </P>
//
// The two-filled-cell "Registrant:" path (layout_htmltable.go:246) demands
// exactly two filled cells, and this row has three, so the heading is never
// read: the section's rows carry NO fund name at all. The sibling section whose
// label and value share ONE cell resolves ("EPIPHANY FUNDS - FFV Latin America
// Fund" -> S000036397, 120 rows), so only the split-cell spelling misses.
// 1,441 of the filing's 1,561 rows have an empty fund_name and no series.
//
// The fixture carries that resolving sibling section too, and the whole series
// block: a cut holding only the unattributed section trips the consolidated
// fallback (main.go:651) or the single-series stamp instead, and would pass
// while the filing leaks.
func TestFamilyPP2EpiphanyRegistrantSplitCells(t *testing.T) {
	rows := familyPP2Dispatch(t, "epiphany_registrant_split_cells.txt", "htmltable", 8)
	for _, r := range rows[:3] {
		if r.SeriesID != "S000015061" {
			t.Errorf("EPIPHANY FUNDS - Epiphany FFV Fund: fund=%q series=%q want S000015061", r.FundName, r.SeriesID)
		}
	}
}

// 000140/1405458/0001035449-11-000526.txt: 15-16 + 33-138 + 140-147 + 271-440 +
// 18048-18230. The Dreman
// cover prints its first section's heading as the two declared names of ONE
// series spliced together:
//
//	Fund/Fund Family Name: Dreman High Opportunity Large Cap Value Fund
//
// The dictionary carries both halves for S000019613 -- "DREMAN HIGH OPPORTUNITY
// FUND" and "Dreman Contrarian Large Cap Value Fund" -- so the series is not
// ambiguous, but no rule matches a name that is a splice of two, and the
// heading is dropped entirely rather than kept unresolved: 631 of the filing's
// 4,424 rows carry an empty fund_name and no series. The filing's four other
// headings, each an exact declared name, resolve. The fixture carries one of
// those resolving sections as well, for the same reason the Epiphany one does.
func TestFamilyPP2DremanHighOpportunityBlend(t *testing.T) {
	rows := familyPP2Dispatch(t, "dreman_high_opportunity_blend.txt", "htmltable", 6)
	for _, r := range rows[:3] {
		if r.SeriesID != "S000019613" {
			t.Errorf("Dreman High Opportunity Large Cap Value Fund: fund=%q series=%q want S000019613", r.FundName, r.SeriesID)
		}
	}
}
