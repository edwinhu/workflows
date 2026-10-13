package main

import (
	"path/filepath"
	"testing"
)

// familyNs1084380Dispatch runs the real dispatch on the family NS1084380
// fixture with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout, CIK, period and declared-series count -- so
// a failure below is an assertion about the series id and never a broken
// fixture.
func familyNs1084380Dispatch(t *testing.T, fixture, dict, layout string) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	if dict != "" {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns1084380_oldname", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns1084380_oldname", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) == 0 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}
	if meta.CIK != "0001084380" || meta.PeriodOfReport != "20180630" || len(meta.SeriesDecls) != 4 {
		t.Fatalf("fixture/dispatch precondition: cik=%s period=%s decls=%d want 0001084380/20180630/4", meta.CIK, meta.PeriodOfReport, len(meta.SeriesDecls))
	}
	return rows
}

// 000108/1084380/0000930413-18-002702.txt (TIAA-CREF Funds, CIK 0001084380,
// period 20180630, form N-PX, layout `issnpx`).
//
// REGRESSION, bisected to 339d6bf7 ("family DICT-OVERRIDE -- the dictionary may
// fill a blank series id, never replace one the filing's own header resolves"):
// correct at binary parse_npx_go_321, wrong from 322 onward including HEAD.
//
// THE SHAPE, IN THE BYTES. The filing's own SGML header declares the four
// series under the names they carry AT THIS PERIOD:
//
//	<SERIES-ID>S000005386  <SERIES-NAME>TIAA-CREF Quant Small-Cap Equity Fund
//	<SERIES-ID>S000005367  <SERIES-NAME>TIAA-CREF Small-Cap Blend Index Fund
//	<SERIES-ID>S000019657  <SERIES-NAME>TIAA-CREF Quant Large-Cap Growth Fund
//	<SERIES-ID>S000005387  <SERIES-NAME>TIAA-CREF Large-Cap Growth Index Fund
//
// and the body prints two banners that are NEITHER of the names declared here:
//
//	===================== TIAA-CREF Small-Cap Equity Fund ==========================
//	=============== TIAA-CREF Enhanced Large-Cap Growth Index Fund =================
//
// Each is the OWN EARLIER NAME of one of the declared sleeves. `cikdict.tsv` is
// the relevant slice of `cik_series.tsv` for this registrant -- four rows, tab
// separated:
//
//	0001084380	S000005386	TIAA-CREF Small-Cap Equity Fund			20110630
//	0001084380	S000005367	TIAA-CREF Small-Cap Blend Index Fund		20180630
//	0001084380	S000019657	TIAA-CREF Enhanced Large-Cap Growth Index Fund	20110630
//	0001084380	S000005387	TIAA-CREF Large-Cap Growth Index Fund		20180630
//
// The 20110630 rows come from this registrant's own earlier accession
// 0000930413-11-005768.txt: `TIAA-CREF Small-Cap Equity Fund` is an exact,
// registrant-unique historical name of S000005386, and
// `TIAA-CREF Enhanced Large-Cap Growth Index Fund` is an exact,
// registrant-unique historical name of S000019657. Both are the answers the
// same-CIK dictionary rung of `issResolveFund` (layout_issnpx.go ~3467) exists
// to supply, and neither banner is exactly declared by the chain's own answer,
// so that rung should fire on both.
//
// At binaries 322 through 432 it did not. The chain's registrant-scoped
// tolerance reached a SIBLING sleeve of the same CIK first and that inexact
// same-CIK hit survived, stamping:
//
//	banner `TIAA-CREF Small-Cap Equity Fund`               -> S000005367 (was WRONG, want S000005386)
//	banner `TIAA-CREF Enhanced Large-Cap Growth Index Fund` -> S000005387 (was WRONG, want S000019657)
//
// Fixed by 8be423eb ("family MISLINK27 -- an abandoned-by-period exact same-CIK
// name must still outrank a tolerance rung's nameless rival") and d4fe9bcc
// ("family MISLINK28 -- an exact same-CIK dictionary name must outrank the
// within-declaration subset guard"). The same wrong stamp S000005367 on the
// Small-Cap Equity banner covered 7,718 rows in 0000930413-21-001494 and
// 0000930413-22-001536, which binary 433 corrects.
//
// Same class as families MISLINK23 (2e2ec1c5), MISLINK24 (0b8f5a6c),
// MISLINK25 (66912067) and MISLINK26 (cc364fcd) -- a row of one series of a CIK
// is stamped with a sibling series of the SAME CIK -- and the same remedy shape:
// an exact same-CIK historical name must outrank an inexact same-CIK fuzzy hit.
func TestFamilyNs1084380TiaaCrefOldBannerNamesLoseToFuzzySiblings(t *testing.T) {
	rows := familyNs1084380Dispatch(t, "tiaacref2018_oldname_banners.txt", "cikdict.tsv", "issnpx")
	want := map[string]string{
		"TIAA-CREF Small-Cap Equity Fund":                "S000005386",
		"TIAA-CREF Enhanced Large-Cap Growth Index Fund": "S000019657",
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
			t.Errorf("banner %q is an exact, registrant-unique historical name of %s in cik_series.tsv (CIK 0001084380, DeclDate 20110630, accession 0000930413-11-005768.txt), and is NOT the name this filing's header declares for any series, so the same-CIK dictionary override in issResolveFund (layout_issnpx.go ~3467) must answer it, as it has since 8be423eb/d4fe9bcc; the chain's inexact same-CIK fuzzy hit is back: issuer=%q item=%q cusip=%q date=%q desc=%q series=%q want %s",
				r.FundName, w, r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID, w)
		}
	}
	for b := range want {
		if seen[b] == 0 {
			t.Fatalf("fixture section: banner %q produced no rows", b)
		}
	}
}
