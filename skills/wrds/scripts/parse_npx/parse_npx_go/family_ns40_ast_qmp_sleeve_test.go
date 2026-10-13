package main

import (
	"path/filepath"
	"testing"
)

// Advanced Series Trust (CIK 0000814679), verbatim bytes.
// Header: 000081/814679/0001683863-22-005656.txt lines 1-20, 452-458, 596-602.
// Body sections: that same filing lines 592661-592690 and 595253-595271, plus
// 000081/814679/0001683863-23-006059.txt lines 480395-480414.
//
// One registrant prints the SAME sleeve under two spellings. The 2023 filing
// spells the portfolio out -- "AST Quantitative Modeling Portfolio
// International Core Equity" -- and that heading resolves to the declared
// S000031888. The 2022 filing abbreviates the identical sleeve to "AST QMP
// PGIMQS International Core Equity", QMP being the portfolio's initials and
// PGIMQS the subadviser's, and the abbreviated spelling is not recognised. The
// resolver then falls through to the sleeve descriptor alone and lands on an
// unrelated declared series whose name happens to end in the same words --
// S000047530, AST QMA International Core Equity Portfolio -- which is a silent
// mis-attribution rather than a loss. The S&P5 sleeve of the same family has no
// descriptor twin among the declarations and is left blank instead.
//
// Measured on the two real filings with the HEAD binary: 1,425 rows land on
// S000047530, 21 on S000040444, and 69 are left with no series id.
func TestFamilyNS40ASTQMPSleeveAbbreviation(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict, seriesMap = nil, nil

	sink := &rowSink{}
	fixture := "ast_qmp_sleeve.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_ns40", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" || meta.CIK != "0000814679" {
		t.Fatalf("fixture/dispatch precondition: CIK=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	t.Logf("real dispatch: layout=%s rows=%d", meta.Layout, len(sink.buf))

	// Every row in the fixture is a sleeve of AST Quantitative Modeling
	// Portfolio, the one series the registrant declares under that name.
	const want = "S000031888"

	byFund := map[string]map[string]int{}
	for _, row := range sink.buf {
		if byFund[row.FundName] == nil {
			byFund[row.FundName] = map[string]int{}
		}
		byFund[row.FundName][row.SeriesID]++
	}
	if len(byFund) != 3 {
		t.Fatalf("heading precondition: got %d distinct fund headings, want 3: %v", len(byFund), byFund)
	}

	for fund, ids := range byFund {
		for id, n := range ids {
			if id != want {
				t.Errorf("%d rows under heading %q: series=%q, want %s (the spelled-out twin of this sleeve resolves there)",
					n, fund, id, want)
			}
		}
	}
}
