package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const ns1137360LicenseesDir = "family_ns1137360_gazprom_licensees_prose"

// ns1137360LicenseesDispatch runs the real dispatch on this family's fixture with
// the registrant's own three real cik_series.tsv rows for S000009191 loaded
// through loadCIKSeries -- the same loader the grid runs use, so byNameAll is
// built exactly as production builds it. The dictionary is what supplies this
// section's id: the filing prints the section's fund as `GOLD MINERS FUND`
// (source line 20052), which its own SGML header never spells -- the header
// declares `MARKET VECTORS - GOLD MINERS ETF` -- so with no dictionary loaded
// every row of the section carries a blank id and the assertion below would be
// vacuous. Measured against the corpus binary (parse_npx_go_414, full
// cik_series.tsv, no overlay), this harness reproduces the same 38 rows with the
// same ids and fund names as the WRDS run over this fixture.
func ns1137360LicenseesDispatch(t *testing.T, fixture, layout string) (FilingMeta, []VoteRow) {
	t.Helper()
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	// Verbatim rows of /scratch/nyu/eddyhu/npx-reconcile-corpus/cik_series.tsv for
	// CIK 0001137360 / S000009191, the only series this fixture's section needs.
	p := filepath.Join(t.TempDir(), "cik_series_1137360.tsv")
	body := "0001137360\tS000009191\tGold Miners Index Fund\t20070630\t000113/1137360/0000869178-07-000073.txt\n" +
		"0001137360\tS000009191\tMARKET VECTORS GOLD MINERS ETF\t20080630\t000113/1137360/0001137360-10-000193.txt\n" +
		"0001137360\tS000009191\tMARKET VECTORS - GOLD MINERS ETF\t20090828\t000113/1137360/0001137360-09-000028.txt\n"
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatalf("dictionary fixture: %v", err)
	}
	dict, err := loadCIKSeries(p)
	if err != nil {
		t.Fatalf("dictionary fixture: %v", err)
	}
	cikDict, seriesMap = dict, nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", ns1137360LicenseesDir, fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || meta.CIK != "0001137360" {
		t.Fatalf("fixture/dispatch precondition: cik=%s status=%s layout=%s want cik=0001137360 status=ok layout=%s error=%s",
			meta.CIK, meta.ParseStatus, meta.Layout, layout, meta.ErrorMsg)
	}
	return meta, sink.buf
}

// MARKET VECTORS ETF TRUST (Van Eck), CIK 1137360, period 20090828, accession
// 0001137360-09-000028, layout `proxyedge`. This one filing is the CIK's entire
// ranked no-series residue: measured with parse_npx_go_414 over the whole filing
// on WRDS (full cik_series.tsv + series_map_applied.tsv), 651 of its 1582 rows
// carry a blank series id, and they split into exactly two fund names --
//
//	553  Mezhregiongaz and Gazpromipoteka Fund [the Licensees]
//	 98  Market Vectors Alternative Energy ETF
//
// Only the first is this test's business. The 98 `Market Vectors Alternative
// Energy ETF` rows are a separate, unrelated defect (a real banner this
// registrant's dictionary does not answer) and nothing here touches them.
//
// THE SHAPE. The document is one page-table per printed page. Source line 20018
// opens the section with the banner `Market Vectors Gold Miners ETF` and line
// 20052 prints the section's own fund line, `GOLD MINERS FUND`, which is what
// every row of the section carries as fund_name; it resolves to S000009191
// through the registrant's dictionary. Deep inside that section, source line
// 45292 opens the `GAZPROM O A O` issuer block, whose ballot runs to roughly 150
// numbered proposals. Item 7.101 (source line 47635) is a Contractors/Licensees
// item: an ordinary approval of a related-party agreement whose
// proposal-description cell, a plain (non border-bottom) table cell, wraps across
// twenty printed lines naming nineteen Gazprom subsidiaries. Source line 47647 is
// one of those wrapped lines, verbatim:
//
//	Mezhregiongaz and Gazpromipoteka Fund [the Licensees]
//
// `Gazpromipoteka Fund` is the last counterparty in the list and `[the Licensees]`
// is the defined term for the whole list. The same page carries the identical
// pattern one item earlier -- item 7.100's wrapped line at source line 47622 ends
// `[the Contractors] pursuant to which the Contractors undertake to` -- and that
// one causes no damage, because the word before the bracket is not `Fund`.
//
// THE DEFECT. Something in the fund-banner detection reads source line 47647 as a
// masthead and closes the open section on it. Everything printed after it loses
// S000009191 and is stamped with the proposal prose as its fund name, so it
// resolves to nothing. On the whole filing that is 553 rows, running from this
// line to the next banner the parser does accept (`Market Vectors Nuclear Energy
// ETF`, source line 71164). The Gazprom ballot itself emits only two rows either
// way -- that its other ~150 items produce none is a different question, not
// asked here.
//
// FIXTURE. market_vectors_gazprom_licensees_2009.txt is 2679 lines, every one of
// them real bytes of the filing, cut as whole page-tables so no markup is left
// open. One-based inclusive source ranges, concatenated in source order:
//
//	fixture    1-414  = source     1-414   SEC header, all 34 SERIES declarations, <DOCUMENT>/<html>/<body>
//	fixture  415-728  = source 20014-20327 the section's page-table: banner (20018) and `GOLD MINERS FUND` (20052)
//	fixture  729-1407 = source 44855-45533 the GAZPROM O A O identity block (45292) and its first ballots
//	fixture 1408-1826 = source 47587-48005 the page carrying item 7.100 (47622) and item 7.101 (47635/47647)
//	fixture 1827-2674 = source 48006-48853 the next issuers: GOLDEN AGRI-RESOURCES, HITACHI METALS, HOKUETSU PAPER MILLS
//	fixture 2675-2679 = the five closing lines </body> </html> </TEXT> </DOCUMENT> </SEC-DOCUMENT>
//
// The ~19.5k source lines between the section banner and the Gazprom block, and
// the ~2.1k between the Gazprom identity block and item 7.101, are dropped whole
// pages. Dropping them changes nothing this test measures: the fixture through
// the real dispatch produces 38 rows whose ids and fund names match the corpus
// binary's output over the same bytes on WRDS, and reproduces the defect exactly
// -- 6 rows S000009191/`GOLD MINERS FUND`, then 32 rows blank/`Mezhregiongaz and
// Gazpromipoteka Fund [the Licensees]`.
//
// ONE THING THE FIXTURE DOES NOT CARRY. In the real filing the banner standing
// over the Gazprom block is `Market Vectors Hard Assets Producers` (source line
// 35297), which HEAD does not resolve at all -- it opens no section, so the
// preceding Gold Miners section simply runs on through Gazprom and those rows
// carry S000009191 in production too. That unresolved banner is a third,
// independent defect of this filing; it is left out so this test measures the
// reset and only the reset. The assertion is therefore written as an
// EQUALITY against the rows the fixture emits before item 7.101 rather than a
// hard-coded id: whatever identity the section holds when the Gazprom ballot
// begins is the identity the rows after item 7.101 must still have.
//
// No production code is changed here.
func TestFamilyNS1137360GazpromLicenseesProseBanner(t *testing.T) {
	// OBSERVED ON HEAD: status=ok layout=proxyedge rows=38 -- rows 1-6
	// S000009191/`GOLD MINERS FUND` (GALP ENERGIA, GAMESA, GAZPROM O A O), rows 7-38
	// blank id and fund name `Mezhregiongaz and Gazpromipoteka Fund [the Licensees]`.
	_, rows := ns1137360LicenseesDispatch(t, "market_vectors_gazprom_licensees_2009.txt", "proxyedge")
	if len(rows) == 0 {
		t.Fatalf("fixture emitted no rows")
	}

	// The anchor is the last row the filing prints BEFORE item 7.101: the second of
	// the two GAZPROM O A O ballots. Its identity is the section's identity.
	anchor := -1
	for i, r := range rows {
		if r.IssuerName == "GAZPROM O A O" {
			anchor = i
		}
	}
	if anchor < 0 {
		t.Fatalf("fixture precondition: no GAZPROM O A O row emitted, so there is no pre-7.101 anchor to compare against")
	}
	wantSeries, wantFund := rows[anchor].SeriesID, rows[anchor].FundName
	if wantSeries == "" || wantFund == "" {
		t.Fatalf("fixture precondition: the anchor row (row %d, %s) carries series=%q fund=%q -- the section must be open and resolved before item 7.101 for this test to mean anything",
			anchor+1, rows[anchor].IssuerName, wantSeries, wantFund)
	}

	// The claim. Item 7.101's proposal prose is not a masthead, so the section it
	// sits inside does not close on it: every row printed after it keeps the
	// section's own identity.
	for i := anchor + 1; i < len(rows); i++ {
		r := rows[i]
		if r.SeriesID != wantSeries || r.FundName != wantFund {
			t.Errorf("row %d (%s, %q): series=%q fund=%q want series=%q fund=%q -- the section opened at source line 20018 was reset by item 7.101's wrapped proposal line at source line 47647, `Mezhregiongaz and Gazpromipoteka Fund [the Licensees]`, which is ordinary ballot prose in a plain table cell, not a fund masthead",
				i+1, r.IssuerName, truncateDesc(r.VoteDescription), r.SeriesID, r.FundName, wantSeries, wantFund)
		}
	}

	// Stated the other way round, so a fix that blanks the fund name instead of
	// keeping the section cannot pass: no row may take its fund name from the
	// proposal text.
	for i, r := range rows {
		if strings.Contains(r.FundName, "Licensees") || strings.Contains(r.FundName, "Gazpromipoteka") {
			t.Errorf("row %d (%s): fund=%q -- item 7.101's proposal text was stamped as a fund name",
				i+1, r.IssuerName, r.FundName)
		}
	}
}

// truncateDesc keeps a failure line readable: these proposals run to hundreds of
// characters.
func truncateDesc(s string) string {
	if len(s) <= 48 {
		return s
	}
	return s[:48] + "..."
}
