package main

import (
	"path/filepath"
	"testing"
)

// Scudder Variable Series II (CIK 0000810573, filing agent 0000088053), third
// row keyed out of the SAME signed instrument the two prior rounds read:
// Exhibit (a)(25) to 485BPOS 000081/810573/0000088053-06-000476.txt (md5
// 93e8a0ca4136e10007f68aeca91274cb), document `<FILENAME>exa25-svs2.txt`,
// headed
//
//	SCUDDER VARIABLE SERIES II
//	Redesignation of Series
//
// whose Column A / Column B table is "effective February 6, 2006". The row this
// test pins, verbatim from the exhibit's own bytes:
//
//	Scudder Blue Chip Portfolio                     DWS Blue Chip VIP
//
// That successor is a dictionary row of this SAME CIK, declared at vintage
// 20060630 in 000081/810573/0000088053-06-001068.txt, the registrant's first
// series-tagged N-PX: `DWS Blue Chip VIP` = S000006253. Audited on both ends
// and registrant-scoped -- no cross-CIK reach.
//
// What is NEW here is the printed spelling, not the rename. The 2005 filing
// prints `SVS II Scudder Blue Chip Portfolio`, which already resolves on the
// existing rungs because Column A and Column B happen to share `Blue Chip`.
// The 2004 filing abbreviates:
//
//	20040630  `SVS II SCUD BLUE CHIP PORT`   521 rows, all blank
//
// and `SCUD` is not `Scudder`, so no name-based rung reaches it. Measured over
// the two REAL lossy filings of this CIK (0000088053-04-000649.txt and
// 0000088053-05-000968.txt) with -cik-series over the corpus dictionary and
// -series-map over series_map_applied.tsv, this is the LARGEST remaining blank
// heading of the family outside the closed `SVS II Index 500 Portfolio` /
// `SVS II INDEX 500 PORTFOLIO` cross-registrant floor (CIK 0000888568 files its
// own N-PX for that fund).
//
// The abbreviation is unambiguous against the exhibit, which is why this row is
// keyable and its neighbours mostly are not. Two Column A names carry
// `Blue Chip`:
//
//	Scudder Blue Chip Portfolio          ->  DWS Blue Chip VIP        S000006253
//	Scudder Global Blue Chip Portfolio   ->  DWS Global Thematic VIP  S000006276
//
// and the SAME 2004 filing prints BOTH abbreviations separately --
// `SVS II SCUD BLUE CHIP PORT` (521 rows) and `SVS II SCUD GLOB BLUE CHIP`
// (301 rows) -- so the vendor's own spelling distinguishes them and the
// `GLOB`-less form can only be the non-global series. The filing corroborates
// the expansion in its own preamble, which lists this trust's series in full
// and prints `Scudder Blue Chip Portfolio` and `Scudder Global Blue Chip
// Portfolio` as separate lines (both are in the fixture's verbatim header
// excerpt). Only whitespace/case and the two standard vendor abbreviations
// (`SCUD` for `Scudder`, `PORT` for `Portfolio`) plus the registrant's own
// `SVS II` prefix separate the printed heading from the exhibit's Column A.
//
// The filing declares no series at all -- EDGAR tagged none for this trust
// before 2006 -- so the header pool is empty and the successor must be resolved
// against this CIK's own dictionary rows, the rung issAuditedRenameAliases
// already uses.
//
// Fixture:
//
//	svs2_2004_blue_chip.txt -- 000081/810573/0000088053-04-000649.txt (md5
//	d645dbc904a44b4df3f9c09e558c1de0) lines 1-151 (the SGML header and the
//	FORM N-PX preamble, including the registrant's own list of series), lines
//	1537-1564 (the whole `SVS II SCUD BLUE CHIP PORT` ProxyEdge page banner
//	plus its first ballot, CENTEX CORP./3333 HOLDING CORP., four voted items),
//	that section's own closing `</TABLE>` (line 4429) and the document's
//	trailing tags (lines 53790-53793). Byte-identical excerpts, no edits.
//
// Dictionary: all 58 cik_series.tsv rows this CIK carries, copied verbatim.
//
// The parser currently reads the banner verbatim into the fund-name column and
// leaves series_id blank.
func TestFamilyNSSVS2Abbrev(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns_svs2_abbrev", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	const (
		fixture = "svs2_2004_blue_chip.txt"
		period  = "20040630"
		heading = "SVS II SCUD BLUE CHIP PORT"
		want    = "S000006253" // DWS Blue Chip VIP, this CIK's own 20060630 declaration
		colA    = "Scudder Blue Chip Portfolio"
	)

	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns_svs2_abbrev", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.CIK != "0000810573" || meta.PeriodOfReport != period {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	var under []VoteRow
	for _, r := range sink.buf {
		if r.FundName == heading {
			under = append(under, r)
		}
	}
	if len(under) == 0 {
		t.Fatalf("fixture precondition: no rows under %q (fixture emitted %d rows in total)", heading, len(sink.buf))
	}
	for _, r := range under {
		if r.SeriesID != want {
			t.Errorf("heading %q (fund_name=%q): series=%q, want %q -- Exhibit (a)(25) to 485BPOS 0000088053-06-000476 redesignates %q as the Column B name whose series id that is, effective 2006-02-06",
				heading, r.FundName, r.SeriesID, want, colA)
			break
		}
	}
}
