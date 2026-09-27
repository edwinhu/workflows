package main

import (
	"path/filepath"
	"testing"
)

// 000141/1413594/0001193125-09-181868.txt: verbatim source lines 1-1026 -- the
// whole SGML header (all THIRTY `<SERIES>` declarations this filing makes,
// S000020288 through S000025404, source lines 53-896), the `<DOCUMENT>`/`<TEXT>`
// wrapper, the filing's cover page and `PROXY VOTING RECORD` page, then the
// FIRST of the filing's five HSBC sub-reports: its custodian boilerplate banner
// (source line 938), the `AIR CHINA LTD` issuer heading, that issuer's identity
// grid (Ticker 753 / Security ID CNE1000001S0 / Meeting Date OCT 9, 2008) and
// its three ballot rows (items 1, 2a, 2b), cut at the `</TABLE>` that closes the
// ballot and opens `AMVIG HOLDINGS LTD` (source line 1027). The four closing
// lines `</TABLE>`, `</BODY></HTML>`, `</TEXT>` and `</DOCUMENT>` are the only
// added ones, and they close markup the cut opened.
//
// ABERDEEN FUNDS, CIK 1413594, period 20090630, dispatches to `htmltable` on
// both the real filing and this cut. On the real filing, all 355 rows are
// reported as known-registrant no_series rows carrying fund_name
// `Aberdeen Funds` -- the bare registrant fallback. The filing declares thirty
// series, votes five of them, and attributes none.
//
// MEASURED ON THIS CUT through `processFile`: 3 rows, and the symptom is the
// same defect wearing its other face. No banner is read, so no sleeve is
// established, and the rows come out with fund_name EMPTY and series_id set to
// the registrant's whole declared set -- all thirty ids, semicolon-joined,
// `S000020288;...;S000025404`. That is a no-attribution fanout: it names every
// sleeve the registrant has, which is the same information as naming none.
// Whether the fallback prints as the registrant's name or as its full series
// list is downstream of the one thing that matters here -- the banner on source
// line 938 never becomes a fund.
//
// THE GRAMMAR. The filing is five concatenated HSBC Middle Office Services
// sub-reports. Each opens with the same four-line boilerplate block, printed
// into one wrapped `<P>` run, whose LAST line is the sleeve's banner:
//
//	FORM N-Px REPORT
//	ICA File Number: 811-HSBCC
//	Reporting Period: 07/01/2008 - 06/30/2009
//	HSBC MIDDLE OFFICE SERVICES (HMOS)
//	ABERDEEN CHINA OPPS FD 61410              <- source line 938
//	AIR CHINA LTD                             <- first issuer, immediately after
//
// and the five banners, verbatim, at source lines 938, 4921, 8763, 10214 and
// 12274, are:
//
//	ABERDEEN CHINA OPPS FD 61410
//	ABERDEEN DEVELOPING MKTS FD 61310
//	ABERDEEN GLOBAL UTILITIES FD 61327
//	ABERDEEN INTERNATIONAL EQUITY FD 61300
//	ABERDEEN SELECT WORLDWIDE FD 61320
//
// The trailing five digits are HSBC's INTERNAL SUB-ACCOUNT CODE, not part of any
// fund name -- the same shape the already-fixed
// NS-790558-account-number-banner family carries, where a custodian-generated
// numeric suffix (`Selected Accounts: 6014`) must not be read as fund identity.
// Here the number is a suffix rather than the whole value, so it does not
// merely fail to resolve: it prevents the NAME beside it from resolving either.
//
// Each of the five banners is an abbreviation of one of this filing's OWN
// `<SERIES-NAME>` declarations, through a closed vocabulary of three tokens --
// `OPPS` -> `Opportunities`, `MKTS` -> `Markets`, `FD` -> `Fund`:
//
//	ABERDEEN CHINA OPPS FD            -> Aberdeen China Opportunities Fund   S000020289  (line 89)
//	ABERDEEN DEVELOPING MKTS FD       -> Aberdeen Developing Markets Fund    S000020290  (line 118)
//	ABERDEEN GLOBAL UTILITIES FD      -> Aberdeen Global Utilities Fund      S000020294  (line 234)
//	ABERDEEN INTERNATIONAL EQUITY FD  -> Aberdeen International Equity Fund  S000020291  (line 147)
//	ABERDEEN SELECT WORLDWIDE FD      -> Aberdeen Select Worldwide Fund      S000020309  (line 669)
//
// Nothing has to be guessed and nothing has to be fetched: the answer for all
// 355 rows is in the same file's own header, eight hundred lines above the
// bytes that need it. Note that the fourth banner is NOT ambiguous even though
// the header declares BOTH `Aberdeen International Equity Fund` (S000020291)
// and `Aberdeen International Equity Institutional Fund` (S000025404, line
// 889) -- the abbreviation expands to the former exactly, and the latter
// carries a word the banner does not.
//
// WHAT THIS CUT MEASURES. The three `AIR CHINA LTD` ballot rows sit under the
// first banner, so all three must carry S000020289. This test asserts over
// series_id and reports the fund_name each row actually came out with.
func TestFamilyNS1413594HMOSAbbreviatedBanner(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	const (
		dir     = "family_ns1413594"
		fixture = "aberdeen_hmos_china_opps_2009.txt"
		banner  = "ABERDEEN CHINA OPPS FD 61410"
		want    = "S000020289"
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

	if meta.CIK != "0001413594" || len(meta.SeriesDecls) != 30 {
		t.Fatalf("fixture precondition: cik=%q series declarations=%d, want CIK 0001413594 declaring 30 series (source lines 53-896)",
			meta.CIK, len(meta.SeriesDecls))
	}
	if meta.Layout != "htmltable" {
		t.Fatalf("fixture guard: the cut dispatched to %q, not `htmltable` -- the real filing dispatches to `htmltable`, so the defect below is no longer being measured on the same code path",
			meta.Layout)
	}
	if len(rows) == 0 {
		t.Fatalf("fixture guard: no rows read out of the AIR CHINA LTD ballot (source lines 939-1026)")
	}

	// The header must actually carry the target sleeve, or the assertion below is
	// testing a dictionary gap rather than the banner defect.
	found := false
	for _, d := range meta.SeriesDecls {
		if d.SeriesID == want {
			found = true
			if d.Name != "Aberdeen China Opportunities Fund" {
				t.Fatalf("fixture precondition: header declares %s as %q, want `Aberdeen China Opportunities Fund` (source line 89) -- the abbreviation table in the comment above is keyed on that exact spelling",
					want, d.Name)
			}
		}
	}
	if !found {
		t.Fatalf("fixture precondition: the cut header does not declare %s, so the fixture lost source line 88-89", want)
	}

	bad := 0
	for i, r := range rows {
		if r.SeriesID == want {
			continue
		}
		bad++
		t.Errorf("row %d under banner %q did not resolve: series=%q fund=%q issuer=%q cusip=%q date=%q desc=%q -- want series %s (`Aberdeen China Opportunities Fund`, this filing's own header at source line 89)",
			i, banner, r.SeriesID, r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate,
			truncate(r.VoteDescription, 60), want)
	}
	if bad > 0 {
		t.Errorf("%d of %d rows in the cut carry no single series: the `htmltable` layout does not read `%s` (source line 938) as a fund banner at all, so the rows fall through to the registrant-wide fallback (all thirty declared ids here; `Aberdeen Funds` as fund_name on the real filing). The trailing `61410` is HSBC's internal sub-account code -- same shape as NS-790558-account-number-banner -- and the name beside it abbreviates this filing's own `<SERIES-NAME>` `Aberdeen China Opportunities Fund` (OPPS -> Opportunities, FD -> Fund). On the real filing this is all 355 rows, across all five sub-reports (source lines 938, 4921, 8763, 10214, 12274)",
			bad, len(rows), banner)
	}
}
