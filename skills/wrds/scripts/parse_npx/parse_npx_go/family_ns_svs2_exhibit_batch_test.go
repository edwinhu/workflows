package main

import (
	"path/filepath"
	"testing"
)

// Scudder Variable Series II (CIK 0000810573, filing agent 0000088053), seven
// further rows keyed out of the SAME signed instrument the prior svs2 rounds
// read: Exhibit (a)(25) to 485BPOS 000081/810573/0000088053-06-000476.txt
// (document exa25-svs2.txt, lines 44840-44946 of that file), the
// trustee-executed Redesignation of Series under Article III, Section 1 of the
// Amended and Restated Agreement and Declaration of Trust, effective
// February 6, 2006. Its Column A -> Column B table carries 29 rows; five are
// already keyed in issRegistrantRenames["0000810573"]. The seven rows this test
// pins, verbatim from the exhibit's own bytes:
//
//	Column A                                          Column B
//	SVS Janus Growth and Income Portfolio             DWS Janus Growth & Income VIP
//	Scudder Large Cap Value Portfolio                 DWS Large Cap Value VIP
//	SVS Dreman Financial Services Portfolio           DWS Dreman Financial Services VIP
//	SVS Janus Growth Opportunities Portfolio          DWS Janus Growth Opportunities VIP
//	Scudder Technology Growth Portfolio               DWS Technology VIP
//	Scudder Small Cap Growth Portfolio                DWS Small Cap Growth VIP
//	Scudder Global Blue Chip Portfolio                DWS Global Thematic VIP
//
// Every Column B name is a dictionary row of this SAME CIK, declared at vintage
// 20060630 in 000081/810573/0000088053-06-001068.txt, the registrant's first
// series-tagged N-PX. Audited on both ends and registrant-scoped -- no cross-CIK
// reach.
//
// What is lost is the printed spelling. Neither N-PX prints the Column A names;
// both print ProxyEdge page banners in the vendor's own abbreviations, and no
// name-based rung reaches them:
//
//	2004 filing 0000088053-04-000649.txt
//	  SVS II LARGE CAP VALUE VALUE PORT  (line 14608 -- the doubled word
//	                                      `VALUE VALUE` is the vendor's own
//	                                      typo, reproduced byte-for-byte)
//	  SVS II DREMAN FINAN SERVS PORT     (line 22271)
//	  SVS II JANUS GROWTH OPP PORT       (line 48504)
//	  SVS II SCUD TECH GROWTH PORT       (line 17716)
//	  SVS II SCUD SM CAP GROWTH PORT     (line 16367)
//
//	2005 filing 0000088053-05-000968.txt
//	  SVS Janus Growth and Income Portfolio  (line 48733)
//	  SVS II Technology Growth Portfolio     (line 19775)
//	  SVS II Global Blue Chip Portfolio      (line 4247)
//
// Two of these are second spellings of funds the batch already covers, and both
// must be keyed:
//
//   - `SVS II SCUD TECH GROWTH PORT` (2004) and `SVS II Technology Growth
//     Portfolio` (2005) are the same Column A row, `Scudder Technology Growth
//     Portfolio` -> S000006262.
//   - `SVS II Global Blue Chip Portfolio` (2005) is the same Column A row as the
//     already-keyed 2004 abbreviation `SVS II SCUD GLOB BLUE CHIP`
//     (family_ns_svs2_global_blue_chip_test.go), `Scudder Global Blue Chip
//     Portfolio` -> S000006276. The 2005 spelling is currently unkeyed.
//
// Neither filing declares any series -- EDGAR tagged none for this trust before
// 2006 -- so the header pool is empty and each successor must be resolved
// against this CIK's own dictionary rows through registrantExactName, the rung
// issRegistrantRenames / issAuditedRenameAliases already use.
//
// Fixtures (byte-identical excerpts, no edits):
//
//	svs2_2004_exhibit_batch.txt -- 000081/810573/0000088053-04-000649.txt
//	(md5 d645dbc904a44b4df3f9c09e558c1de0) lines 1-151 (SGML header and the
//	FORM N-PX preamble, including the registrant's own list of series), then
//	for each of the five 2004 banners its whole ProxyEdge page header plus
//	that page's first ballot, followed by that section's own closing
//	`</TABLE>`:
//	  14604-14638 + 16353  (LARGE CAP VALUE VALUE, CONAGRA FOODS 09/25/2003)
//	  22267-22302 + 23530  (DREMAN FINAN SERVS)
//	  48500-48530 + 49862  (JANUS GROWTH OPP)
//	  17712-17745 + 19074  (SCUD TECH GROWTH)
//	  16363-16391 + 17702  (SCUD SM CAP GROWTH)
//	and the document's trailing tags (53790-53794).
//
//	svs2_2005_exhibit_batch.txt -- 000081/810573/0000088053-05-000968.txt
//	(md5 36141336dd7a55e80f451c8c7f601dab) lines 1-153 (header and preamble),
//	then each of the three 2005 ProxyEdge pages with its first ballot:
//	  48729-48757  (SVS Janus Growth and Income Portfolio)
//	  19771-19799  (SVS II Technology Growth Portfolio)
//	  4243-4338    (SVS II Global Blue Chip Portfolio)
//	The 2005 document wraps many pages in one table -- it contains only three
//	`</TABLE>` lines in 54,693 -- so the enclosing table is closed once, with
//	that document's own `</TABLE>` at line 51745, before the trailing tags
//	(54690-54694).
//
// Dictionary: all 58 cik_series.tsv rows this CIK carries, copied verbatim from
// /scratch/nyu/eddyhu/npx-reconcile-corpus/cik_series.tsv (md5 of the CIK's
// slice: 7775a366bfb4a0d0bcd8a4f0a356d4b6, identical to the file the prior svs2
// rounds use).
//
// The parser currently reads each banner verbatim into the fund-name column and
// leaves series_id blank.
func TestFamilyNSSVS2ExhibitBatch(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns_svs2_exhibit_batch", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	type wantHeading struct {
		heading string
		want    string // series id of the Column B successor
		colA    string // the exhibit's Column A name
		colB    string
	}
	cases := []struct {
		name     string
		fixture  string
		period   string
		headings []wantHeading
	}{
		{
			name:    "2004",
			fixture: "svs2_2004_exhibit_batch.txt",
			period:  "20040630",
			headings: []wantHeading{
				{"SVS II LARGE CAP VALUE VALUE PORT", "S000006255", "Scudder Large Cap Value Portfolio", "DWS Large Cap Value VIP"},
				{"SVS II DREMAN FINAN SERVS PORT", "S000006267", "SVS Dreman Financial Services Portfolio", "DWS Dreman Financial Services VIP"},
				{"SVS II JANUS GROWTH OPP PORT", "S000006271", "SVS Janus Growth Opportunities Portfolio", "DWS Janus Growth Opportunities VIP"},
				{"SVS II SCUD TECH GROWTH PORT", "S000006262", "Scudder Technology Growth Portfolio", "DWS Technology VIP"},
				{"SVS II SCUD SM CAP GROWTH PORT", "S000006260", "Scudder Small Cap Growth Portfolio", "DWS Small Cap Growth VIP"},
			},
		},
		{
			name:    "2005",
			fixture: "svs2_2005_exhibit_batch.txt",
			period:  "20050630",
			headings: []wantHeading{
				{"SVS Janus Growth and Income Portfolio", "S000006270", "SVS Janus Growth and Income Portfolio", "DWS Janus Growth & Income VIP"},
				{"SVS II Technology Growth Portfolio", "S000006262", "Scudder Technology Growth Portfolio", "DWS Technology VIP"},
				{"SVS II Global Blue Chip Portfolio", "S000006276", "Scudder Global Blue Chip Portfolio", "DWS Global Thematic VIP"},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sink := &rowSink{}
			meta := processFile(tc.fixture, filepath.Join("testdata", "family_ns_svs2_exhibit_batch", tc.fixture), sink, make([]byte, headBytes))
			if meta.ParseStatus != "ok" || meta.CIK != "0000810573" || meta.PeriodOfReport != tc.period {
				t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
					meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
			}
			for _, h := range tc.headings {
				var under []VoteRow
				for _, r := range sink.buf {
					if r.FundName == h.heading {
						under = append(under, r)
					}
				}
				if len(under) == 0 {
					t.Fatalf("fixture precondition: no rows under %q (fixture emitted %d rows in total)", h.heading, len(sink.buf))
				}
				for _, r := range under {
					if r.SeriesID != h.want {
						t.Errorf("heading %q (fund_name=%q): series=%q, want %q -- Exhibit (a)(25) to 485BPOS 0000088053-06-000476 redesignates Column A %q as Column B %q, effective 2006-02-06, and that Column B name is this CIK's own 20060630 dictionary declaration of %s",
							h.heading, r.FundName, r.SeriesID, h.want, h.colA, h.colB, h.want)
						break
					}
				}
			}
		})
	}
}
