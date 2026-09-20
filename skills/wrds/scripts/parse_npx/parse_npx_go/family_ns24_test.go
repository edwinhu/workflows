package main

import (
	"path/filepath"
	"testing"
)

// familyNS24Dispatch runs the real dispatch on a family NS24 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS24Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns24", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns24", fixture), sink, make([]byte, headBytes))
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

// 000092/920547/0001144204-05-027209.txt: verbatim source lines 1-29 (the SEC
// header through the registrant's fiscal year end), 59-70 (the header closer
// and the document opener through `<body>`), 31871-31895 (the
// `<pre>Touchstone Third Avenue Value Fund` banner, the AGRIUM block under it
// and its first proposals), 32398-32425 (the tail of the TECK/FORDING
// proposals, the rule, and the FOREST CITY block that follows) and the
// filing's own last six lines. Every byte is verbatim. Dispatches to
// `broadridge` (the precondition asserts it).
//
// Touchstone Variable Series Trust, period 20050630, `broadridge`. Measured on
// the current tree with the full 41,139-row dictionary:
//
//	=== 000092/920547/0001144204-05-027209.txt layout=broadridge status=ok rows=3131 blank=1844
//	     221 S000003142 "Touchstone Third Avenue Value Fund"
//	     216 blank      "ATTACHED AS APPENDIX  C  TO THE CIRCULAR"
//	     191 blank      "04  STOCKHOLDER PROPOSAL - NOMINATION OF DIRECTORS  Shr  Against  For"
//	     155 blank      "07  APPROVAL OF SHAREOWNER PROPOSAL FOUR  Shr  Against  For"
//	     113 blank      "DENNIS P. LOCKHART  Mgmt  No vote"
//
// 1,844 of 3,131 rows -- exactly the pool count for this filing -- carry a
// "fund name" that is not a fund name at all but the text of the proposal
// printed immediately above the issuer rule. This is an ATTRIBUTION defect:
// the banner reader takes the last line before the `- ----...` rule that opens
// an issuer block as the section's fund banner, and in this vendor's grammar
// that line is often the wrapped continuation of the PREVIOUS issuer's last
// proposal. Source lines 32400-32409, verbatim:
//
//	03     APPOINTMENT OF AUDITORS RESOLUTION                        Mgmt          For                            For
//	04     THE APPROVAL OF THE  ARRANGEMENT RESOLUTION               Mgmt          For                            For
//	       ATTACHED AS APPENDIX  A  TO THE CIRCULAR
//	05     THE APPROVAL OF THE  SUBDIVISION RESOLUTION               Mgmt          For                            For
//	       ATTACHED AS APPENDIX  B  TO THE CIRCULAR
//	06     THE APPROVAL OF  THE  FORDING ARTICLES RESOLUTION         Mgmt          For                            For
//	       ATTACHED AS APPENDIX  C  TO THE CIRCULAR
//	- --------------------------------------------------------------------------------------------------------------------------
//	 FOREST CITY ENTERPRISES, INC.                                                               Agenda Number:  932342556
//	- --------------------------------------------------------------------------------------------------------------------------
//
// against the real banner, source lines 31871-31872, verbatim:
//
//	    <pre>Touchstone Third Avenue Value Fund
//	- --------------------------------------------------------------------------------------------------------------------------
//
// The governing fund for the FOREST CITY block is the one the filing last
// named, `Touchstone Third Avenue Value Fund`, and that heading RESOLVES on
// the current tree -- the 221 rows above it carry S000003142. PROBED, not
// judged by eye, against this filing's own index (24 dictionary-backfilled
// decls):
//
//	icrResolveFundShared(ix, "Touchstone Third Avenue Value Fund")     -> "S000003142"
//	icrResolveFundShared(ix, "ATTACHED AS APPENDIX  C  TO THE CIRCULAR") -> ""
//	  issDistinctivePairDecl / issDistinctiveTokenDecl / issDistinctiveStemDecl
//	  issAbbrevStemDecl / issWidthTruncatedDecl / issNearMissDecl / crossCIK -> nil
//
// so nothing is guessed: the fix is to stop promoting a proposal continuation
// to a banner, after which the section keeps the fund it already had.
//
// Fix location: `layout_broadridge.go`, the fund-banner reader that promotes
// the line above an issuer rule (the same reader NS21 taught to keep the
// banner above unindented boilerplate prose). A line that is INDENTED under,
// and immediately follows, a numbered proposal row of the block still open is
// that proposal's wrapped text, never a fund banner.
func TestFamilyNS24TouchstoneProposalContinuationBanner(t *testing.T) {
	rows := familyNS24Dispatch(t, "touchstone_proposal_continuation_banner.txt", "touchstone_dict.tsv", "broadridge", 26)
	for _, r := range rows {
		if r.SeriesID != "S000003142" {
			t.Errorf("a wrapped proposal continuation was promoted to the fund banner and the section lost its fund: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want S000003142",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000088/881166/0000881166-10-000014.txt: verbatim source lines 11-29 (the SEC
// header through the registrant's fiscal year end), 58-63, 79-83, 99-103 and
// 119 (the series-data openers and the `S000010236`, `S000010239` and
// `S000010240` `<SERIES>` blocks trimmed to their id/name lines and closers),
// 180-193 and 200-206 (the header closers, the document opener and the cover
// page's form title), 230-300 (the `<b>SMRI Growth</b>` banner and the MARVELL
// TECHNOLOGY GROUP block after it, cut at the third proposal because htmltable
// claims a body only from three vote rows) and the filing's own last four
// lines. Every byte is verbatim. Dispatches to `htmltable` (the precondition
// asserts it).
//
// SM&R Investments, Inc., period 20100630, `htmltable`. Measured on the
// current tree with the full 41,139-row dictionary:
//
//	=== 000088/881166/0000881166-10-000014.txt layout=htmltable status=ok rows=3441 blank=2389
//	    2389 blank      ""
//	    1052 S000010239 "SMRI Equity Income"
//
// 2,389 of 3,441 rows -- exactly the pool count for this filing -- carry an
// EMPTY fund name. The filing prints exactly three fund banners, source lines
// 235, 22234 and 47666, and `grep -n SMRI` returns no others:
//
//	235:<b>SMRI Growth</b><br>
//	22234:<b>SMRI Balanced</b><br>
//	47666:<b>SMRI Equity Income</b><br>
//
// Only the third is promoted. The banner reader promotes a bare line only when
// it RESOLVES, so this is a NAMING gap that presents as an attribution one:
// the vendor prints the registrant's brand as `SMRI` where every declared name
// prints it as `SM&R`, and drops the `Fund` suffix. PROBED, not judged by eye,
// against this filing's own index (the header declares seven series):
//
//	icrResolveFundShared(ix, "SMRI Equity Income") -> "S000010239"   (issDistinctivePairDecl)
//	icrResolveFundShared(ix, "SMRI Growth")        -> ""             (every rung + crossCIK nil)
//	icrResolveFundShared(ix, "SMRI Balanced")      -> ""             (every rung + crossCIK nil)
//	icrResolveFundShared(ix, "SM&R Growth Fund")   -> "S000010236"   (issNearMissDecl)
//
// `Equity Income` is a distinctive PAIR and answers; `Growth` and `Balanced`
// are single tokens and no rung will take them. Nothing is guessed by fixing
// it: among the SEVEN names this filing's own header declares -- SM&R Growth,
// Equity Income, Balanced, Government Bond, Primary, Tax Free and Money Market
// -- `Growth` names exactly one and `Balanced` names exactly one (the Alger
// Growth sleeves at this CIK are NOT declared in this filing).
//
// Fix location: `layout_htmltable.go`, `htmlBareFundLine` -> the shared chain
// in `layout_issnpx.go`: a heading whose lead token is a compacted form of the
// registrant's own brand (`SMRI` for `SM&R INVESTMENTS, INC.`) must be read
// with that brand stripped from both sides, after which the remainder must
// name exactly one DECLARED series or the heading is refused.
func TestFamilyNS24SMRBrandCompactedBanner(t *testing.T) {
	rows := familyNS24Dispatch(t, "smr_smri_brand_banner.txt", "smr_dict.tsv", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000010236" {
			t.Errorf("the banner prints the registrant's brand compacted and no rung takes the single remaining token, so the banner is never promoted: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want S000010236",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
		}
	}
}
