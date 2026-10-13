package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// Family SECREG: a filing whose sections each print a resolved fund banner
// that the header declares by exact name. Every row of a section must carry
// that banner and its header series id, and every meeting must keep its own
// printed date and its printed proposal rows.
//
// Fixtures delete whole source lines only. Source line numbers below refer to
// the original accession, not the cut.
//
//   - williamsburg_2006.txt, 000084/842512/0001111830-06-000627.txt: kept
//     1-850 (header declaring S000001564 "Jamestown Equity Fund" and
//     S000001559 "Davenport Equity Fund", cover, signature), 117863-118028
//     (JAMESTOWN EQUITY FUND banner and its first ProxyEdge ballot, THE PROCTER
//     & GAMBLE COMPANY 12-Jul-2005, items 01-02), 215432-215558 (DAVENPORT
//     EQUITY FUND banner, grid open and column header rows), 215787-216022
//     (Check Point Software Tech. 09/27/05, nine proposal rows), 216227-216367
//     (Sysco Corporation 11/11/05, five proposal rows), 223274-223310 (grid
//     close, end of filing). The grid's Dell, Medtronic, Microsoft, Brascan and
//     Estee Lauder rows are cut: they open with a SPLIT vote, which HEAD drops
//     or folds into the previous meeting, a separate defect.
//   - fuller_thaler_2020.txt, 000158/1587551/0001398344-20-017796.txt: kept
//     1-449 (header, cover), 27101-27310 (Meritage Growth Equity Fund banner
//     and its first ProxyEdge ballot, CYBERARK SOFTWARE LTD 11-Jul-2019: the
//     Item/Proposal band dispatch needs), 33174 (that grid's </TABLE>),
//     59849-60062 (Fuller & Thaler Behavioral Small-Cap Equity Fund banner,
//     Advanced Drainage Systems 07/23/2019 and CRA International 07/10/2019),
//     74020-74102 (Fuller & Thaler Behavioral Small-Cap Growth Fund banner and
//     PlayAGS 09/10/2019), 100782-100789.
func TestFamilySecReg(t *testing.T) {
	type meeting struct {
		issuer, fund, series, date string
		items                      int
	}
	for _, tc := range []struct {
		fixture  string
		meetings []meeting
	}{
		{
			fixture: "williamsburg_2006.txt",
			meetings: []meeting{
				{"THE PROCTER & GAMBLE COMPANY", "JAMESTOWN EQUITY FUND", "S000001564", "20050712", 2},
				{"Check Point Software Tech.", "DAVENPORT EQUITY FUND", "S000001559", "20050927", 9},
				{"Sysco Corporation", "DAVENPORT EQUITY FUND", "S000001559", "20051111", 5},
			},
		},
		{
			fixture: "fuller_thaler_2020.txt",
			meetings: []meeting{
				{"CYBERARK SOFTWARE LTD", "Meritage Growth Equity Fund", "S000043365", "20190711", 9},
				{"Advanced Drainage Systems, Inc.", "Fuller & Thaler Behavioral Small-Cap Equity Fund", "S000051163", "20190723", 5},
				{"CRA International, Inc.", "Fuller & Thaler Behavioral Small-Cap Equity Fund", "S000051163", "20190710", 4},
				{"PlayAGS, Inc.", "Fuller & Thaler Behavioral Small-Cap Growth Fund", "S000060086", "20190910", 3},
			},
		},
	} {
		t.Run(tc.fixture, func(t *testing.T) {
			oldDict, oldMap := cikDict, seriesMap
			t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
			cikDict, seriesMap = nil, nil
			ch := make(chan *ParseResult, 4096)
			sink := &rowSink{out: ch}
			meta := processFile(tc.fixture, filepath.Join("testdata", "family_secreg", tc.fixture), sink, make([]byte, headBytes))
			close(ch)
			if meta.ParseStatus != "ok" {
				t.Fatalf("parse failed: status=%s err=%s", meta.ParseStatus, meta.ErrorMsg)
			}
			var rows []VoteRow
			for pr := range ch {
				rows = append(rows, pr.Rows...)
			}
			rows = append(rows, sink.buf...)
			if len(rows) == 0 {
				t.Fatal("no rows")
			}
			got := make([]int, len(tc.meetings))
			for _, r := range rows {
				i := -1
				for j, m := range tc.meetings {
					if strings.TrimSpace(r.IssuerName) == m.issuer {
						i = j
						break
					}
				}
				if i < 0 {
					t.Errorf("unexpected row: issuer=%q date=%q fund=%q series=%q item=%q", r.IssuerName, r.MeetingDate, r.FundName, r.SeriesID, r.ItemSeq)
					continue
				}
				m := tc.meetings[i]
				got[i]++
				if !strings.EqualFold(strings.TrimSpace(r.FundName), m.fund) {
					t.Errorf("%s item %q: fund=%q, want %q", m.issuer, r.ItemSeq, r.FundName, m.fund)
				}
				if r.SeriesID != m.series {
					t.Errorf("%s item %q: series=%q, want %s", m.issuer, r.ItemSeq, r.SeriesID, m.series)
				}
				if r.MeetingDate != m.date {
					t.Errorf("%s item %q: date=%q, want %s", m.issuer, r.ItemSeq, r.MeetingDate, m.date)
				}
			}
			for i, m := range tc.meetings {
				if got[i] != m.items {
					t.Errorf("%s %s: %d rows, want %d", m.issuer, m.date, got[i], m.items)
				}
			}
		})
	}
}
