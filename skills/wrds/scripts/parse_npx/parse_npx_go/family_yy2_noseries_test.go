package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 000116/1167801/0001104659-08-054002.txt (MLIG Variable Insurance Trust, 2008,
// layout labelvalue, 590 of 590 rows with no series). The header declares 24
// series, so the chassis never stamps and the fund banner is the only evidence.
// That banner is WRAPPED across two full-width rules of '=' (raw line 381423):
//
//	========= MLIG VARIABLE INSURANC TRUST ROSZEL/LOOMIS SAYLES LARGE CAP ==========
//	=========                      GROWTH PORTFOLIO                       ==========
//
// Both halves clear issBannerMinEquals on their own, so issFundSeparator reads
// the second as a fresh banner and `fund` ends as `GROWTH PORTFOLIO` -- a name
// no declared series carries. The declared name is
// `Roszel/Loomis Sayles Large Cap Growth Portfolio` (S000005352), which the
// JOINED banner text yields once the registrant prefix is stripped.
// issThinBannerContinuation (layout_issnpx.go) already joins a wrapped banner,
// but only when the SECOND line is thin; here it is not.
//
// The whole filing dispatches to labelvalue on its `Name Ticker Security ID`
// column header, which sits ~380k lines above this section and so is far
// outside signatureHeadBytes for any excerpt of it; this excerpt alone would go
// to issnpx on its ISS proposal header, so the layout is called directly, as in
// TestLabelValueWrappedYear.
func TestFamilyYY2MLIGWrappedBanner(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "family_yy2", "mlig_wrapped_banner.txt"))
	if err != nil {
		t.Fatal(err)
	}
	meta := FilingMeta{
		CIK:         "0001167801",
		CompanyName: "MLIG VARIABLE INSURANCE TRUST",
		SeriesDecls: []SeriesDecl{
			{SeriesID: "S000005352", Name: "Roszel/Loomis Sayles Large Cap Growth Portfolio"},
			{SeriesID: "S000005353", Name: "Roszel/Rittenhouse Large Cap Growth Portfolio"},
			{SeriesID: "S000005354", Name: "Roszel/Marsico Large Cap Growth Portfolio"},
		},
	}
	rows, err := parseLabelValue(string(stripHTML(b)), meta)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		t.Fatal("fixture precondition: no rows parsed")
	}
	for _, r := range rows {
		if r.SeriesID != "S000005352" {
			t.Errorf("issuer=%q item=%q fund=%q series=%q want S000005352",
				r.IssuerName, r.ItemSeq, r.FundName, r.SeriesID)
		}
	}
}
