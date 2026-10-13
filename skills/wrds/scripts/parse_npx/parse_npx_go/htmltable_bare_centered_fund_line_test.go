package main

import (
	"os"
	"path/filepath"
	"testing"
)

// JP Morgan Fleming Series Trust 2004 (0001104659-04-025900, 5,702 rows with no
// fund and no series on this run): the section is headed by an unlabelled
// centered paragraph between the trust line and the first issuer --
//
//	JP Morgan Fleming Series Trust
//	MULTI-MANAGER SMALL CAP GROWTH FUND
//	A. O. SMITH CORP.
//
// htmlBareFundLine sees it, but the trust prints the fund without the
// `JPMorgan` brand the declared name carries, so issResolveFund refuses it and
// the line is discarded rather than recorded as the printed fund.
func TestHTMLTableBareCenteredFundLine(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H81_bare_centered_fund_line.txt"))
	if err != nil {
		t.Fatal(err)
	}
	meta := FilingMeta{CompanyName: "JP MORGAN FLEMING SERIES TRUST", SeriesDecls: []SeriesDecl{
		{SeriesID: "S000002907", Name: "JPMorgan Multi-Manager Small Cap Growth Fund"},
		{SeriesID: "S000002910", Name: "JPMorgan Multi-Manager Small Cap Value Fund"},
	}}
	rows, err := parseHTMLTableRaw(raw, "", meta)
	if err != nil {
		t.Fatal(err)
	}
	seen := 0
	for _, r := range rows {
		if r.IssuerName != "A. O. SMITH CORP." {
			continue
		}
		seen++
		if r.SeriesID != "S000002907" {
			t.Fatalf("A. O. SMITH CORP.: fund %q series %q, want S000002907 (%s)", r.FundName, r.SeriesID, r.VoteDescription)
		}
	}
	if seen == 0 {
		t.Fatalf("no A. O. SMITH CORP. rows among %d", len(rows))
	}
}
