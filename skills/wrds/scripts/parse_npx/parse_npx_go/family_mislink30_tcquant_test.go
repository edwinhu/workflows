package main

import (
	"path/filepath"
	"testing"
)

// familyMislink30Dispatch runs the real dispatch on the family MISLINK30
// fixture with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout, CIK, period and declared-series count -- so
// a failure below is an assertion about the series id and never a broken
// fixture.
func familyMislink30Dispatch(t *testing.T, fixture, dict, layout string) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	if dict != "" {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink30", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink30", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) == 0 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}
	if meta.CIK != "0001084380" || meta.PeriodOfReport != "20200630" || len(meta.SeriesDecls) != 71 {
		t.Fatalf("fixture/dispatch precondition: cik=%s period=%s decls=%d want 0001084380/20200630/71", meta.CIK, meta.PeriodOfReport, len(meta.SeriesDecls))
	}
	return rows
}

// 000108/1084380/0000930413-20-002030.txt (TIAA-CREF Funds, CIK 0001084380,
// period 20200630, form N-PX, layout `icr`). The same four banners appear in
// 0000930413-19-002348.txt.
//
// REGRESSION, bisected to 53e97e10 (layout_icr.go `icrResolveFundShared`: an
// inexact hdrOnly answer is held back and the dictionary-aware chain runs
// first): correct at binary parse_npx_go_424, wrong from the commit onward.
//
// THE SHAPE, IN THE BYTES. The filing's own SGML header declares the four Quant
// sleeves under the names they carry AT THIS PERIOD, each with the registrant
// prefix `TIAA-CREF `:
//
//	<SERIES-ID>S000019658  <SERIES-NAME>TIAA-CREF Quant Large-Cap Value Fund
//	<SERIES-ID>S000055721  <SERIES-NAME>TIAA-CREF Quant International Small-Cap Equity Fund
//	<SERIES-ID>S000019656  <SERIES-NAME>TIAA-CREF Quant International Equity Fund
//	<SERIES-ID>S000019657  <SERIES-NAME>TIAA-CREF Quant Large-Cap Growth Fund
//
// and the body heads those four sections with the SAME names shortened to the
// `TC ` house prefix, the string `Quant` intact in every one:
//
//	======================TC Quant Large-Cap Value Fund======================
//	================= TC Quant International Small-Cap Equity Fund =================
//	==================== TC Quant International Equity Fund =======================
//	=================== TC Quant Large-Cap Growth Fund =====================
//
// The header settles all four, and the dictionary agrees with the header --
// `cikdict.tsv` is every `cik_series.tsv` row for this registrant (225 rows,
// tab separated), and it carries exactly these names at DeclDate 20180630:
//
//	0001084380	S000019658	TIAA-CREF Quant Large-Cap Value Fund	20180630	...
//	0001084380	S000055721	TIAA-CREF Quant International Small-Cap Equity Fund	20180630	...
//	0001084380	S000019656	TIAA-CREF Quant International Equity Fund	20180630	...
//	0001084380	S000019657	TIAA-CREF Quant Large-Cap Growth Fund	20180630	...
//
// What makes the bug reproduce is that the SAME registrant also has a NON-Quant
// sibling for each of the four, declared in the same header and present in the
// same dictionary slice:
//
//	S000005383	TIAA-CREF Large-Cap Value Fund
//	S000005386	TIAA-CREF Quant Small-Cap Equity Fund
//	S000005381	TIAA-CREF International Equity Fund
//	S000012197	TIAA-CREF Large-Cap Growth Fund
//
// Each sibling's name is the banner's name with `Quant` deleted (or, for
// S000005386, with `International ` deleted). Since 53e97e10 held the inexact
// hdrOnly answer back and let the dictionary-aware chain run first, a
// registrant-scoped tolerance rung reaches the sibling and wins, stamping:
//
//	banner `TC Quant Large-Cap Value Fund`                -> S000005383 (WRONG, want S000019658)
//	banner `TC Quant International Small-Cap Equity Fund`  -> S000005386 (WRONG, want S000055721)
//	banner `TC Quant International Equity Fund`            -> S000005381 (WRONG, want S000019656)
//	banner `TC Quant Large-Cap Growth Fund`                -> S000012197 (WRONG, want S000019657)
//
// `Quant` is the discriminating token between a sleeve and its sibling in this
// registrant, so a rung that may drop it can never answer this family
// correctly. Same class as families MISLINK23 (2e2ec1c5), MISLINK24 (0b8f5a6c),
// MISLINK25 (66912067), MISLINK26 (cc364fcd), MISLINK27 (8be423eb),
// MISLINK28 (d4fe9bcc), MISLINK29 (8b6c11bb) and NS-1084380 (ce502d10) -- a row
// of one series of a CIK is stamped with a sibling series of the SAME CIK.
func TestFamilyMislink30TcQuantBannersLoseToNonQuantSiblings(t *testing.T) {
	rows := familyMislink30Dispatch(t, "tiaacref2020_tcquant_banners.txt", "cikdict.tsv", "icr")
	want := map[string]string{
		"TC Quant Large-Cap Value Fund":                "S000019658",
		"TC Quant International Small-Cap Equity Fund": "S000055721",
		"TC Quant International Equity Fund":           "S000019656",
		"TC Quant Large-Cap Growth Fund":               "S000019657",
	}
	seen := map[string]int{}
	for _, r := range rows {
		w, ok := want[r.FundName]
		if !ok {
			t.Errorf("fixture precondition: unexpected fund banner %q (series %q)", r.FundName, r.SeriesID)
			continue
		}
		seen[r.FundName]++
		if r.SeriesID != w {
			t.Errorf("banner %q is this filing's OWN header name for %s minus the `TIAA-CREF `/`TC ` prefix swap (and the same name the dictionary carries at DeclDate 20180630), so nothing may stamp it with a non-Quant same-CIK sibling; icrResolveFundShared (layout_icr.go) held the hdrOnly answer back at 53e97e10 and the tolerance rung dropped `Quant`: issuer=%q item=%q cusip=%q date=%q desc=%q series=%q want %s",
				r.FundName, w, r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID, w)
		}
	}
	for b := range want {
		if seen[b] == 0 {
			t.Fatalf("fixture section: banner %q produced no rows", b)
		}
	}
}
