package main

import (
	"path/filepath"
	"testing"
)

// familyMislink8Dispatch runs the real dispatch on a family MISLINK8 fixture
// with the named dictionary rows loaded (dict "" means no dictionary at all)
// and asserts the fixture's own preconditions -- status and layout -- so a
// failure below is an assertion about the rows and never a broken fixture.
func familyMislink8Dispatch(t *testing.T, fixture, dict, layout string) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	if dict == "" {
		cikDict = nil
	} else {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink8", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink8", fixture), sink, make([]byte, headBytes))
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

// 000171/1710607/0001710607-23-000209.txt (AMERICAN CENTURY ETF TRUST, CIK
// 1710607, period 20220630, layout htmltable): verbatim source lines 1-16,
// 43-84, 115-124, 425-434, 578-593, 596-598, 147221-147252, 147268 and
// 258956-258994, then the filing's own last five lines. Line 147268 is the
// `</table>` that closes the table the 147221-147252 cut opened; it is the only
// byte range in the fixture that does not stand where the source prints it. The
// header is cut to SIX declared series -- the floor issDistinctivePairDecl
// requires (issDistinctivePairMinPool = 6) -- all of them ETF-suffixed, so
// ix.commonSuffix is `etf` exactly as it is on the whole filing's 68
// declarations.
//
// THE DEFECT. The filing prints one section per ETF, each opened by a bare
// centred paragraph -- source line 147221, verbatim:
//
//	<br style='page-break-after:always;'><p align='center'>Avantis Emerging Markets Equity</p>
//
// and inside the section one `<table>` per meeting, whose first row is a single
// `colSpan='5'` cell carrying the ISSUER and its meeting labels -- source lines
// 258959-258964, verbatim:
//
//	<tr>
//	<td style='font-size:10pt;font-weight:bold;' colSpan='5'>GEK TERNA HOLDING REAL ESTATE CONSTRUCTION SA
//	<br>Meeting Date:&nbsp;&nbsp;OCT 20, 2022
//	<br>Record Date:&nbsp;&nbsp;OCT 14, 2022
//	<br>Meeting Type:&nbsp;&nbsp;EXTRAORDINARY SHAREHOLDERS
//	</td>
//	</tr>
//
// That row has ONE filled cell, so parseHTMLTableRaw (layout_htmltable.go:337)
// treats it as a section heading and offers it to htmlBareFundLine, which reads
// its first line as a candidate fund name. The resolution chain then answers:
//
//	issResolveFundUncached (layout_issnpx.go:3410) -- the heading carries no type
//	  word, so the registrant's shared last word is appended and the whole chain
//	  is retried on `GEK TERNA HOLDING REAL ESTATE CONSTRUCTION SA ETF`;
//	issDistinctivePairDecl (layout_issnpx.go:3290) -- the adjacent ordered pair
//	  `real estate` sits in exactly one declared name, `Avantis Real Estate ETF`
//	  (S000072999), so that series is returned.
//
// The issuer line becomes the section banner. Measured on the whole filing with
// the corpus dictionary loaded, S000072999 carries 25 distinct fund_name values
// and 24 of them are ISSUER names, every one containing REAL ESTATE:
//
//	22276  "ANYWHERE REAL ESTATE, INC."       30946  "BLUE SQUARE REAL ESTATE LTD."
//	32156  "INSTONE REAL ESTATE GROUP SE"     28732  "MIVNE REAL ESTATE (K.D) LTD."
//	23725  "SUMMIT REAL ESTATE HOLDINGS LTD."  6198  "GEK TERNA HOLDING REAL ESTATE CONSTRUCTION SA"
//	  ...  (18 more)                            120  "Avantis Real Estate ETF"
//
// Only 120 of the 228,448 rows stamped S000072999 carry the fund's own printed
// name. The promotion is STICKY -- it replaces curFund/curSeries -- so every
// later meeting of the section inherits it until the next centred paragraph,
// which is why a handful of issuer lines carry tens of thousands of rows. The
// rows belong to the ETF section they stand in: the GEK TERNA blocks at source
// lines 258956 and 596036 stand inside `Avantis Emerging Markets Equity`
// (source line 147221) and `Avantis Emerging Markets Equity ETF` (source line
// 477491), never inside `Avantis Real Estate ETF` (source line 2232442).
//
// FIX LOCATION. layout_htmltable.go, parseHTMLTableRaw, the single-filled-cell
// heading branch at layout_htmltable.go:337-397 (the call to htmlBareFundLine
// at :368 and the adoption at :396-397): a cell whose FIRST line is followed,
// inside the same cell, by this vendor's issuer-identity labels (`Meeting
// Date:` / `Record Date:` / `Meeting Type:`) is an issuer identity block and
// never a section heading, so it must not be offered to htmlBareFundLine at
// all. The evidence is printed in the cell itself, so nothing is guessed. The
// enclosing section's fund and series must survive the block unchanged.
//
// Rows affected: 228,448 rows stamped S000072999 on this filing, of which
// 228,328 carry an issuer name as their fund_name.
func TestFamilyMislink8AmericanCenturyIssuerLineBecomesBanner(t *testing.T) {
	rows := familyMislink8Dispatch(t, "american_century_issuer_banner.txt", "", "htmltable")
	if len(rows) != 3 {
		t.Fatalf("fixture precondition: rows=%d want 3", len(rows))
	}
	// Row 0 is the 360 DIGITECH block (source lines 147226-147252), the first
	// meeting of the section, and it is the stable half of the fixture: it
	// carries the section banner as printed.
	if rows[0].FundName != "Avantis Emerging Markets Equity" || rows[0].SeriesID != "S000066454" {
		t.Fatalf("fixture precondition: row 0 fund=%q series=%q, want \"Avantis Emerging Markets Equity\" / S000066454", rows[0].FundName, rows[0].SeriesID)
	}
	for i, r := range rows[1:] {
		if r.IssuerName != "GEK TERNA HOLDING REAL ESTATE CONSTRUCTION SA" {
			t.Fatalf("fixture precondition: row %d issuer=%q, want the GEK TERNA block", i+1, r.IssuerName)
		}
		if r.FundName == r.IssuerName {
			t.Errorf("the issuer line was promoted to the fund banner: row %d fund=%q series=%q issuer=%q. `GEK TERNA HOLDING REAL ESTATE CONSTRUCTION SA` is the issuer printed in the block's own identity cell (source line 258960), not a fund of AMERICAN CENTURY ETF TRUST; it resolves to S000072999 `Avantis Real Estate ETF` only because the commonSuffix retry (layout_issnpx.go:3410) appends the registrant's shared `ETF` and issDistinctivePairDecl (layout_issnpx.go:3290) then finds the pair `real estate` in exactly one declared name", i+1, r.FundName, r.SeriesID, r.IssuerName)
		}
		if r.FundName != "Avantis Emerging Markets Equity" || r.SeriesID != "S000066454" {
			t.Errorf("the GEK TERNA block lost its enclosing section: row %d fund=%q series=%q, want \"Avantis Emerging Markets Equity\" / S000066454 (source line 147221, the centred paragraph this block stands under)", i+1, r.FundName, r.SeriesID)
		}
	}
}

// 000133/1331971/0001438934-21-000135.txt (John Hancock Funds II, CIK 1331971,
// period 20200630, layout broadridge): verbatim source lines 1-16, 41-42,
// 1692-1700, 2490-2498, 2624-2660 and 31408-31450, then the filing's own last
// four lines. The header is cut to the TWO declared series the defect turns on;
// no dictionary is loaded, because both names are declared in the filing's own
// header and cik_series.tsv agrees with it (`0001331971 S000055170
// International Strategic Equity Allocation Fund 20190630`).
//
// THE DEFECT. The filing prints one Broadridge section per fund, each headed by
// an account code, the agent's brand and the fund name -- source line 31408,
// verbatim:
//
//	2X2K JHF II Strategic Equity Allocation Fund
//
// and, 1,014,321 lines later, source line 1045729, verbatim:
//
//	3374 JHFII International Strategic Equity Allocation Fund
//
// Both sections are stamped S000055170. Only the SECOND is right: the header
// declares `International Strategic Equity Allocation Fund` as S000055170
// (source lines 2492-2493) and `Strategic Equity Allocation Fund` as
// S000036500 (source lines 1694-1695), and the dictionary carries the same
// pair for this CIK. The first heading spells S000036500's name exactly once
// its account code and the agent brand are cut.
//
// WHY, read off the resolution chain on the printed heading:
//
//	issLeadingCodeToken (layout_issnpx.go:2782) cuts the account code `2X2K`,
//	  leaving `JHF II Strategic Equity Allocation Fund`;
//	the John Hancock rung (layout_issnpx.go:2650-2655) cuts `JHF` and ONLY
//	  `JHF`, leaving `II Strategic Equity Allocation Fund` -- the registrant's
//	  own ordinal (COMPANY CONFORMED NAME `John Hancock Funds II`) left standing
//	  as if it were a word of the fund name;
//	issVowelDroppedAbbrev (layout_issnpx.go:2551) then reads that `II` as an
//	  abbreviation of the declared `International`, and answers S000055170.
//
// The sibling section `3374 JHFII ...` glues the ordinal to the brand, so its
// cut leaves the declared name entire and it resolves correctly -- which is why
// the two sections collide on one series rather than one of them staying blank.
//
// FIX LOCATION. layout_issnpx.go, issResolveFundUncached, the John Hancock rung
// at layout_issnpx.go:2650-2655: the agent brand this registrant prints is the
// brand token PLUS the registrant's own ordinal (`JHF II` for `John Hancock
// Funds II`, exactly as the sibling section's `JHFII` glues it), so the strip
// must consume the ordinal when the registrant's own name ends in it. The
// alternative placement is issVowelDroppedAbbrev (layout_issnpx.go:2551),
// refusing a heading token that is the registrant's own trailing ordinal; the
// first is the narrower change.
//
// Rows affected: 79,614 rows stamped S000055170 on this filing carry one of the
// two fund names; the `2X2K JHF II Strategic Equity Allocation Fund` half of
// them holds a wrong series_id.
func TestFamilyMislink8JohnHancockOrdinalReadAsInternational(t *testing.T) {
	rows := familyMislink8Dispatch(t, "john_hancock_strategic_equity.txt", "", "broadridge")
	if len(rows) == 0 {
		t.Fatalf("fixture precondition: no rows")
	}
	for i, r := range rows {
		if r.FundName != "2X2K JHF II Strategic Equity Allocation Fund" {
			t.Fatalf("fixture precondition: row %d fund=%q, want the `2X2K JHF II Strategic Equity Allocation Fund` section (source line 31408)", i, r.FundName)
		}
		if r.SeriesID == "S000055170" {
			t.Errorf("the `2X2K JHF II Strategic Equity Allocation Fund` section took the SIBLING's series: row %d series=%q issuer=%q desc=%.40q. S000055170 is the declared `International Strategic Equity Allocation Fund` (source lines 2492-2493), which this filing gives its own section at source line 1045729 (`3374 JHFII International Strategic Equity Allocation Fund`). This heading prints no `International`: after `2X2K` and `JHF` are cut, the registrant's own ordinal `II` is left standing and issVowelDroppedAbbrev (layout_issnpx.go:2551) reads it as that word. Want S000036500 (the declared `Strategic Equity Allocation Fund`, source lines 1694-1695) or blank", i, r.SeriesID, r.IssuerName, r.VoteDescription)
		}
	}
}
