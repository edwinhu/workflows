package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Harding Loevner Funds Inc (CIK 1018170), Saudi/Peruvian-market ProxyEdge
// grid, filing 0001193125-20-232686.txt: a section banner's COLSPAN does not
// always span the row's lone content TD down to width 1 -- it can be wider
// than the content needs and leave one or more bare `&nbsp;` TDs trailing
// after it (`COLSPAN="5"` on the name cell, then two empty TDs filling out a
// 7-column row). The cell-grid builder right-pads that content to the LAST
// column of its own span rather than the first, so `cells[0]` -- the signal
// htmlContextLead's call site uses to let a bare one-cell heading override a
// non-empty ctx.Issuer -- comes out empty, and the heading is refused. Every
// later banner in the real filing then inherited the FIRST one's name
// ("CREDICORP LTD.", COLSPAN="7" with no trailing cells, so its own heading
// read correctly): 4,899 of the filing's rows carrying 24 distinct banners
// stayed `CREDICORP LTD.` on full454's staleissuer.tsv, the corpus's single
// largest stale-issuer family.
//
// The fixture is this filing's own SEC header, one <SERIES> declaration and
// two banners verbatim: CREDICORP LTD. (COLSPAN="7", works) followed by BUPA
// ARABIA FOR COOPERATIVE INSURANCE COMPANY (COLSPAN="5" plus two trailing
// `&nbsp;` TDs, and an identity row that interleaves label and value in one
// row -- `Security | M20515116 | Meeting Type | ...` -- rather than a
// separate label row over a separate value row, so the fix also needs
// htmlBallotIssuerOverInlineIdentityRow rather than just the column-header
// lookahead the Putnam family already uses).
func TestFamilyNS1018170CredicorpColspanBannerOverridesStaleIssuer(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "family_ns1018170_credicorp_colspan", "harding_loevner_1018170_credicorp_bupa_2020.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}

	var credicorp, bupa int
	for _, r := range rows {
		switch r[colCUSIP] {
		case "G2519Y108":
			credicorp++
			if r[colIssuerName] != "CREDICORP LTD." {
				t.Errorf("Credicorp row: issuer = %q, want %q", r[colIssuerName], "CREDICORP LTD.")
			}
		case "M20515116":
			bupa++
			if r[colIssuerName] != "BUPA ARABIA FOR COOPERATIVE INSURANCE COMPANY" {
				t.Errorf("Bupa Arabia row: issuer = %q, want %q -- the right-padded COLSPAN banner"+
					" did not override the standing issuer", r[colIssuerName], "BUPA ARABIA FOR COOPERATIVE INSURANCE COMPANY")
			}
		}
	}
	if credicorp != 1 {
		t.Errorf("Credicorp rows = %d, want 1", credicorp)
	}
	if bupa != 1 {
		t.Errorf("Bupa Arabia rows = %d, want 1", bupa)
	}
}
