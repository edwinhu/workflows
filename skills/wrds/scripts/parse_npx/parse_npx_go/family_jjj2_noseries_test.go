package main

import (
	"path/filepath"
	"testing"
)

// familyJJJ2Dispatch runs the real dispatch on a family JJJ.2 no-series fixture
// with the registrant's own cik_series.tsv rows loaded as the dictionary.
func familyJJJ2Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_jjj2", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_jjj2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000082/826737/0000950123-04-010142.txt: header 11-20, 22-26, 50-57 and body
// 121-127, 3390-3406. Phoenix Multi Portfolio Fund, 2004, declares NO series in
// its SGML header, so the resolver sees only cik_series.tsv for CIK 0000826737,
// four ids:
//
//	0000826737	S000001368	PHOENIX EMERGING MARKETS BOND FUND
//	0000826737	S000001369	PHOENIX INTERNATIONAL STRATEGIES FUND
//	0000826737	S000001370	PHOENIX REAL ESTATE SECURITIES FUND
//	0000826737	S000001371	PHOENIX TAX EXEMPT BOND FUND
//
// The filing DOES print per-fund section headings, in the era's `====` rule
// form, and every one of them carries the sub-adviser's brand glued to the
// house token with a hyphen:
//
//	=========== PHOENIX-DUFF & PHELPS REAL ESTATE SECURITIES FUND (CHI) ============
//	======================== PHOENIX-ABERDEEN INTERNATIONAL ========================
//
// A full-file dispatch (2026-09-09) emits 931 rows and ALL 931 carry a blank
// series_id: 824 under `PHOENIX-ABERDEEN INTERNATIONAL`, 75 under the Duff &
// Phelps heading, 32 under `PHOENIX-SENECA TAX SENSITIVE GROWTH FUND`.
//
// This heading is `<house>-<sub-adviser> <fund name> (<office code>)`. The
// trailing parenthetical `(CHI)` is Duff & Phelps's Chicago desk and
// issCutTrailingParenthetical already removes it; what nothing removes is the
// hyphen-glued sub-adviser brand, which is not a labelled `Sub-Adviser:` and so
// never reaches issCutSubAdviser. Dropping `-DUFF & PHELPS` leaves
// `PHOENIX REAL ESTATE SECURITIES FUND`, which is the dictionary name exactly.
//
// Fix in issCutSubAdviser (layout_issnpx.go), extended to the unlabelled,
// hyphen-glued form: when the banner's first token is the registrant's own
// house token and a hyphen glues a second brand to it, retry the lookup with
// the glued brand removed. 75 rows here.
func TestFamilyJJJ2PhoenixDuffPhelpsGluedSubAdviser(t *testing.T) {
	rows := familyJJJ2Dispatch(t, "phoenix_duff_phelps_office_code.txt", "phoenix_dict.tsv", "issnpx", 4)
	for _, r := range rows {
		if r.SeriesID != "S000001370" {
			t.Errorf("PHOENIX-DUFF & PHELPS REAL ESTATE SECURITIES FUND (CHI) is PHOENIX REAL ESTATE SECURITIES FUND: fund=%q issuer=%q series=%q want S000001370", r.FundName, r.IssuerName, r.SeriesID)
		}
	}
}

// Same filing, body 121-152. The largest section's heading carries the glued
// sub-adviser brand AND a fund name printed short of the dictionary's:
//
//	======================== PHOENIX-ABERDEEN INTERNATIONAL ========================
//
// Removing `-ABERDEEN` leaves `PHOENIX INTERNATIONAL`, which is not a declared
// name but IS an unambiguous token-prefix of exactly one dictionary entry,
// `PHOENIX INTERNATIONAL STRATEGIES FUND` (S000001369) -- no other of the four
// names for this CIK begins with those two tokens. 824 rows of the filing, the
// single largest no-series block in it.
//
// Fix in issResolveFundUncached (layout_issnpx.go), after the glued sub-adviser
// cut above: when the cut remainder matches exactly one declared name on a
// leading token-prefix, and no other declared name shares that prefix, stamp
// it; a prefix shared by two names must still refuse.
func TestFamilyJJJ2PhoenixAberdeenTruncatedName(t *testing.T) {
	rows := familyJJJ2Dispatch(t, "phoenix_aberdeen_international.txt", "phoenix_dict.tsv", "issnpx", 4)
	for _, r := range rows {
		if r.SeriesID != "S000001369" {
			t.Errorf("PHOENIX-ABERDEEN INTERNATIONAL is PHOENIX INTERNATIONAL STRATEGIES FUND: fund=%q issuer=%q series=%q want S000001369", r.FundName, r.IssuerName, r.SeriesID)
		}
	}
}

// 000152/1529390/0001213900-21-040275.txt: header 1-16, 41-42, 123-142, 163-177
// and body 383-451. Cambria ETF Trust declares 12 series in the SGML
// header, so the dictionary never backs this filing; the fixture keeps two of
// them (S000054369 Cambria Tail Risk ETF, S000058208 Cambria Global Real Estate
// ETF) so nothing is stamped by the single-series chassis rule.
//
// This vendor prints no section headings: every row carries its own `Account
// Name` cell beside an internal account number, and the name is a vowel-dropped
// abbreviation of the declared series:
//
//	<TD STYLE="text-align: left; vertical-align: top"><FONT STYLE="font-size: 8pt">5500616</FONT></TD>
//	<TD STYLE="text-align: left; vertical-align: top"><FONT STYLE="font-size: 8pt">GLBL RL ESTATE ETF</FONT></TD>
//
// The SAME account, 5500616, also prints the readable spelling on other rows of
// the same table, `GLOBAL REAL ESTATE ETF`, and those resolve to S000058208.
// A full-file dispatch (2026-09-09) emits 7,884 rows, 384 with no series -- all
// 384 are `GLBL RL ESTATE ETF` rows of account 5500616 (443 rows carry that
// spelling; 59 of them are rescued by the section carry-over, 221 more carry
// the readable spelling).
//
// `GLBL RL ESTATE` abbreviates exactly one declared name of this registrant and
// no other -- the other eleven declared names are Value, Momentum, Tail Risk,
// Cannabis, Trinity, Asset Allocation, Shareholder Yield -- so the attribution
// is decidable from the header alone.
//
// Fix in parseHTMLTableRaw (layout_htmltable.go), at the
// `icrResolveFundShared(seriesIx, v)` call that resolves a per-row fund cell:
// when the cell resolves to nothing, retry it as a per-word abbreviation of a
// declared name (GLBL->Global, RL->Real), accepting only a unique hit; and
// alternatively carry the series an ACCOUNT NUMBER already resolved under
// another spelling in the same filing, which accountNames already records.
// 384 rows.
func TestFamilyJJJ2CambriaAccountNameAbbreviation(t *testing.T) {
	rows := familyJJJ2Dispatch(t, "cambria_account_abbreviation.txt", "cambria_dict.tsv", "htmltable", 4)
	for _, r := range rows {
		if r.SeriesID != "S000058208" {
			t.Errorf("GLBL RL ESTATE ETF (account 5500616) is Cambria Global Real Estate ETF: fund=%q issuer=%q series=%q want S000058208", r.FundName, r.IssuerName, r.SeriesID)
		}
	}
}
