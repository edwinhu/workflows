package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// Family ROWFUND: in a ProxyEdge grid, a per-row fund/account cell (or the
// banner the walk failed to see) overrides the resolved section banner, so the
// banner's rows take the registrant's name or a sibling's series.
//
// Fixtures delete whole source lines only. Source line numbers below refer to
// the original accession, not the cut.
//
//   - clearwater_2022.txt, 000081/811161/0001193125-22-229562.txt: kept 1-985
//     (header, cover, first AQR page), 374492-374495 (Cooke & Bieler banner)
//     and 388048-388208 (its SCHWEITZER-MAUDUIT ballot: the Item/Proposal band
//     that makes dispatch pick proxyedge), 544035-544343 (Artisan banner, ABB
//     block: the colon identity labels), 558484-560267 (banner "Clearwater
//     International Fund: LSV Asset Management" at 558487 and two grid pages
//     whose Fund Name cell prints "Clearwater Investment Trust"), and
//     1081559-1081561.
//   - principal_2008.txt, copied from testdata/family_fundprop (cut of
//     0000898745-08-000051). Header 1795-1796 declares S000007178 "SmallCap
//     Value Fund III"; the banner at 1339098/1339148 prints "Principal Funds,
//     Inc. - SmallCap Value Fund III" over "(formerly known as Principal
//     Investors Fund, Inc. - Partners SmallCap Value Fund"; every row's fund
//     column prints "Principal Partners Small Cap Value Fund". The full filing
//     gives these rows S000007204 (the sibling "SmallCap Value Fund") on the
//     broken build. principal_dict.tsv is the seven
//     cik_series.tsv rows of CIK 0000898745 naming a SmallCap Value fund.
//   - nuveen_2010.txt, 000104/1041673/0001193125-10-199350.txt: kept 1-961
//     (header, cover, Winslow ABB block), 55723-56102 (banner "Nuveen Tradewinds
//     International Value Fund" at 55725, first page), 63572-64108 (banner
//     "Nuveen Santa Barbara Dividend Growth Fund" at 63575 with MICROCHIP, THE
//     PROCTER & GAMBLE COMPANY and PAYCHEX), 259989-259990 and 260034.
func TestFamilyRowfund(t *testing.T) {
	type vote struct{ issuer, date string }
	for _, tc := range []struct {
		fixture, dict, series string
		votes                 []vote
	}{
		{
			fixture: "clearwater_2022.txt",
			series:  "S000024756",
			votes: []vote{
				{"A2A S.p.A.", "20220428"},        // 558576-558606
				{"Adairs Limited", "20211020"},    // LSV page 1
				{"ADEKA CORPORATION", "20220624"}, // LSV page 2
			},
		},
		{
			fixture: "principal_2008.txt",
			dict:    "principal_dict.tsv",
			series:  "S000007178",
			votes: []vote{
				{"Ocwen Financial", "20080328"},
				{"Old Dominion Freight Line Inc", "20080401"},
				{"Owens & Minor Inc", "20080304"}, // 1424268, 1424333
			},
		},
		{
			fixture: "nuveen_2010.txt",
			series:  "S000008519",
			votes: []vote{
				{"THE PROCTER & GAMBLE COMPANY", "20091013"}, // 63723
			},
		},
	} {
		t.Run(tc.fixture, func(t *testing.T) {
			oldDict, oldMap := cikDict, seriesMap
			t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
			cikDict, seriesMap = nil, nil
			if tc.dict != "" {
				var err error
				cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_rowfund", tc.dict))
				if err != nil {
					t.Fatal(err)
				}
			}
			ch := make(chan *ParseResult, 4096)
			sink := &rowSink{out: ch}
			meta := processFile(tc.fixture, filepath.Join("testdata", "family_rowfund", tc.fixture), sink, make([]byte, headBytes))
			close(ch)
			if meta.Layout != "proxyedge" || meta.ParseStatus != "ok" {
				t.Fatalf("invalid fixture: layout=%q status=%s error=%s, full filing uses proxyedge", meta.Layout, meta.ParseStatus, meta.ErrorMsg)
			}
			var rows []VoteRow
			for pr := range ch {
				rows = append(rows, pr.Rows...)
			}
			rows = append(rows, sink.buf...)

			registrant := strings.TrimSpace(meta.CompanyName)
			if registrant == "" {
				t.Fatal("invalid fixture: no registrant name in header")
			}
			for _, v := range tc.votes {
				n := 0
				for _, r := range rows {
					if r.IssuerName != v.issuer || r.MeetingDate != v.date {
						continue
					}
					n++
					if r.SeriesID != tc.series {
						t.Errorf("%s %s: series=%q fund=%q, want series %s", v.issuer, v.date, r.SeriesID, r.FundName, tc.series)
					}
					if strings.TrimSpace(r.FundName) == "" || strings.EqualFold(strings.TrimSpace(r.FundName), registrant) {
						t.Errorf("%s %s: fund=%q is blank or the registrant %q", v.issuer, v.date, r.FundName, registrant)
					}
				}
				if n == 0 {
					t.Errorf("no rows for %s %s", v.issuer, v.date)
				}
			}
			bad := 0
			for _, r := range rows {
				if strings.EqualFold(strings.TrimSpace(r.FundName), registrant) {
					bad++
				}
			}
			if bad != 0 {
				t.Errorf("%d of %d rows carry the registrant name %q as fund", bad, len(rows), registrant)
			}
		})
	}
}
