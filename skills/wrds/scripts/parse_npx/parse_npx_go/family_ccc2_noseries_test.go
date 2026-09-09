package main

import (
	"path/filepath"
	"testing"
)

// familyCCC2Dispatch runs the real dispatch on a family CCC no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when one
// is named.
func familyCCC2Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ccc2", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ccc2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000022/225843/0000909012-07-001280.txt: 11-19, 24-26, 336-339, 356-359,
// 390-396, 95011-95026. Sentinel Group Funds Inc's 2007 N-PX/A declares
// seventeen series and prints exactly one Courier equals-rule section, under the
// fund's PREDECESSOR brand:
//
//	<div>==========================&#160;SYNOVUS&#160;MID&#160;CAP&#160;VALUE&#160;FUND&#160;==========================</div>
//	<div>&nbsp;</div>
//	<div>ARCH&#160;CAPITAL&#160;GROUP&#160;LTD</div>
//	<div>Ticker:&#160;...ACGL...Security&#160;ID:&#160;&#160;G0450A105</div>
//
// The heading IS captured -- every one of the filing's 350 rows carries
// fund_name `SYNOVUS MID CAP VALUE FUND` -- but none carries a series_id. The
// header of this same filing declares
//
//	<SERIES-ID>S000015894
//	<SERIES-NAME>SENTINEL MID CAP VALUE FUND
//
// and the Class A/C/I tickers under it in the same header block are
// SYVAX/SYVCX/SYVIX -- the Synovus tickers carried over by the 2007
// reorganisation, which is what identifies the pair. Heading and declared name
// differ in exactly the leading BRAND token, SYNOVUS for SENTINEL; the rest,
// `MID CAP VALUE FUND`, is identical and is owned by exactly one series of this
// CIK. This is the Wells Fargo Advantage/Allspring shape with a substituted
// first token rather than a stripped prefix, so the registrant-prefix strip
// never fires on it.
//
// 350 of the filing's 350 rows leave series_id blank. The full filing dispatches
// as `labelvalue` (its head is the Times-Roman cover tables); this cut, which
// starts at the Courier section, dispatches as `issnpx`. Both leave the series
// blank, because the name match itself is what fails.
//
// Fix in issResolveFund (layout_issnpx.go), alongside the existing brand-prefix
// retries: when a banner's leading token is a brand word and the remainder
// exact-matches the tail of exactly one declared name of this CIK, take that
// series.
func TestFamilyCCC2SentinelSynovusBrandToken(t *testing.T) {
	rows := familyCCC2Dispatch(t, "sentinel_synovus_brand_token.txt", "", "issnpx", 6)
	for _, r := range rows {
		if r.SeriesID != "S000015894" {
			t.Errorf("SYNOVUS heading vs declared SENTINEL MID CAP VALUE FUND: fund=%q issuer=%q item=%q series=%q want S000015894", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
