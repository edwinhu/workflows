package main

import (
	"path/filepath"
	"testing"
)

// familySkip6Dispatch runs the real dispatch on a family SKIP6 fixture and
// returns the rows with the manifest row. Like familySkip5Dispatch it asserts
// no precondition: the defect under test IS the missing rows, so a precondition
// on them would turn this into a fixture error rather than a failed assertion.
func familySkip6Dispatch(t *testing.T, fixture string) ([]VoteRow, FilingMeta) {
	t.Helper()
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_skip6", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	return rows, meta
}

// 000091/914036/0001193125-21-253580.txt: verbatim lines 1-9, 12-16, 51-52,
// 943-955, 956-959, 968, 1386-1395, 1505-1528, 1580-1592, 1609-1610 and the
// filing's own last four lines. Lincoln Variable Insurance Products Trust 2021
// (CIK 914036, 51,038,283 bytes) emits ZERO rows on the current tree -- measured
// on the WHOLE filing, not just this cut:
// `n_rows=0 parse_mode=text layout=unknown:registrant:f0393bb0 parse_status=skip`.
//
// This is family SKIP6: the shape red_SKIP5_report.md section 2 evidenced and
// did not test. Five Lincoln filings print the SEC's OWN Form N-PX column
// wording as a fixed-width table inside <PRE>, not a vendor export. Per fund
// there is a preamble:
//
//	LVIP American Century Select Mid Cap Managed Volatility Fund
//
//	REPORTING PERIOD:    07/01/2020 - 06/30/2021
//	NAME OF SERIES (AS APPLICABLE): __LVIP American Century Select Mid Cap Managed
//	Volatility Fund
//
// then a NINE-line stacked column header over a dashed rule, whose bottom line
// is the only one carrying the short labels:
//
//	                             Exchange             Shareholder                            Who Proposed     Cast     Regarding
//	                             Ticker                Meeting        Summary of Matter      Matter: Issuer  Vote on  Election of
//	Issuer of Portfolio Security Symbol     CUSIP#       Date              Voted On          / Shareholder   Matter    Directors
//	---------------------------- --------  ---------- -----------  ------------------------- --------------  -------  ------------
//
// and then ballots whose issuer and description wrap over two or three lines:
//
//	     Constellation                                             Elect Director Christy
//	     Brands, Inc.              STZ     21036P108  21-Jul-20    Clark                      Management      Yes      For
//
//	Constellation                                  Advisory Vote to Ratify
//	Brands, Inc.                                   Named Executive
//	                   STZ   21036P108  21-Jul-20  Officers' Compensation   Management  Yes  For       No
//
// The refusing gate is splittable's SIGNATURE, not its reader. matchSplitTable
// (layout_splittable.go:159) admits a body only on `institutional account name`
// / `institutional account id` or on the two Broadridge text-report banners, and
// this filing prints none of them -- `grep -ic` over the whole 51 MB returns 0
// for `Institutional Account Name`, `Institutional Account Id`, `ProxyEdge -`
// and `Vote Group:`. The closest signature in the registry is twoband's: its
// tbMeetingBand already fires on the header's bottom line (it carries both
// `Issuer` and `CUSIP` on one physical line), but tbItemBand requires `VOTE
// CAST` on a single line and this header stacks it as `Fund` / `Cast` /
// `Vote on` / `Matter` across three -- `grep -ic 'Vote Cast'` over the whole
// filing is also 0. pvtext and fixedwidth key on labels this template never
// prints. So no layout matches and the filing lands in `skip` with a
// body-derived signature.
//
// Rows reached: 114,184 ballot lines in this filing, 342,000 across the five.
//
// Fix in layout_splittable.go: add a fourth signature to matchSplitTable for the
// SEC's own wording -- the stacked `Issuer of Portfolio Security ... CUSIP# ...`
// bottom label line over its dashed rule, or `NAME OF SERIES (AS APPLICABLE)` --
// and route it to the same rule-cut block reader, which must resolve the fund
// from the per-fund preamble rather than from an institutional-account banner,
// join an issuer and a description wrapped over two or three physical lines, and
// carry the block's spans across the page break that section 1 of the SKIP5
// report already asks spInstitutionalPreRows to handle. This fixture prints two
// ballots on the first page and three on the page after the break.
func TestFamilySkip6LincolnSECFormStackedPreHeader(t *testing.T) {
	rows, meta := familySkip6Dispatch(t, "lincoln_secform_pre_stacked_header.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 5 Constellation Brands, Inc. ballots (STZ, 21036P108, 21-Jul-20) for LVIP American Century Select Mid Cap Managed Volatility Fund (S000042336) -- two on the first page under the nine-line stacked header and three on the page after the break, one of them wrapped over three physical lines",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	want := map[string]string{
		"Elect Director Christy Clark":                                   "For",
		"Elect Director Jennifer M. Daniels":                             "For",
		"Elect Director Judy A. Schmeling":                               "Withhold",
		"Ratify KPMG LLP as Auditor":                                     "For",
		"Advisory Vote to Ratify Named Executive Officers' Compensation": "For",
	}
	seen := make(map[string]bool)
	for _, r := range rows {
		vote, ok := want[r.VoteDescription]
		if !ok {
			continue
		}
		seen[r.VoteDescription] = true
		if r.IssuerName != "Constellation Brands, Inc." {
			t.Errorf("%q: issuer joined across the wrap: got %q want %q", r.VoteDescription, r.IssuerName, "Constellation Brands, Inc.")
		}
		if r.Ticker != "STZ" {
			t.Errorf("%q: ticker: got %q want %q", r.VoteDescription, r.Ticker, "STZ")
		}
		if r.CUSIP != "21036P108" {
			t.Errorf("%q: cusip: got %q want %q", r.VoteDescription, r.CUSIP, "21036P108")
		}
		if r.MeetingDate != "20200721" {
			t.Errorf("%q: meeting date: got %q want %q", r.VoteDescription, r.MeetingDate, "20200721")
		}
		if r.HowVoted != vote {
			t.Errorf("%q: how_voted: got %q want %q -- the Fund's Vote column, verbatim", r.VoteDescription, r.HowVoted, vote)
		}
		if r.SeriesID != "S000042336" {
			t.Errorf("%q: series: got %q want %q -- the fund named in the per-fund preamble", r.VoteDescription, r.SeriesID, "S000042336")
		}
	}
	for desc := range want {
		if !seen[desc] {
			t.Errorf("ballot not read: %q", desc)
		}
	}
}
