package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 000105/1053425/0001144204-11-049914.txt (HARTFORD SERIES FUND INC, CIK
// 1053425, period 20110630, manifest layout `icr`): 1,978 of the filing's
// 38,108 rows carry no series_id, measured on HEAD with the corpus's own
// cik_series.tsv and series_map_applied.tsv loaded (2026-09-26). This is what
// is LEFT after family NS-1053425-icr-g1-tail-banner (832a86fb), which fixed a
// different shape in the CIK's 2007 filing; nothing here is that shape.
//
// ONE LINE OWNS ALL 1,978 ROWS. Source line 89716, the only `Fund Name` line
// anywhere in this 5.9 MB filing:
//
//	Fund Name : Hartford VA SCGInter / Hartford VA Sm Cos / Hartfo
//
// That value is a SUB-ADVISER'S POOLED ACCOUNT LABEL, slash-joined across
// several of the adviser's Hartford variable-annuity accounts and cut off by
// the vendor's own 50-character field width mid-word (`Hartfo`). None of its
// components is a declared series of this registrant: the filing's SGML header
// declares 30 series and not one is spelled `Hartford VA ...`. So
// icrResolveFundShared answers nothing, icrJoinWrappedFundValue has no
// continuation to join (source line 89717 is blank and 89718 is `Date of
// fiscal year end: 06/30/2011`), and icrCaptionFundAbove finds no
// `<FUND> - <SUB-ADVISER>` caption. curSeries is therefore CLEARED, by the
// rule layout_icr.go:594 states outright -- "An unresolved marker CLEARS
// rather than leaving the previous fund standing" -- and every row of the
// 6,551-line block that follows is emitted blank, stamped with the pooled
// label as its fund_name.
//
// THE BLOCK IS BRACKETED, AND BOTH BRACKETS NAME THE SAME DECLARED SERIES.
// This filing prints 19 Hartford fund sections in alphabetical order, each
// opened by a bare heading above an `Investment Company Report` line (the
// icrReportLine rung). The pooled-banner block is not one of them: it is a
// THIRD sub-advised sleeve wedged inside the Small Company run, with no
// `<PAGE>` and no heading separating it from the sleeve above. Source lines:
//
//	86295  Hartford Small Company HLS Fund
//	86296  (This portion sub-advised by Wellington Management Company, LLC)
//	86297  Investment Company Report
//	  ...  113 issuers, 1,066 ballots
//	89710  </TABLE>
//	89712  Item 1: Proxy Voting Record - Item1 Proxy Voting Record -
//	89714  Registrant :                       <- empty
//	89716  Fund Name : Hartford VA SCGInter / Hartford VA Sm Cos / Hartfo
//	  ...  235 issuers, 1,978 ballots, ALL BLANK
//	96263  </TABLE>
//	96265  Hartford Small Company HLS Fund
//	96266  (This portion sub-advised by Hartford Investment Management Company)
//	96267  Investment Company Report
//	  ...  33 issuers, 179 ballots
//
// The whole-filing run prints that bracket exactly, `awk -F'\t' '{print
// $8"\t"$10}' | uniq -c` over the 17 sections that emit rows:
//
//	1066  S000003220  Hartford Small Company HLS Fund
//	1978              Hartford VA SCGInter / Hartford VA Sm Cos / Hartfo
//	 179  S000003220  Hartford Small Company HLS Fund
//
// SO THIS IS NOT A FLOOR. A pooled banner normally is one -- when the heading
// names several DECLARED series the votes cannot be split between them. This
// one pools labels that name no declared series at all, and the filing answers
// the question structurally instead: the sleeve before it and the sleeve after
// it are both HARTFORD SMALL COMPANY HLS FUND, S000003220, and no other
// declared series is unaccounted for. All 11 American Funds HLS series print
// their own `no matters relating to a portfolio security` sections at source
// lines 104195-104305, and the other 18 Hartford series each have a section of
// their own, so nothing else in the header could own these rows.
//
// The holdings agree: the block's 235 issuers are US small caps (99 Cents Only
// Stores, Aaon, Acuity Brands, Amerisafe, Zoll Medical -- 234 of 241 meetings
// `United States`, 5 Canada), 14 of them shared with the Wellington sleeve and
// 0 with the HIMCO sleeve, which is a distinct sleeve of the same small-cap
// mandate rather than a reprint of either. The CIK's 2010 filing
// (0000950123-10-081547) prints the Small Company fund with only the two named
// sub-advised portions and no pooled block at all, so the sleeve arrives in
// 2011 and the vendor that printed it is the one whose template labels
// accounts, not funds.
//
// THE FIX IS NOT "STOP CLEARING". layout_icr.go:592-599 is right that an
// unresolved marker must not silently leave a previous fund standing -- a
// wrong series id is worse than a blank one, and that rule is load-bearing
// across the corpus. What this filing adds is evidence the rule cannot see: a
// marker whose value resolves to nothing, whose block is enclosed by sections
// that resolve to ONE AND THE SAME declared series both before and after it
// (the look-behind of icrCaptionFundAbove and the look-ahead rung added for
// family NS-1020425-blank-trustname-masthead-lookahead, agreeing), is a sleeve
// of that fund. Agreement is the whole condition: if the two brackets named
// different series, or either resolved ambiguously, or a section end
// intervened, clearing would still be the only safe answer.
//
// THE ASSERTION BELOW IS FIX-DIRECTION-AGNOSTIC. It requires only the series
// id, never the fund_name -- keeping the pooled label as the printed fund_name
// while stamping S000003220 is a perfectly good fix, and so is replacing it
// with the enclosing heading.
//
// SEPARATELY, AND NOT ASSERTED HERE: 15 of the CIK's 1,993 open rows are in
// the 2007 filing (0000950135-07-005427), the residue of family
// NS-1053425-icr-g1-tail-banner -- 7 rows whose fund_name is a run-on legend
// line (`FIX  Annual  Management  Yes  For  For  For`), 5 a settlement-table
// header, 3 the tail of a nil-report sentence. Those are not this grammar and
// belong to whatever closes out that family.
func TestFamilyNS1053425ICRPooledSubadviserBanner(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	// Verbatim from the filing's own SGML header (source lines 208-209). Only
	// the one series the cut names is listed: no dictionary and no overlay is
	// loaded, so nothing below depends on a lookup.
	meta := FilingMeta{
		CIK:            "0001053425",
		CompanyName:    "HARTFORD SERIES FUND INC",
		PeriodOfReport: "20110630",
		SeriesDecls: []SeriesDecl{
			{SeriesID: "S000003220", Name: "HARTFORD SMALL COMPANY HLS FUND"},
		},
	}

	const (
		// One contiguous cut of the filing's own bytes, source lines
		// 86293-89794: the `<PAGE>` that opens the Wellington sleeve, that
		// whole sleeve, the seam, the pooled banner, and the first three
		// meetings of the block it governs. No seams and nothing added.
		sourceLines  = "86293-89794"
		fixture      = "hls2011_smallcompany_pooled_banner.txt"
		enclosing    = "Hartford Small Company HLS Fund"
		enclosingID  = "S000003220"
		pooledBanner = "Hartford VA SCGInter / Hartford VA Sm Cos / Hartfo"
		// The Wellington sleeve emits 1,066 rows in the whole-filing run and
		// the same 1,066 in this cut, plus the 21 ballots of the pooled block's
		// first three meetings, which is how the cut is known to span the
		// bracket entire rather than part of it. Counted on the rows the cut
		// emits, never on their series_id: a fix that stamps the enclosing id
		// and one that also rewrites fund_name are equally good (see above), so
		// the guard must not read either field.
		wantRows = 1066 + 21
	)

	b, err := os.ReadFile(filepath.Join("testdata", "family_ns1053425_icr_pooled_subadviser_banner", fixture))
	if err != nil {
		t.Fatal(err)
	}
	// The filing's manifest layout is `icr` and parseICR is the reader that
	// produced the 1,978 measured above, so the reader is named rather than
	// re-decided from a cut of the body.
	rows, err := parseICR(string(stripHTML(b)), meta)
	if err != nil {
		t.Fatal(err)
	}

	// Fixture guards. If the cut lost either end of the bracket, the assertion
	// below would be about something other than this defect.
	if !strings.Contains(string(b), pooledBanner) {
		t.Fatalf("fixture guard: the cut does not contain %q -- source lines %s no longer reach the banner at 89716", pooledBanner, sourceLines)
	}
	if !strings.Contains(string(b), enclosing) {
		t.Fatalf("fixture guard: the cut does not contain the enclosing heading %q -- source lines %s no longer start at 86295", enclosing, sourceLines)
	}
	if len(rows) != wantRows {
		t.Fatalf("fixture guard: the cut emits %d rows, want %d -- the Wellington sleeve at source lines 86295-89710 plus the pooled block's first three meetings no longer read whole, so the cut is broken rather than the grammar", len(rows), wantRows)
	}
	// No series but the enclosing one is reachable from this cut: the registrant
	// declares exactly one series here, so any other id would mean a row was
	// stamped from something other than the bracket.
	for _, r := range rows {
		if r.SeriesID != "" && r.SeriesID != enclosingID {
			t.Fatalf("fixture guard: row issuer=%q carries series_id %q, but %s is the only series this cut can name", r.IssuerName, r.SeriesID, enclosingID)
		}
	}

	// THE DEFECT. Every row the pooled banner governs is a ballot of the sleeve
	// the filing wraps it in, and the filing names that sleeve twice.
	blank := 0
	var first VoteRow
	for _, r := range rows {
		if r.SeriesID != "" {
			continue
		}
		if blank == 0 {
			first = r
		}
		blank++
	}
	if blank > 0 {
		t.Errorf("%d of %d rows carry no series_id; the first is issuer=%q cusip=%q meeting=%q item=%q desc=%q fund=%q.\n"+
			"  The pooled label at source line 89716 names no declared series of this registrant, so it cleared the fund and nothing reopened it.\n"+
			"  These rows belong to %s (%s): the filing prints that heading at source line 86295, immediately above this block with no page break, and again at 96265 immediately below it -- one and the same declared series on both sides, with every other declared series accounted for by a section of its own.",
			blank, len(rows), first.IssuerName, first.CUSIP, first.MeetingDate, first.ItemSeq, first.VoteDescription, first.FundName, enclosing, enclosingID)
	}
}
