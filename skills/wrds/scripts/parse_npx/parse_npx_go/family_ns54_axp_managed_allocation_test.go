package main

import (
	"path/filepath"
	"testing"
)

// AXP Managed Series, Inc. (CIK 0000755221, FORMER CONFORMED NAME
// `IDS MANAGED RETIREMENT FUND INC`), verbatim bytes.
// Fixture: 000075/755221/0000820027-04-000721.txt (md5
// 040f357fee1b1d42bff5633ba226809a, 11,648 lines) lines 1-141 -- the SGML
// header, the document's single fund-section banner at line 113, the
// master/feeder note, and the whole first ballot (7-ELEVEN, INC., items 1.1
// through 1.10 plus 2, 3 and 4, ending at the `- ----...` separator on line 141
// immediately before the next issuer @ROAD INC) -- concatenated with the
// document's own trailing close tags (lines 11645-11646, `</TEXT>` and
// `</DOCUMENT>`). The extracted region is byte-identical to the source:
// `{ sed -n '1,141p' $f; sed -n '11645,11646p' $f; } | md5sum` on the WRDS host
// and `md5sum` on the committed fixture both report
// 04b50072eeceac4f3020b4bef406a2db. Dictionary: all three cik_series.tsv rows
// this CIK carries, copied verbatim.
//
// This is a DEFECT reproduction, not a floor guard. The registrant has two
// pre-2006 N-PX filings, 0000820027-04-000721 (4,439 rows) and
// 0000820027-05-000753 (5,946 rows), 10,385 known-registrant no_series rows
// between them; measured by running the tracked parse_npx_go_325 binary against
// 0000820027-04-000721 alone with the corpus -cik-series and -series-map files,
// all 4,439 rows come back with series_id blank. Both filings print exactly ONE
// fund-section banner in the whole document -- `grep -n '^========' $f` returns
// the single line
// `========================= AXP MANAGED ALLOCATION FUND ==========================`
// -- so the entire no_series mass of this registrant hangs on that one heading.
//
// The heading is unreachable by any name-based rung at any CIK. No row named
// `AXP Managed Allocation Fund` exists under this CIK, and none exists anywhere
// in the 41,139-row corpus dictionary: `grep -i 'managed allocation fund'
// cik_series.tsv` returns 19 rows, all unrelated registrants (VanEck 768847,
// MTB/Wilmington 830744, USAA/Victory 908695, 1030491, TIAA-CREF/Nuveen
// 1084380, American Independence 1324443), and not one of them contains `AXP`.
// The target `RiverSource Strategic Allocation Fund` = S000003404 shares no
// distinctive word with the printed heading, so the resolution must be
// registrant-scoped, not a corpus-wide name match.
//
// The rename is directly evidenced in this registrant's OWN later filing text,
// not inferred from name similarity. 000075/755221/0001068800-07-000984.txt
// lines 7014-7016, item (5) of a numbered list of name changes, reads:
// "Effective Oct. 1, 2005, ... Managed Allocation Fund changed its name to
// Strategic Allocation Fund, ...". The same list's item (3) records the
// registrant-level rebrand -- "for all other corporations and business trusts,
// AXP was replaced with RiverSource in the registrant name" -- which is exactly
// how `AXP MANAGED ALLOCATION FUND` becomes `RiverSource Strategic Allocation
// Fund`, the name this CIK first declares at vintage 20060630 from
// 000075/755221/0001068800-06-000808.txt. The successor is therefore
// dictionary-audited under this same CIK, and no cross-CIK reach is needed or
// wanted. This is the pattern issRegistrantRenames in layout_issnpx.go already
// implements; that table currently has no entry for 0000755221.
//
// The parser currently reads the banner verbatim into the fund-name column and
// leaves series_id blank.
func TestFamilyNS54AXPManagedAllocationRenameResolves(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns54_axp_managed_allocation", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	sink := &rowSink{}
	fixture := "axp_managed_allocation.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_ns54_axp_managed_allocation", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" || meta.CIK != "0000755221" || meta.PeriodOfReport != "20040630" {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	if len(sink.buf) != 13 {
		t.Fatalf("fixture precondition: got %d rows, want 13 (the 7-ELEVEN, INC. ballot: items 1.1 through 1.10, plus 2, 3 and 4)", len(sink.buf))
	}

	const (
		wantFund   = "AXP MANAGED ALLOCATION FUND"
		wantSeries = "S000003404" // RiverSource Strategic Allocation Fund, renamed eff. 2005-10-01
	)
	for i, r := range sink.buf {
		if r.FundName != wantFund {
			t.Fatalf("row %d: fund_name=%q, want %q -- the fixture carries exactly one banner", i, r.FundName, wantFund)
		}
	}
	for i, r := range sink.buf {
		if r.SeriesID != wantSeries {
			t.Errorf("row %d, heading %q: series=%q, want %q -- 000075/755221/0001068800-07-000984.txt lines 7014-7016 say \"Managed Allocation Fund changed its name to Strategic Allocation Fund\" eff. Oct. 1, 2005, and that successor is in this CIK's own dictionary at vintage 20060630",
				i, r.FundName, r.SeriesID, wantSeries)
			break
		}
	}
}
