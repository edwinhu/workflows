package main

import (
	"path/filepath"
	"testing"
)

// Evergreen Variable Annuity Trust (CIK 0000928754), verbatim bytes.
// Fixture: 000092/928754/0000907244-04-000279.txt (md5
// 530578e4f277a8543e5c07a78d556621) lines 1-183 (the SGML header and the
// FORM N-Px REPORT preamble), lines 2529-2548 (the whole
// `EVERGREEN VA FOUNDATION FUND` banner plus its first ballot, 3M CO) and
// lines 9811-9843 (the whole `EVERGREEN VA GROWTH AND INCOME FUND` banner plus
// its first ballot, ABBOTT LABORATORIES), concatenated and closed with the
// document's own trailing tags (lines 29848-29851). Dictionary: all 11
// cik_series.tsv rows this CIK carries, copied verbatim.
//
// This is a DEFECT reproduction, not a floor guard. Unlike the sibling
// Evergreen floors (1046026, 1045688) these two pre-2006 headings are not dead
// sleeves: both funds survived under a new name, and the registrant's own
// prospectus says so in as many words. 000092/928754/0000907244-05-000130.txt
// (485BPOS, filed 20050429), line 346 of its HTML-tag-stripped text, reads
// "Prospectuses for Class 1 and Class 2 shares of Evergreen VA Balanced Fund
// (formerly Evergreen VA Foundation Fund), Evergreen VA Core Bond Fund,
// Evergreen VA Fundamental Large Cap Fund (formerly Evergreen VA Growth and
// Income Fund), ...", and the announcing 485BPOS
// 000092/928754/0000907244-05-000018.txt (filed 20050125) gives the effective
// date at lines 4703-4717 of its tag-stripped text: "Effective on or about April 18, 2005, Evergreen VA
// Foundation Fund (the "Fund") will change its name to Evergreen VA Balanced
// Fund." and "Effective on or about April 18, 2005, Evergreen VA Growth and
// Income Fund (the "Fund") will change its name to Evergreen VA Fundamental
// Large Cap Fund."
//
// Both successor names are in the corpus dictionary under this same CIK:
// `Evergreen VA Balanced Fund` = S000000451 and
// `Evergreen VA Fundamental Large Cap Fund` = S000003471, both at vintage
// 20060630 from 000092/928754/0000907244-06-000321.txt. The rename is therefore
// dictionary-audited on both ends and registrant-scoped -- no cross-CIK reach
// is needed or wanted.
//
// Measured on the three real pre-2006 filings with parse_npx_go_289 and the
// standard -cik-series / -series-map flags: 16,969 blank rows over eight
// headings. These two account for 8,380 of them --
// EVERGREEN VA GROWTH AND INCOME FUND 1,635 + 1,635 + 1,188 = 4,458 and
// EVERGREEN VA FOUNDATION FUND 1,435 + 1,435 + 1,052 = 3,922, across
// 0000907244-04-000276, 0000907244-04-000279 and 0000907244-05-000318. The
// other six headings (EVERGREEN VA FUND, SPECIAL EQUITY, EQUITY INDEX, BLUE
// CHIP, MASTERS, GLOBAL LEADERS) are genuine floor: each merged away or
// liquidated before series tagging, and none of the six appears in any of the
// 41,139 corpus dictionary rows at any CIK or vintage, normalized for case,
// whitespace and punctuation, by substring or by token-set containment in
// either direction. This test pins only the two that a rename resolves.
//
// The parser currently reads both banners verbatim into the fund-name column
// and leaves series_id blank.
func TestFamilyNS50EvergreenVARenameResolves(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns50", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	sink := &rowSink{}
	fixture := "evergreen_va_rename.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_ns50", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" || meta.CIK != "0000928754" || meta.PeriodOfReport != "20040630" {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	if len(sink.buf) != 25 {
		t.Fatalf("fixture precondition: got %d rows, want 25 (7 for the 3M CO ballot, 18 for the ABBOTT LABORATORIES ballot)", len(sink.buf))
	}

	want := map[string]string{
		"EVERGREEN VA FOUNDATION FUND":        "S000000451", // renamed Evergreen VA Balanced Fund, eff. 2005-04-18
		"EVERGREEN VA GROWTH AND INCOME FUND": "S000003471", // renamed Evergreen VA Fundamental Large Cap Fund, eff. 2005-04-18
	}
	seen := map[string]int{}
	for _, r := range sink.buf {
		if _, ok := want[r.FundName]; !ok {
			t.Fatalf("unexpected fund_name %q -- the fixture carries exactly two banners", r.FundName)
		}
		seen[r.FundName]++
	}
	if seen["EVERGREEN VA FOUNDATION FUND"] != 7 || seen["EVERGREEN VA GROWTH AND INCOME FUND"] != 18 {
		t.Fatalf("fixture precondition: rows per banner = %v, want 7 and 18", seen)
	}

	reported := map[string]bool{}
	for _, r := range sink.buf {
		wantID := want[r.FundName]
		if r.SeriesID != wantID && !reported[r.FundName] {
			reported[r.FundName] = true
			t.Errorf("heading %q: series=%q, want %q -- 000092/928754/0000907244-05-000130.txt line 346 names the successor (\"formerly\"), and that successor is in this CIK's own dictionary at vintage 20060630",
				r.FundName, r.SeriesID, wantID)
		}
	}
}
