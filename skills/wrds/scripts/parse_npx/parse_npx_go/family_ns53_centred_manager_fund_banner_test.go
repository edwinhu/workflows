package main

import (
	"path/filepath"
	"testing"
)

// 000106/1066980/0000950123-11-081606.txt: verbatim source lines 1-366 (the
// whole SEC header, all 29 SERIES declarations), 14613-14638 (the Wellington
// page banner and the 3M Company block under it), 61502-61512 (the Mellon page
// banner and the `=====` rule under it) and 61537-61548 (the Abbott block).
// Every byte is a line-range cut of the source; the three closing tags
// `</TABLE>`, `</TEXT>` and `</DOCUMENT>` are the only added lines, and they
// close markup the cut opened.
//
// VANTAGEPOINT FUNDS, CIK 1066980, period 20110630. The filing is a
// concatenation of 26 sub-adviser reports, each opened by a THREE-LINE CENTRED
// PAGE BANNER -- manager, fund, reporting period. Source lines 14614-14616,
// verbatim between the `|` markers, which stand at column 0 (the leading spaces
// are the filing's own centring and are load-bearing for nothing but the fact
// that no rule and no label marks the stack):
//
// |                       WELLINGTON MANAGEMENT COMPANY LLP
// |                       VANTAGEPOINT GROWTH & INCOME FUND
// |                         JULY 1, 2010 -- JUNE 30, 2011
//
// and source lines 61503-61505, the same stack over the section that DOES
// resolve, because a `=====` rule follows it four lines later:
//
// |                        MELLON CAPITAL MANAGEMENT CORP.
// |                       VANTAGEPOINT 500 STOCK INDEX FUND
// |                         JULY 1, 2010 -- JUNE 30, 2011
//
// The middle line of 25 of the 26 stacks is a fund the filing's own header
// declares -- `VANTAGEPOINT GROWTH & INCOME FUND` against
// `<SERIES-ID>S000008131` / `<SERIES-NAME>Vantagepoint Growth & Income Fund`,
// source lines 290-291. No dictionary is loaded by this test: the filing's own
// declaration is the whole of the evidence.
//
// 6,725 of the filing's 66,561 rows carry no series id and no fund name, the
// largest single block in this CIK's 15,888 known-registrant no-series rows.
// Measured through the real dispatch on the whole filing: 5,475 of them sit
// under a banner stack whose middle line is a declared fund, and 1,250 sit
// under the ONE stack that names no fund at all (source lines 51764-51766,
// `MONDRIAN INVESTMENT PARTNERS LIMITED` / `VANTAGEPOINT INVESTMENT ADVISERS
// LLC` / `PROXY VOTING DETAIL - ANNUAL 2011` -- the adviser, not a fund). Those
// 1,250 are a floor and this test does not touch them.
//
// WHERE THE ROWS COME FROM. The whole filing dispatches to `labelvalue` (its
// proposal header sits past the 128 KB signature window, family MISLINK18), and
// `labelvalue` reads the ruled sections. The blank rows are NOT its: they are
// appended by `icrSupplement` (`layout_icr.go:268`), which `text_parser.go:508`
// runs for every winner except `icr` itself and which stamps the winner's layout
// name on rows `parseICR` produced. This fixture is short enough that `issnpx`
// wins the registry instead -- the precondition asserts it -- but the supplement
// call is the same one, so the rows below travel the same path as the 6,725.
//
// THE DEFECT. `parseICR` already has a branch for a bare fund line above a
// reporting period (`layout_icr.go:584`, the Neuberger Berman vintage), and it
// would answer this stack exactly: the nearest nonblank line above
// `JULY 1, 2010 -- JUNE 30, 2011` is `VANTAGEPOINT GROWTH & INCOME FUND`, which
// `icrResolveFundShared` answers with S000008131 from the header. The branch
// never fires because `icrReportPeriodLine` (`layout_icr.go:723`) cuts on
// `" - "` -- a single hyphen -- and this filer separates the two dates with a
// DOUBLE hyphen. `parseLabelValue`'s own Vantagepoint rule splits the same
// string on `"--"` (`layout_labelvalue.go:347`), which is why the labelvalue
// sections of this filing resolve and the icr sections do not.
//
// Fix location: `icrReportPeriodLine`, `layout_icr.go:723`. Both halves must
// still be dates, so a proposal line carrying a stray `--` is refused as it is
// today.
func TestFamilyNS53CentredManagerFundBannerLostToICRSupplement(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	const fixture = "vantagepoint_centred_manager_fund_banner.txt"
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns53", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" || len(rows) != 6 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=6 error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	seen := 0
	for _, r := range rows {
		switch r.IssuerName {
		case "ABBOTT LABORATORIES":
			// The ruled section, which resolves today. It guards the fixture: if
			// this ever goes blank the cut is broken, not the grammar.
			if r.SeriesID != "S000008107" {
				t.Fatalf("fixture guard: the `===== THE VANTAGEPOINT 500 STOCK INDEX FUND =====` section stopped resolving: series=%q fund=%q", r.SeriesID, r.FundName)
			}
		case "3M Company":
			seen++
			if r.FundName != "VANTAGEPOINT GROWTH & INCOME FUND" || r.SeriesID != "S000008131" {
				t.Errorf("a centred manager/fund/period page banner was not read as the fund heading: fund=%q series=%q issuer=%q cusip=%q date=%q item=%q desc=%q want fund `VANTAGEPOINT GROWTH & INCOME FUND`, the line this filing prints at source line 14615, and series S000008131, which it declares at source lines 290-291",
					r.FundName, r.SeriesID, r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq, r.VoteDescription)
			}
		default:
			t.Fatalf("fixture guard: unexpected issuer %q", r.IssuerName)
		}
	}
	if seen != 3 {
		t.Fatalf("fixture guard: read %d rows of the 3M Company block, want 3", seen)
	}
}
