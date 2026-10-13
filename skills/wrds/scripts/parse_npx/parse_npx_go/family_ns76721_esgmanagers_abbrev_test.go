package main

import (
	"path/filepath"
	"testing"
)

// Pax World Funds Series Trust I (CIK 0000076721), verbatim bytes.
// Fixture: 000007/76721/0000076721-12-000009.txt (md5
// 9beb815229907cd82ee99651414b663d, 103,558 lines) lines 1-285 -- the SGML
// header including the whole SERIES-AND-CLASSES-CONTRACTS-DATA block (11
// declared series) plus the document tags and cover prose, stopping one line
// before the first `====PAX WORLD BALANCED FUND====` banner so that no other
// fund's section is carried -- concatenated with lines 83808-83896, the
// `Fund Name : Conservative LV Clear Bridge` section marker and its first two
// issuer blocks (Air Products and Chemicals, Inc. and American Express
// Company), and the document's own trailing close tags (lines 103556-103558).
// The extracted region is byte-identical to the source:
// `{ sed -n '1,285p' $f; sed -n '83808,83896p' $f; sed -n '103556,103558p' $f; }
// | md5sum` on the WRDS host and `md5sum` on the committed fixture both report
// 14ab93a8039c4e7e9670ed591d8f3395. Dictionary: all 52 cik_series.tsv rows this
// CIK carries, copied verbatim.
//
// This is a DEFECT reproduction, not a floor guard. CIK 0000076721 carries
// 5,062 known-registrant no_series rows in the current LOST_BASE across exactly
// two filings, both layout=icr: this one (2,808 rows) and
// 0000076721-14-000015.txt (2,254 rows).
//
// THE SHAPE. The ESG Managers portfolios are manager-of-managers funds, and the
// vendor prints one section per (portfolio, sub-adviser) pair. Those sections'
// `Fund Name :` value is the portfolio's STYLE WORD plus a sub-adviser code --
// `Conservative LV Clear Bridge`, `Moderate MUTUAL FUNDS`, `Growth LB Pax
// World` -- never the declared `ESG Managers <Style> Portfolio` name. Every
// other fund in the same filing prints its FULL declared name instead
// (`Fund Name : Pax World Balanced Fund` at line 290, `Fund Name : Pax World
// Growth Fund` at 3683, and five more).
//
// WHY IT IS BLANK TODAY. icrResolveFundVintage (layout_icr.go:885) walks
// LEADING tokens off the printed name and looks each tail up:
// `Conservative LV Clear Bridge`, `LV Clear Bridge`, `Clear Bridge` -- none is
// declared. icrResolveDeclaredSuffix then asks whether any declared name ENDS
// with the printed one; no declared name ends `... conservative lv clear
// bridge`. icrResolveQualified needs a ` - ` delimiter this line does not have.
// So the resolver returns "" and the section's rows carry a blank series_id.
// The style word sits in the INTERIOR of the declared name (`ESG Managers
// [Conservative] Portfolio`) and no existing rung reaches an interior slot.
//
// WHY THE MAPPING IS EXACT AND NOT A GUESS. The pair comes from THIS FILING'S
// OWN SEC-HEADER, lines 197-198:
//
//	<SERIES-ID>S000027264
//	<SERIES-NAME>ESG Managers Conservative Portfolio
//
// and `Conservative` occurs in exactly one of the eleven names that header
// declares. There is no colliding full-name banner: no `Fund Name :` line in
// the filing prints a Conservative fund of any other family, and the
// registrant's other funds here are all `Pax World ...`. This is a
// within-filing, header-declared identity, not a cross-filing rename inferred
// from the dictionary.
//
// THE VINTAGE IS WHY THE FILING'S OWN HEADER MUST BE THE SOURCE. The corpus
// dictionary carries this registrant through a style-word SHUFFLE: at 20100630
// S000027264 is `ESG Managers Conservative Portfolio` and S000027265 is `ESG
// Managers Growth Portfolio`, while at 20130630 S000027264 is `ESG Managers
// Income Portfolio` and S000027263 is `ESG Managers Growth Portfolio`. A rung
// that resolved a bare style word against the whole dictionary would attribute
// `Growth ...` sections of the 2014 filing to the 2012 filing's id. Resolving
// against the set the filing itself declares is what makes this safe, and it is
// also why this test fixtures Conservative from the 2012 filing rather than a
// style word the two filings spell differently.
func TestFamilyNS76721ESGManagersAbbrevBanner(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns76721_esgmanagers_abbrev", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	sink := &rowSink{}
	fixture := "pax_esg_conservative.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_ns76721_esgmanagers_abbrev", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "icr" || meta.CIK != "0000076721" || meta.PeriodOfReport != "20120630" {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}

	const (
		wantFund   = "Conservative LV Clear Bridge"
		wantSeries = "S000027264" // declared by this filing's own SEC-HEADER, lines 197-198
	)

	// Precondition: the fixture carries the two issuer blocks of the one
	// section it was cut to. If this fails the fixture, not the defect, moved.
	issuers := map[string]int{}
	for _, r := range sink.buf {
		issuers[r.IssuerName]++
	}
	if issuers["Air Products and Chemicals, Inc."] == 0 || issuers["American Express Company"] == 0 || len(issuers) != 2 {
		t.Fatalf("fixture precondition: issuers=%v, want exactly the two blocks of the Conservative LV Clear Bridge section; total rows=%d", issuers, len(sink.buf))
	}
	for i, r := range sink.buf {
		if r.FundName != wantFund {
			t.Fatalf("fixture precondition: row %d (issuer %q) carries fund=%q, want %q -- the fixture's only `Fund Name :` label is at source line 83810",
				i, r.IssuerName, r.FundName, wantFund)
		}
	}

	for i, r := range sink.buf {
		if r.SeriesID != wantSeries {
			t.Fatalf("row %d (issuer %q, item %q): fund=%q series=%q, want %q -- `Conservative` is the style slot of `ESG Managers Conservative Portfolio`, which THIS filing's own SEC-HEADER declares as S000027264, and no other of its eleven declared series carries that word",
				i, r.IssuerName, r.ItemSeq, r.FundName, r.SeriesID, wantSeries)
		}
	}
}
