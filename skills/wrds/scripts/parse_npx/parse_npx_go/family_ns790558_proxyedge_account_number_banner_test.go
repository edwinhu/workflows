package main

import (
	"path/filepath"
	"testing"
)

// 000079/790558/0000950135-06-005380.txt: verbatim source lines 1-196 (the whole
// SGML header, carrying all TEN `<SERIES>` declarations the filing makes,
// S000004101 through S000004110, down to `<TEXT>`) and 28508-28706 (pages 1 and
// 2 of the ProxyEdge
// `Vote Summary by Account with Ballot Detail` sub-report that closes the
// filing, cut at the `<PAGE>` that opens page 3). Every byte is a line-range cut
// of the source; the two closing lines `</TEXT>` and `</DOCUMENT>` are the only
// added ones, and they close markup the cut opened.
//
// HARTFORD HLS SERIES FUND II INC, CIK 790558, period 20060630, dispatches to
// `splittable` on both the real filing and this cut. Measured on the current
// binary (parse_npx_go_405, `-cik-series` and `-series-map` both supplied, which
// change nothing here), the real filing yields 944 rows of which 108 carry a
// BLANK series_id -- and all 108 carry the same fund_name, the four digits
// `6014`. The remaining 836 resolve: 828 to S000004105 under the
// `HARTFORD INTL STOCK HLS FUND` banner earlier in the filing, and 8 to
// S000004109 -- which is the whole of page 1 of this sub-report.
//
// The reported symptom for this residue was "garbled proposal text in
// fund_name". It is not proposal text. It is an internal account NUMBER lifted
// out of the vendor's page furniture.
//
// THE GRAMMAR. The sub-report reprints a three-line page header after every
// `<PAGE>`, seventeen times (source lines 28512, 28608, 28711, 28805, 28901,
// 29001, 29098, 29195, 29295, 29392, 29487, 29586, 29683, 29779, 29876, 29978,
// 30084 -- `Page 1 of 17` through `Page 17 of 17`):
//
//	ProxyEdge - Vote Summary by Account with Ballot Detail
//	Meeting Date Range: 06/31/2005 to 07/01/2006             Report Date: 07/27/2006
//	Selected Accounts: 6014                                             Page 1 of 17
//
// In every other ProxyEdge filing this corpus reads, the value after
// `Selected Accounts:` IS the fund -- `Selected Accounts: Scout Small Cap Fund`
// (family_mislink6), `Selected Accounts: NPX GABELLI GLOBAL GROWTH FD`
// (family_ns12), `Selected Accounts: SVS I Capital Growth Port` (family_ns13) --
// and `spSelectedAccounts` (`layout_splittable.go:1187`) exists to read it, in
// three separate arms, because the reprint after each page break must re-open
// the section wherever it lands. Here the value is `6014`, this registrant's
// internal account code for the sleeve, and the fund's NAME is printed once, on
// its own line, immediately below page 1's header:
//
//	source line 28515:	ACCOUNT - HARTFORD SMALL CAP VALUE HLS
//
// That is the only `ACCOUNT - ` line in the entire 38,464-line filing
// (`grep -c '^ACCOUNT - '` == 1), and `spAccountFund`
// (`layout_splittable.go:1199`) reads it correctly -- which is why page 1's 8
// rows come out with fund_name `HARTFORD SMALL CAP VALUE HLS` and series_id
// S000004109, the header's `HARTFORD SMALLCAP VALUE HLS FUND` at source lines
// 160-161. Pages 2 through 17 do not reprint it. They reprint only the header,
// whose `Selected Accounts:` value is the number.
//
// WHAT ACTUALLY HAPPENS -- measured on this cut through `processFile`: 14 rows.
// The 8 rows of page 1 (THE COOPER COMPANIES / COHERENT / AMN HEALTHCARE) carry
// `HARTFORD SMALL CAP VALUE HLS` and S000004109. The 6 rows from page 2
// (CATHAY GENERAL BANCORP / PROSPERITY BANCSHARES / HUTTIG BUILDING PRODUCTS,
// source lines 28620, 28644, 28678) carry fund_name `6014` and a BLANK
// series_id -- the real filing's 108-row residue, at this cut's scale.
//
// WHY. `spSelectedAccounts` returns any non-empty value for the label, with no
// test that the value can be a fund name at all. `icrCells` splits the page
// header's column runs, so `Page 2 of 17` lands in its own cell and the pair's
// value is exactly `6014`. Three callers then overwrite the running fund with
// it, unconditionally and with no regard for what set the fund before:
//
//   - `layout_splittable.go:482` (in-table body arm) -- and this is the one the
//     cut takes, since the page-2 header at source line 28608 arrives while the
//     page-1 ballot's `<TABLE>` run is open;
//   - `layout_splittable.go:393` (the implicit-table arm);
//   - `layout_splittable.go:1518` (`spReadProxyEdgeHeading`), which is reached
//     only AFTER `spAccountFund` has been tried on the same line
//     (`layout_splittable.go:1501`) -- the one ordering in the file that already
//     gives the named banner precedence over the numeric one.
//
// So the fund that page 1 named is dropped by the first page break and never
// recovered: the number is what every later page re-asserts.
//
// The fix is a narrowing, not a new rung. A `Selected Accounts:` value that is
// bare digits names no fund and must not be taken as one -- and this filing's
// own bytes say what should hold instead, since the sleeve is named once and
// `spAccountFund` already reads that name. Nothing has to be guessed: the
// correct answer for all 108 rows is the S000004109 that page 1's 8 rows
// already carry.
//
// This test asserts over fund_name AND series_id, because the header in this
// fixture is the filing's real one and declares all ten series -- so the
// blank series_id reproduces here exactly as it does on WRDS, rather than
// collapsing onto a single-series fallback.
func TestFamilyNS790558ProxyEdgeAccountNumberBanner(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	const (
		dir     = "family_ns790558_proxyedge_account_number_banner"
		fixture = "hartford_smallcap_value_page_header_2006.txt"
		banner  = "HARTFORD SMALL CAP VALUE HLS"
		series  = "S000004109"
	)

	ch := make(chan *ParseResult, 8192)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", dir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.CIK != "0000790558" || len(meta.SeriesDecls) != 10 {
		t.Fatalf("fixture precondition: cik=%q series declarations=%d, want CIK 0000790558 declaring 10 series (source lines 61-189)",
			meta.CIK, len(meta.SeriesDecls))
	}
	if meta.Layout != "splittable" {
		t.Fatalf("fixture guard: the cut dispatched to %q, not `splittable` -- the real filing dispatches to `splittable`, so the defect below is no longer being measured on the same code path",
			meta.Layout)
	}
	if len(rows) == 0 {
		t.Fatalf("fixture guard: no rows read out of pages 1-2 of the sub-report")
	}

	// Page 1's rows are the precondition, not the defect: they prove the
	// `ACCOUNT - ` banner is read and that `HARTFORD SMALL CAP VALUE HLS`
	// resolves to S000004109 off this filing's own header. If this count is 0 the
	// diagnosis above is stale -- the named banner has stopped being read at all,
	// which is a different defect from the page header overwriting it.
	good := 0
	for _, r := range rows {
		if r.FundName == banner && r.SeriesID == series {
			good++
		}
	}
	if good == 0 {
		t.Fatalf("precondition: not one row carries fund %q / series %q, so `spAccountFund` no longer reads source line 28515 and the overwrite asserted below is not what is costing these rows their fund",
			banner, series)
	}

	bad := 0
	for i, r := range rows {
		if r.FundName == banner && r.SeriesID == series {
			continue
		}
		bad++
		t.Errorf("row %d lost the fund at the page-2 break: fund=%q series=%q issuer=%q cusip=%q date=%q desc=%q -- want %q / %s, the sleeve this sub-report names once at source line 28515 and that the %d rows above this one already carry",
			i, r.FundName, r.SeriesID, r.IssuerName, r.CUSIP, r.MeetingDate,
			truncate(r.VoteDescription, 60), banner, series, good)
	}
	if bad > 0 {
		t.Errorf("%d of %d rows in the cut carry the internal account NUMBER from the vendor's page header instead of the fund: `spSelectedAccounts` (layout_splittable.go:1187) accepts the bare digits `6014` out of `Selected Accounts: 6014   Page 2 of 17` (source line 28608) as a fund name, and layout_splittable.go:482 overwrites the `ACCOUNT - HARTFORD SMALL CAP VALUE HLS` banner with it. On the real filing this is 108 of 944 rows, across all sixteen page breaks (source lines 28608-30084)",
			bad, len(rows))
	}
}
