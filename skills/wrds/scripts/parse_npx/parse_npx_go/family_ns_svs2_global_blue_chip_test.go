package main

import (
	"path/filepath"
	"testing"
)

// Scudder Variable Series II (CIK 0000810573, filing agent 0000088053), fourth
// row keyed out of the SAME signed instrument the three prior svs2 rounds read:
// Exhibit (a)(25) to 485BPOS 000081/810573/0000088053-06-000476.txt, the
// trustee-executed Declaration-of-Trust redesignation table effective
// 2006-02-06. The row this test pins, verbatim from the exhibit's own bytes
// (lines 700-701 of that file):
//
//	DWS Global Thematic VIP
//	(formerly Scudder Global Blue Chip Portfolio)
//
// That successor is a dictionary row of this SAME CIK, declared at vintage
// 20060630 in 000081/810573/0000088053-06-001068.txt, the registrant's first
// series-tagged N-PX: `DWS Global Thematic VIP` = S000006276. Audited on both
// ends and registrant-scoped -- no cross-CIK reach.
//
// What is NEW here is the printed spelling, not the rename. The 2004 N-PX
// 000081/810573/0000088053-04-000649.txt prints this fund's ProxyEdge section
// banner (line 4451) as
//
//	Selected Accounts: SVS II SCUD GLOB BLUE CHIP
//
// abbreviating `SCUDDER` to `SCUD` and `GLOBAL` to `GLOB`. No name-based rung
// reaches that: `Glob` is not `Global` and `Scud` is not `Scudder`, so every
// row under the banner is currently blank series_id. The 2005 filing
// (0000088053-05-000968.txt) does not contain this heading at all -- grep
// returns zero hits -- so the 2004 filing is the only carrier of this loss.
//
// The sibling abbreviation `SVS II SCUD BLUE CHIP PORT` is a DIFFERENT fund
// (Column A `Scudder Blue Chip Portfolio` -> Column B `DWS Blue Chip VIP`,
// S000006253) and was keyed in the prior round. The vendor's own spelling
// disambiguates the two: the non-global abbreviation omits `GLOB`, this one
// carries it, matching the exhibit's two separate Column A rows.
//
// The filing declares no series at all -- EDGAR tagged none for this trust
// before 2006 -- so the header pool is empty and the successor must be resolved
// against this CIK's own dictionary rows through registrantExactName, the rung
// issRegistrantRenames / issAuditedRenameAliases already use.
//
// Fixture:
//
//	svs2_2004_glob_blue_chip.txt -- 000081/810573/0000088053-04-000649.txt
//	(md5 d645dbc904a44b4df3f9c09e558c1de0) lines 1-151 (the SGML header and
//	the FORM N-PX preamble, including the registrant's own list of series),
//	lines 4448-4523 (the whole `SVS II SCUD GLOB BLUE CHIP` ProxyEdge page
//	banner plus its first ballot, GOLD FIELDS LTD, AGM Meeting Date
//	11/18/2003), that section's own closing `</TABLE>` (line 8480) and the
//	document's trailing tags (lines 53790-53793). Byte-identical excerpts,
//	no edits.
//
// Dictionary: all 58 cik_series.tsv rows this CIK carries, copied verbatim
// from testdata/family_ns_svs2_abbrev/dict.tsv.
//
// The parser currently reads the banner verbatim into the fund-name column and
// leaves series_id blank.
func TestFamilyNSSVS2GlobalBlueChip(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns_svs2_global_blue_chip", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	const (
		fixture = "svs2_2004_glob_blue_chip.txt"
		period  = "20040630"
		heading = "SVS II SCUD GLOB BLUE CHIP"
		want    = "S000006276" // DWS Global Thematic VIP, this CIK's own 20060630 declaration
		colA    = "Scudder Global Blue Chip Portfolio"
	)

	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns_svs2_global_blue_chip", fixture), sink, make([]byte, headBytes))
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
