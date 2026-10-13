package main

import (
	"path/filepath"
	"testing"
)

// familySS2Dispatch runs the real dispatch on a family SS.2 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familySS2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ss2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ss2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000089/891079/0000891079-07-000023.txt: 3923. The heading abbreviates the
// declared `GE International Equity Fund` as `GE INT'L EQUITY FUND (MF)`. The
// same heading spelled `INTL` resolves through issAbbrevWordDecl; the
// apostrophe inside the token survives normalizeSeriesName, so `int'l` is not
// a prefix-ordered abbreviation of `international` and the whole section is
// left unattributed. 1,549 rows of the filing.
func TestFamilySS2GEIntlApostrophe(t *testing.T) {
	rows := familySS2Dispatch(t, "ge_intl_apostrophe.txt", "issnpx", 7)
	for _, r := range rows {
		if r.SeriesID != "S000001619" {
			t.Errorf("%q: series=%q want S000001619", r.FundName, r.SeriesID)
		}
	}
}

// 000089/891079/0000891079-07-000023.txt: 26977. The registrant prints the
// sleeves of the declared `GE Strategic Investment Fund` as sections of their
// own -- `GE-STRATEGIC FUND INTL`, `GE-STRATEGIC FUND INTL EMERGING`,
// `STRATEGIC FUND DOMESTIC EQ LC/MC` -- alongside the fund's own
// `GE STRATEGIC INV FUND (MF)` section, which resolves. No declared name of
// this registrant carries `strategic` other than S000001624. 3,975 rows.
func TestFamilySS2GEStrategicSleeve(t *testing.T) {
	rows := familySS2Dispatch(t, "ge_strategic_sleeve.txt", "issnpx", 7)
	for _, r := range rows {
		if r.SeriesID != "S000001624" {
			t.Errorf("%q: series=%q want S000001624", r.FundName, r.SeriesID)
		}
	}
}

// 000070/708950/0000708950-04-000021.txt: 18117. The header declares nothing
// (2004), so the dictionary is backfilled, and every dictionary name of this
// CIK types the fund `Portfolio` while every heading types it `FUND`. A
// heading with NO type word resolves (`AMERITAS SMALL CAP` finds
// `Ameritas Small Cap Portfolio`); the printed `AMERITAS SMALL CAP FUND` does
// not, because no rule substitutes one type word for another. 1,021 rows over
// this heading and `AMERITAS MID-CAP GROWTH FUND`.
func TestFamilySS2CalvertAmeritasTypeWord(t *testing.T) {
	rows := familySS2Dispatch(t, "calvert_ameritas_typeword.txt", "issnpx", 9)
	for _, r := range rows {
		if r.SeriesID != "S000008739" {
			t.Errorf("%q: series=%q want S000008739", r.FundName, r.SeriesID)
		}
	}
}

// 000092/922447/0001116679-04-001743.txt: 2465. The headings print the bare
// stem with no type word, and the type-word-added reading resolves the rest of
// them (`HIGH YIELD` -> `High Yield Fund`). `MID CAP VALUE` is the dictionary's
// `Mid Cap Value and Restructuring Fund` with its trailing `and <words>`
// conjunct dropped too; lessConjunct keys that reading WITH the type word
// (`mid cap value fund`), so a heading that omits the type word never reaches
// it. 382 rows of the filing.
func TestFamilySS2ExcelsiorMidCapValueConjunct(t *testing.T) {
	rows := familySS2Dispatch(t, "excelsior_midcapvalue_conjunct.txt", "issnpx", 4)
	for _, r := range rows {
		if r.SeriesID != "S000004600" {
			t.Errorf("%q: series=%q want S000004600", r.FundName, r.SeriesID)
		}
	}
}

// 000082/827060/0000827060-20-000091.txt: 7834. The centred paragraph headings
// print the fund without its type word. The nine the header declares resolve
// through the declared-name rules; the six the header does not declare have to
// go through htmlDictionaryFund, which is exact-plus-bounded-cuts and has no
// type-word-added reading, so `Core Equity Plus` never reaches the dictionary's
// `CORE EQUITY PLUS FUND`. 1,091 rows over five such headings.
func TestFamilySS2AmCenturyCoreEquityPlus(t *testing.T) {
	rows := familySS2Dispatch(t, "amcentury_core_equity_plus.txt", "htmltable", 4)
	for _, r := range rows {
		if r.SeriesID != "S000021731" {
			t.Errorf("%q: series=%q want S000021731", r.FundName, r.SeriesID)
		}
	}
}
