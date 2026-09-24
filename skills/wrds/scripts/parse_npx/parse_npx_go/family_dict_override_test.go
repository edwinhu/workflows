package main

import (
	"path/filepath"
	"testing"
)

// familyDictOverrideDispatch runs the real dispatch on a family
// dict-override fixture with the corpus dictionary rows for the series
// involved -- the filer's own AND the other registrants' -- loaded, the way a
// production run loads -cik-series.
func familyDictOverrideDispatch(t *testing.T, fixture, layout string) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_dict_override", "dict_override.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_dict_override", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) == 0 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	return sink.buf
}

// 000090/908186/0000908186-10-000104.txt: American Century Capital Portfolios
// Inc, period 20100630. The filing's own SGML header declares S000005777
// `EQUITY INDEX FUND` and S000005779 `MID CAP VALUE FUND`; the body heads those
// two sections with the bare tier names `Equity Index` and `Mid Cap Value`.
//
// The header is the filer's own declaration and settles both headings. With the
// dictionary loaded it does not: the registrant-scoped rungs refuse the inexact
// match against the longer declared names, and crossCIK then finds each bare
// name spelled exactly under ANOTHER sponsor -- `EQUITY INDEX` at CIK 1131013
// (S000001157) and `Mid Cap Value` at CIK 88525 (S000008809) -- and stamps
// those ids. A dictionary load must never outrank the filing's own header.
func TestFamilyDictOverrideAmericanCenturyHeaderDeclared(t *testing.T) {
	rows := familyDictOverrideDispatch(t, "amcent_equity_index_midcap_value.txt", "issnpx")
	var index, midcap int
	for _, r := range rows {
		switch r.CUSIP {
		case "88579Y101": // 3M COMPANY, under `Equity Index`
			index++
			if r.SeriesID != "S000005777" {
				t.Errorf("Equity Index: issuer=%q fund=%q series=%q want S000005777 (header EQUITY INDEX FUND)",
					r.IssuerName, r.FundName, r.SeriesID)
			}
		case "G1150G111": // ACCENTURE PLC, under `Mid Cap Value`
			midcap++
			if r.SeriesID != "S000005779" {
				t.Errorf("Mid Cap Value: issuer=%q fund=%q series=%q want S000005779 (header MID CAP VALUE FUND)",
					r.IssuerName, r.FundName, r.SeriesID)
			}
		}
	}
	if index == 0 || midcap == 0 {
		t.Fatalf("fixture precondition: Equity Index rows=%d Mid Cap Value rows=%d of %d", index, midcap, len(rows))
	}
}

// 000108/1081400/0001081400-08-000173.txt: Wells Fargo Funds Trust, period
// 20080630. The header declares S000007346 `Enterprise Fund` and S000007347
// `Mid Cap Growth Fund`; the body heads the section
// `WELLS FARGO ADVANTAGE MID CAP GROWTH FUND`, which is the header's own
// S000007347 under the registrant's brand.
//
// The dictionary carries a 2024 vintage of the OTHER id -- S000007346 is
// `Allspring Mid Cap Growth Fund` by then, sixteen years after this filing --
// and that later name wins over the header's contemporaneous declaration, so
// every row in the section is stamped with the Enterprise Fund's id.
func TestFamilyDictOverrideWellsFargoVintage(t *testing.T) {
	rows := familyDictOverrideDispatch(t, "wellsfargo_mid_cap_growth.txt", "issnpx")
	n := 0
	for _, r := range rows {
		if r.CUSIP != "00508Y102" { // ACUITY BRANDS, INC.
			continue
		}
		n++
		if r.SeriesID != "S000007347" {
			t.Errorf("WELLS FARGO ADVANTAGE MID CAP GROWTH FUND: fund=%q series=%q want S000007347 (header Mid Cap Growth Fund)",
				r.FundName, r.SeriesID)
		}
	}
	if n == 0 {
		t.Fatalf("fixture precondition: no ACUITY BRANDS rows among %d", len(rows))
	}
}
