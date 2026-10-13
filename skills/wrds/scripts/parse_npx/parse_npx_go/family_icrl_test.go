package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// American Beacon Funds 2017 (0000809593-17-000064) is a MIXED document: 3,223
// of its meeting blocks are printed in the icr grammar under a `Fund Name:`
// label
//
//	Fund Name: American Beacon Acadian Emerging Markets Managed Volatility Fund
//	________________________________________________________________________________
//	Aboitiz Power Corporation
//	Ticker     Security ID:             Meeting Date          Meeting Status
//	AP         CINS Y0005M109           05/15/2017            Voted
//
// and 189 are printed in the labelvalue grammar under the same label:
//
//	Fund Name: American Beacon Bridgeway Large Cap Growth Fund
//	_____________________________________________________________________________
//	ACCENTURE PLC
//
//	Ticker:       ACN            Security ID:  G1151C101
//	#     Proposal                                Mgt Rec   Vote Cast    Sponsor
//
// labelvalue is registered immediately after issnpx and icr immediately before
// htmltable, so the 189 labelvalue column headers win the whole filing: the real
// dispatch on the 6.3 MB original reads 2,603 rows over 156 meetings out of
// 3,223 blocks printed, and because labelvalue reads no `Fund Name:` label, not
// one row carries a fund name -- which sends the filing through
// consolidatedSeries (main.go) and stamps all 32 declared series, joined, onto
// every row. That is the 4,992 = 156 x 32 fan the corpus shows.
//
// The fixture is lines 1-16, 49-54, 541-544, 751-754, 1060-1080 and
// 35814-35828 of the filing, verbatim.
func TestFamilyICRLMixedDocumentKeepsICRBlocksAndTheirFunds(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "family_icrl",
		"ICRL_american_beacon_2017_mixed_icr_labelvalue.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))

	// Every issuer the fixture prints, with the series its `Fund Name:` section
	// resolves to and the number of proposal rows printed under it.
	want := map[string]struct {
		series string
		n      int
	}{
		"Aboitiz Power Corporation": {"S000042128", 2},
		"ACCENTURE PLC":             {"S000051599", 4},
	}
	got := map[string]int{}
	for _, r := range rows {
		issuer := r[colIssuerName]
		w, ok := want[issuer]
		if !ok {
			t.Errorf("row for unprinted issuer %q (series=%q item=%q)",
				issuer, r[colSeriesID], r[colItemSeq])
			continue
		}
		got[issuer]++
		if r[colSeriesID] != w.series {
			t.Errorf("%s item %s: series_id = %q, want %q -- this row sits under "+
				"`Fund Name: %s`, and no other series voted it",
				issuer, r[colItemSeq], r[colSeriesID], w.series, r[colFundName])
		}
		if strings.Contains(r[colSeriesID], MultiValueSep) {
			t.Errorf("%s item %s: series_id %q fans one printed row across %d series",
				issuer, r[colItemSeq], r[colSeriesID],
				len(strings.Split(r[colSeriesID], MultiValueSep)))
		}
	}
	for issuer, w := range want {
		if got[issuer] != w.n {
			t.Errorf("issuer %s: emitted %d rows, want %d -- the fixture prints %d "+
				"proposal rows under it", issuer, got[issuer], w.n, w.n)
		}
	}
}
