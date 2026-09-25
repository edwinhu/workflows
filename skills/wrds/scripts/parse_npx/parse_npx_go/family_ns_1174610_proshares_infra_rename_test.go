package main

import (
	"path/filepath"
	"testing"
)

// ProShares Trust (CIK 0001174610), verbatim bytes. Fixture:
// 000117/1174610/0001193125-16-684976.txt (md5
// 12bf4a7b3ae20ed9fb2432cbbcb94d02) lines 1-4851 (the SGML header with its
// whole SERIES-AND-CLASSES-CONTRACTS-DATA block, the `<DOCUMENT>`/`<PRE>`
// framing, the N-PX cover page, and the ENTIRE
// `==================== ProShares Global Direct Infrastructure ====================`
// section down to but not including the next banner,
// `ProShares Global Listed Private Equity`, at source line 4852) and lines
// 371119-371213 (`========== END NPX REPORT</PRE>`, the signature block and the
// document's closing tags), concatenated. Nothing is added, reflowed or
// paraphrased: md5 of the two ranges read back over ssh from
// /wrds/sec/archives is eefca60fa8b58b33154b5ed17b6e9c8b and
// 75216d9d09049c323d3894e9b0ef72cc, and the concatenation is
// a67ab4118ca3548590e35fd0c3fae59b, which is this file's.
// dict.tsv is all 327 cik_series.tsv rows this CIK carries, copied verbatim.
//
// THE GRAMMAR. The issnpx layout prints one section per fund inside a single
// `<PRE>`: a banner line naming the fund between two runs of `=`, then the
// issuer/agenda blocks separated by dashed rules. The banner is the only place
// the fund is named, so a banner that does not resolve leaves every row of its
// section with a blank `series_id`.
//
// THE DEFECT. The filing's own header declares S000040181 as
//
//	ProShares DJ Brookfield Global Infrastructure ETF
//
// (source line 1084, `<SERIES-NAME>`, under `<SERIES-ID>S000040181` at line
// 1083 and `<CLASS-CONTRACT-TICKER-SYMBOL>TOLZ`). Its body prints that fund's
// banner under the marketing name the index provider dropped `DJ Brookfield`
// from and reordered:
//
//	ProShares Global Direct Infrastructure
//
// The banner resolves to nothing, and every row of the section carries no
// series id.
//
// WHOSE BALLOTS THEY ARE, proved from the document and the dictionary, not
// guessed. `Infrastructure` occurs on exactly six lines of the 2016 filing:
// 1084 (`<SERIES-NAME>`), 1087 (the matching `<CLASS-CONTRACT-NAME>`), 1454
// (the banner), and three lines of ballot prose inside unrelated sections
// (`from the InfraRed Infrastructure Fund`, and `Infrastructure Act` twice).
// There is exactly ONE declared series whose name contains the token and
// exactly ONE banner that contains it, in a filing carrying 45 banners. The
// dictionary agrees: of the 327 cik_series.tsv rows this CIK carries at any
// vintage, exactly one name contains `Infrastructure` --
//
//	0001174610  S000040181  ProShares DJ Brookfield Global Infrastructure ETF  20140630
//
// so no second Infrastructure-named sleeve of this registrant exists for these
// ballots to belong to. This is a 1:1 pairing, not a pick among candidates.
//
// The same accounting holds in the registrant's next filing,
// 000117/1174610/0001193125-17-269827.txt: `Infrastructure` occurs on four
// lines -- 1074 `<SERIES-NAME>`, 1077 `<CLASS-CONTRACT-NAME>`, 1456 the same
// banner, and one line of unrelated ballot prose.
//
// SCOPE, measured with the current corpus binary on the two REAL filings, with
// -cik-series over the full corpus dictionary and -series-map over
// series_map_applied.tsv: 1,216 blank rows in the 2016 filing and 1,341 in the
// 2017 filing, and in BOTH filings every single blank row sits under this one
// banner -- `ProShares Global Direct Infrastructure` is the only distinct
// fund_name among them. No other banner of this registrant leaves a blank row.
// The cut below reproduces the 2016 half exactly: 1,216 rows, 1,216 blank, one
// distinct fund_name, layout issnpx, status ok.
func TestFamilyNS1174610ProSharesInfraRename(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil

	dir := filepath.Join("testdata", "family_ns_1174610_proshares_infra_rename")
	var err error
	cikDict, err = loadCIKSeries(filepath.Join(dir, "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	const (
		fixture    = "proshares_infra_2016.txt"
		wantFund   = "ProShares Global Direct Infrastructure"
		wantSeries = "S000040181"
		wantRows   = 1216
	)

	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join(dir, fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" ||
		meta.CIK != "0001174610" || meta.PeriodOfReport != "20160630" {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	if len(sink.buf) != wantRows {
		t.Fatalf("fixture precondition: got %d rows, want %d (the whole ProShares Global Direct Infrastructure section)",
			len(sink.buf), wantRows)
	}
	for _, r := range sink.buf {
		if r.FundName != wantFund {
			t.Fatalf("fixture precondition: unexpected fund_name %q -- the cut carries exactly one banner, %q",
				r.FundName, wantFund)
		}
	}

	bad := 0
	var first VoteRow
	for _, r := range sink.buf {
		if r.SeriesID != wantSeries {
			if bad == 0 {
				first = r
			}
			bad++
		}
	}
	if bad != 0 {
		t.Errorf("banner %q resolves to %q on %d of %d rows, want %s on every row -- the filing's own header declares S000040181 as `ProShares DJ Brookfield Global Infrastructure ETF` (source line 1084) and it is the registrant's only Infrastructure-named series at any vintage; first offending row: issuer=%q cusip=%q date=%q desc=%q how_voted=%q",
			wantFund, first.SeriesID, bad, len(sink.buf), wantSeries,
			first.IssuerName, first.CUSIP, first.MeetingDate, first.VoteDescription, first.HowVoted)
	}
}
